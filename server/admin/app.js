const AUTH_KEY = "la_passion_admin_session";

const state = {
  settings: null,
  products: [],
  tables: [],
  orders: [],
  users: [],
  stats: null,
  pollHandle: null,
  session: loadSession(),
};

const api = {
  async get(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async post(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async put(path, body) {
    const response = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
};

async function bootstrap() {
  if (!state.session) {
    await hydrateLoginUsers();
    lockApp("Connectez-vous pour acceder a l'administration.");
    return;
  }

  try {
    setStatus("Chargement...");
    const [settings, products, tables, orders, stats, users] = await Promise.all([
      api.get("/api/settings"),
      api.get("/api/products"),
      api.get("/api/tables"),
      api.get("/api/orders"),
      api.get("/api/stats"),
      api.get("/api/users"),
    ]);

    state.settings = settings;
    state.products = products;
    state.tables = tables;
    state.orders = orders.sort(sortOrders);
    state.stats = stats;
    state.users = users;
    renderAll();
    unlockApp();
    setStatus("Connecte");
    document.getElementById("lastRefreshView").textContent = new Date().toLocaleString("fr-FR");
  } catch (error) {
    setStatus(`Erreur: ${error.message}`);
  }
}

async function hydrateLoginUsers() {
  try {
    state.users = await api.get("/api/users");
    renderLoginUsers();
  } catch (error) {
    document.getElementById("loginStatusView").textContent = `Echec chargement utilisateurs: ${error.message}`;
  }
}

function renderAll() {
  renderSession();
  renderSettings();
  renderStats();
  renderTerraceOverview();
  renderTopProducts();
  renderServiceFlow();
  renderAccounting();
  renderProducts();
  renderTables();
  renderOrders();
}

function renderSession() {
  document.getElementById("sessionBadge").textContent = state.session
    ? `${state.session.name} (${state.session.role})`
    : "Session admin non chargee.";
}

function renderSettings() {
  document.getElementById("establishmentName").value = state.settings.establishmentName || "La Passion";
  document.getElementById("establishmentAddress").value = state.settings.address || "";
  document.getElementById("happyHourPercent").value = state.settings.terraceHappyHourPercent ?? 10;
  document.getElementById("currencySelect").value = state.settings.currency || "CDF";
  document.getElementById("currencyBadge").textContent = `Devise: ${state.settings.currency || "CDF"}`;
}

function renderStats() {
  const cards = [
    ["Commandes", state.stats?.totalOrders ?? 0],
    ["Chiffre d'affaires", formatMoney(state.stats?.totalRevenue ?? 0)],
    ["Produits actifs", state.products.filter((product) => product.active).length],
    ["Tables libres", state.tables.filter((table) => table.status === "free").length],
    ["Cuisine en attente", state.stats?.kitchenPending ?? 0],
    ["Cuisine prete", state.stats?.kitchenReady ?? 0],
  ];

  document.getElementById("statsCards").innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <strong>${label}</strong>
          <span>${value}</span>
        </article>
      `
    )
    .join("");
}

function renderTerraceOverview() {
  const terraceOrders = state.orders.filter((order) => order.source === "terrace");
  const terraceRevenue = terraceOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const happyHourValue = Number(state.settings?.terraceHappyHourPercent ?? 0);

  const items = [
    ["Tickets terrasse", terraceOrders.length, "Commandes rapides sorties du POS terrasse."],
    ["CA terrasse", formatMoney(terraceRevenue), "Montant consolide des ventes terrasse."],
    ["Happy hour", `${happyHourValue}%`, "Reduction automatique appliquee sur les boissons."],
  ];

  document.getElementById("terraceOverview").innerHTML = items
    .map(
      ([label, value, description]) => `
        <div class="stack-item">
          <strong>${label}</strong>
          <span>${value}</span>
          <small>${description}</small>
        </div>
      `
    )
    .join("");
}

function renderTopProducts() {
  const topProducts = Array.isArray(state.stats?.topProducts) ? state.stats.topProducts : [];
  const container = document.getElementById("topProductsList");

  container.innerHTML = topProducts.length
    ? topProducts
        .map(
          (product) => `
            <div class="stack-item">
              <strong>${escapeHtml(product.name)}</strong>
              <span>${product.quantity} ventes</span>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Les ventes apparaitront ici apres les premieres commandes synchronisees.</div>`;
}

function renderServiceFlow() {
  const bySource = state.stats?.bySource || {};
  const cards = [
    ["Restaurant", bySource.restaurant ?? 0],
    ["Terrasse", bySource.terrace ?? 0],
    ["A envoyer cuisine", state.orders.filter((order) => order.status === "pending").length],
    ["Servies", state.orders.filter((order) => order.status === "served").length],
  ];

  document.getElementById("serviceFlowCards").innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="mini-card">
          <strong>${label}</strong>
          <span>${value}</span>
        </div>
      `
    )
    .join("");
}

function renderAccounting() {
  const summary = [
    ["Total encaisse", formatMoney(state.stats?.totalRevenue ?? 0)],
    ["Total remises", formatMoney(state.stats?.totalDiscounts ?? 0)],
    ["CA restaurant", formatMoney(state.stats?.revenueBySource?.restaurant ?? 0)],
    ["CA terrasse", formatMoney(state.stats?.revenueBySource?.terrace ?? 0)],
  ];

  document.getElementById("accountingSummary").innerHTML = summary
    .map(
      ([label, value]) => `
        <div class="stack-item">
          <strong>${label}</strong>
          <span>${value}</span>
        </div>
      `
    )
    .join("");

  const breakdown = Object.entries(state.stats?.revenueByPaymentMethod || {});
  document.getElementById("paymentBreakdownList").innerHTML = breakdown.length
    ? breakdown
        .map(
          ([method, total]) => `
            <div class="stack-item">
              <strong>${escapeHtml(method)}</strong>
              <span>${formatMoney(total)}</span>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Les paiements apparaitront ici apres les premieres ventes.</div>`;

  const dailyTotals = Array.isArray(state.stats?.dailyTotals) ? state.stats.dailyTotals : [];
  document.getElementById("dailyAccountingList").innerHTML = dailyTotals.length
    ? dailyTotals
        .map(
          (item) => `
            <div class="mini-card">
              <strong>${item.date}</strong>
              <span>${formatMoney(item.total)}</span>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Le journal recent apparaitra ici.</div>`;
}

function renderProducts() {
  const tbody = document.getElementById("productsTable");
  tbody.innerHTML = state.products
    .map(
      (product, index) => `
        <tr>
          <td><input data-field="name" data-index="${index}" value="${escapeHtml(product.name)}" /></td>
          <td><input data-field="price" data-index="${index}" type="number" value="${product.price}" /></td>
          <td>
            <select data-field="category" data-index="${index}">
              <option value="drink" ${product.category === "drink" ? "selected" : ""}>Boisson</option>
              <option value="food" ${product.category === "food" ? "selected" : ""}>Plat</option>
              <option value="mixed" ${product.category === "mixed" ? "selected" : ""}>Mixte</option>
            </select>
          </td>
          <td><input data-field="active" data-index="${index}" type="checkbox" ${product.active ? "checked" : ""} /></td>
          <td><button type="button" class="ghost-button" data-delete-product="${index}">Supprimer</button></td>
        </tr>
      `
    )
    .join("");

  document.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", () => {
      state.products.splice(Number(button.dataset.deleteProduct), 1);
      renderProducts();
    });
  });
}

function renderTables() {
  const grid = document.getElementById("tablesGrid");
  grid.innerHTML = state.tables
    .map(
      (table, index) => `
        <article class="table-card">
          <header>
            <strong>${escapeHtml(table.id)}</strong>
            <span class="pill ${table.status}">${labelForTableStatus(table.status)}</span>
          </header>
          <select data-table-index="${index}">
            <option value="free" ${table.status === "free" ? "selected" : ""}>Libre</option>
            <option value="occupied" ${table.status === "occupied" ? "selected" : ""}>Occupee</option>
            <option value="reserved" ${table.status === "reserved" ? "selected" : ""}>Reservee</option>
          </select>
          <div class="status-row">
            <button type="button" class="ghost-button" data-delete-table="${index}">Supprimer</button>
          </div>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-delete-table]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tables.splice(Number(button.dataset.deleteTable), 1);
      renderTables();
    });
  });
}

function renderOrders() {
  const list = document.getElementById("ordersList");
  list.innerHTML = state.orders.length
    ? state.orders
        .slice(0, 16)
        .map((order) => {
          const sourceLabel = order.source === "restaurant" ? "Restaurant" : "Terrasse";
          const locationLabel = order.tableId ? `Table ${order.tableId}` : "Service terrasse";
          const items = (order.items || [])
            .map(
              (item) => `
                <div>${item.quantity} x ${escapeHtml(item.name)} <strong>${formatMoney(item.lineTotal || 0)}</strong></div>
              `
            )
            .join("");

          return `
            <article class="order-card">
              <header>
                <div>
                  <strong>${sourceLabel}</strong>
                  <div class="order-meta">
                    <span>${locationLabel}</span>
                    <span>${order.paymentMethod || "Paiement non defini"}</span>
                    <span>${order.printedAt || order.createdAt || "-"}</span>
                  </div>
                </div>
                <span class="pill ${order.status || "pending"}">${labelForOrderStatus(order.status)}</span>
              </header>
              <div class="items-list">${items || "<div>Aucun article detaille.</div>"}</div>
              <div class="status-row">
                <strong>Total ${formatMoney(order.total || 0)}</strong>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">Aucune commande synchronisee pour le moment.</div>`;
}

async function refreshOrdersAndStats() {
  if (!state.session) return;
  try {
    const [orders, stats] = await Promise.all([api.get("/api/orders"), api.get("/api/stats")]);
    state.orders = orders.sort(sortOrders);
    state.stats = stats;
    renderStats();
    renderTerraceOverview();
    renderTopProducts();
    renderServiceFlow();
    renderAccounting();
    renderOrders();
    setStatus("Connecte");
    document.getElementById("lastRefreshView").textContent = new Date().toLocaleString("fr-FR");
  } catch (error) {
    setStatus(`Erreur: ${error.message}`);
  }
}

function wireEvents() {
  document.getElementById("refreshBtn").addEventListener("click", bootstrap);
  document.getElementById("openKitchenBtn").addEventListener("click", () => {
    window.open("/admin/kitchen.html", "_blank");
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("loginBtn").addEventListener("click", attemptLogin);

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    state.settings.establishmentName = document.getElementById("establishmentName").value.trim() || "La Passion";
    state.settings.address = document.getElementById("establishmentAddress").value.trim();
    state.settings.terraceHappyHourPercent = Number(document.getElementById("happyHourPercent").value || 0);
    state.settings.currency = document.getElementById("currencySelect").value || "CDF";
    await api.put("/api/settings", { settings: state.settings });
    setStatus("Parametres sauvegardes");
    await bootstrap();
  });

  document.getElementById("addProductBtn").addEventListener("click", () => {
    const name = document.getElementById("newProductName").value.trim();
    const price = Number(document.getElementById("newProductPrice").value || 0);
    const category = document.getElementById("newProductCategory").value;
    if (!name || price <= 0) {
      setStatus("Entrez un produit valide.");
      return;
    }

    state.products.unshift({
      id: crypto.randomUUID(),
      name,
      price,
      category,
      active: true,
    });

    document.getElementById("newProductName").value = "";
    document.getElementById("newProductPrice").value = "";
    renderProducts();
  });

  document.getElementById("saveProductsBtn").addEventListener("click", async () => {
    state.products = Array.from(document.querySelectorAll("#productsTable tr")).map((row, index) => ({
      id: state.products[index].id,
      name: row.querySelector('[data-field="name"]').value.trim(),
      price: Number(row.querySelector('[data-field="price"]').value || 0),
      category: row.querySelector('[data-field="category"]').value,
      active: row.querySelector('[data-field="active"]').checked,
    }));

    await api.put("/api/products", { products: state.products });
    setStatus("Produits sauvegardes");
    await bootstrap();
  });

  document.getElementById("addTableBtn").addEventListener("click", () => {
    const id = document.getElementById("newTableId").value.trim();
    const status = document.getElementById("newTableStatus").value;
    if (!id) {
      setStatus("Entrez un identifiant de table.");
      return;
    }

    state.tables.push({ id, status });
    document.getElementById("newTableId").value = "";
    renderTables();
  });

  document.getElementById("saveTablesBtn").addEventListener("click", async () => {
    state.tables = Array.from(document.querySelectorAll("[data-table-index]")).map((input, index) => ({
      id: state.tables[index].id,
      status: input.value,
    }));

    await api.put("/api/tables", { tables: state.tables });
    setStatus("Tables sauvegardees");
    await bootstrap();
  });
}

function renderLoginUsers() {
  const select = document.getElementById("loginUserSelect");
  select.innerHTML = state.users
    .map((user) => `<option value="${escapeHtml(user.name)}">${escapeHtml(user.name)} (${escapeHtml(user.role)})</option>`)
    .join("");
}

async function attemptLogin() {
  const name = document.getElementById("loginUserSelect").value;
  const pin = document.getElementById("loginPinInput").value.trim();
  if (!name || !pin) {
    document.getElementById("loginStatusView").textContent = "Selectionnez un utilisateur et entrez le PIN.";
    return;
  }

  document.getElementById("loginStatusView").textContent = "Connexion en cours...";
  try {
    const response = await api.post("/api/login", { name, pin });
    state.session = response.user;
    saveSession(state.session);
    renderSession();
    unlockApp();
    await bootstrap();
  } catch (error) {
    document.getElementById("loginStatusView").textContent = `Connexion refusee: ${error.message}`;
  }
}

function lockApp(message) {
  document.getElementById("loginOverlay").classList.remove("hidden");
  document.getElementById("loginStatusView").textContent = message;
}

function unlockApp() {
  document.getElementById("loginOverlay").classList.add("hidden");
}

function logout() {
  state.session = null;
  clearSession();
  setStatus("Deconnecte");
  renderSession();
  lockApp("Session fermee. Reconnectez-vous.");
}

function startPolling() {
  if (state.pollHandle) {
    clearInterval(state.pollHandle);
  }
  state.pollHandle = setInterval(refreshOrdersAndStats, 8000);
}

function setStatus(text) {
  document.getElementById("statusBadge").textContent = text;
}

function sortOrders(left, right) {
  return new Date(right.createdAt || right.printedAt || 0) - new Date(left.createdAt || left.printedAt || 0);
}

function labelForOrderStatus(status) {
  switch (status) {
    case "preparing":
      return "En preparation";
    case "ready":
      return "Prete";
    case "served":
      return "Servie";
    case "paid":
      return "Payee";
    default:
      return "En attente";
  }
}

function labelForTableStatus(status) {
  switch (status) {
    case "occupied":
      return "Occupee";
    case "reserved":
      return "Reservee";
    default:
      return "Libre";
  }
}

function formatMoney(value) {
  const currency = state.settings?.currency || "CDF";
  return `${Number(value || 0).toLocaleString("fr-FR")} ${currency}`;
}

function loadSession() {
  try {
    return JSON.parse(window.localStorage.getItem(AUTH_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function saveSession(session) {
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

function clearSession() {
  window.localStorage.removeItem(AUTH_KEY);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

wireEvents();
bootstrap();
startPolling();
