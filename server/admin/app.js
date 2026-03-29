const state = {
  settings: null,
  products: [],
  tables: [],
  orders: [],
  stats: null,
  pollHandle: null,
};

const api = {
  async get(path) {
    const response = await fetch(path);
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
  try {
    setStatus("Connecte");
    const [settings, products, tables, orders, stats] = await Promise.all([
      api.get("/api/settings"),
      api.get("/api/products"),
      api.get("/api/tables"),
      api.get("/api/orders"),
      api.get("/api/stats"),
    ]);
    state.settings = settings;
    state.products = products;
    state.tables = tables;
    state.orders = orders;
    state.stats = stats;
    renderAll();
  } catch (error) {
    setStatus(`Erreur: ${error.message}`);
  }
}

function renderAll() {
  renderSettings();
  renderStats();
  renderProducts();
  renderTables();
  renderOrders();
}

function renderSettings() {
  document.getElementById("establishmentName").value = state.settings.establishmentName || "La Passion";
  document.getElementById("establishmentAddress").value = state.settings.address || "";
  document.getElementById("happyHourPercent").value = state.settings.terraceHappyHourPercent ?? 10;
}

function renderStats() {
  const container = document.getElementById("statsCards");
  const cards = [
    ["Commandes", state.stats.totalOrders ?? 0],
    ["Chiffre d'affaires", `${state.stats.totalRevenue ?? 0} XOF`],
    ["Produits actifs", state.stats.activeProducts ?? 0],
    ["Tables libres", state.stats.freeTables ?? 0],
    ["Cuisine en attente", state.stats.kitchenPending ?? 0],
    ["Cuisine prête", state.stats.kitchenReady ?? 0],
  ];

  container.innerHTML = cards
    .map(([label, value]) => `<div class="card"><strong>${label}</strong><span>${value}</span></div>`)
    .join("");
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
          <td><button type="button" data-delete-product="${index}">Supprimer</button></td>
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
        <div class="table-card">
          <strong>${table.id}</strong>
          <div style="margin-top:10px">
            <select data-table-index="${index}">
              <option value="free" ${table.status === "free" ? "selected" : ""}>Libre</option>
              <option value="occupied" ${table.status === "occupied" ? "selected" : ""}>Occupee</option>
              <option value="reserved" ${table.status === "reserved" ? "selected" : ""}>Reservee</option>
            </select>
          </div>
        </div>
      `
    )
    .join("");
}

function renderOrders() {
  const list = document.getElementById("ordersList");
  list.innerHTML = state.orders.length
    ? state.orders
        .slice(0, 10)
        .map(
          (order) => `
            <div class="order-card">
              <div class="panel-head">
                <strong>${order.source === "restaurant" ? "Restaurant" : "Terrasse"}</strong>
                <span class="pill">${order.status || "pending"}</span>
              </div>
              <div>${order.tableId ? `Table: ${order.tableId}` : "Service terrasse"}</div>
              <div>Paiement: ${order.paymentMethod || "Paiement"}</div>
              <div>Total: ${order.total} XOF</div>
              <div>Date: ${order.printedAt || order.createdAt}</div>
            </div>
          `
        )
        .join("")
    : `<div class="order-card">Aucune commande synchronisee.</div>`;
}

async function refreshOrdersAndStats() {
  try {
    const [orders, stats] = await Promise.all([api.get("/api/orders"), api.get("/api/stats")]);
    state.orders = orders;
    state.stats = stats;
    renderStats();
    renderOrders();
    setStatus("Connecte");
  } catch (error) {
    setStatus(`Erreur: ${error.message}`);
  }
}

function wireEvents() {
  document.getElementById("refreshBtn").addEventListener("click", bootstrap);
  document.getElementById("openKitchenBtn").addEventListener("click", () => {
    window.open("/admin/kitchen.html", "_blank");
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    state.settings.establishmentName = document.getElementById("establishmentName").value.trim() || "La Passion";
    state.settings.address = document.getElementById("establishmentAddress").value.trim();
    state.settings.terraceHappyHourPercent = Number(document.getElementById("happyHourPercent").value || 0);
    await api.put("/api/settings", { settings: state.settings });
    setStatus("Parametres sauvegardes");
    bootstrap();
  });

  document.getElementById("addProductBtn").addEventListener("click", () => {
    const name = document.getElementById("newProductName").value.trim();
    const price = Number(document.getElementById("newProductPrice").value || 0);
    const category = document.getElementById("newProductCategory").value;
    if (!name || price <= 0) return;
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
    bootstrap();
  });

  document.getElementById("saveTablesBtn").addEventListener("click", async () => {
    state.tables = Array.from(document.querySelectorAll("[data-table-index]")).map((input, index) => ({
      id: state.tables[index].id,
      status: input.value,
    }));
    await api.put("/api/tables", { tables: state.tables });
    setStatus("Tables sauvegardees");
    bootstrap();
  });
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

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

wireEvents();
bootstrap();
startPolling();
