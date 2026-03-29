const kitchenApi = {
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

if (!window.localStorage.getItem("la_passion_admin_session")) {
  window.location.href = "/admin/";
}

async function loadKitchen() {
  try {
    const orders = await kitchenApi.get("/api/orders");
    const restaurantOrders = orders
      .filter((order) => order.source === "restaurant")
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

    renderKitchenStats(restaurantOrders);
    renderKitchenColumns(restaurantOrders);
    setKitchenStatus("Cuisine connectee");
    document.getElementById("kitchenRefreshView").textContent = new Date().toLocaleString("fr-FR");
  } catch (error) {
    setKitchenStatus(`Erreur: ${error.message}`);
  }
}

function renderKitchenStats(orders) {
  const cards = [
    ["En attente", orders.filter((order) => order.status === "pending").length],
    ["En preparation", orders.filter((order) => order.status === "preparing").length],
    ["Pretes", orders.filter((order) => order.status === "ready").length],
    ["Servies", orders.filter((order) => order.status === "served").length],
    ["Commandes salle", orders.length],
    ["CA salle", formatMoney(orders.reduce((sum, order) => sum + Number(order.total || 0), 0))],
  ];

  document.getElementById("kitchenStatsCards").innerHTML = cards
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

function renderKitchenColumns(orders) {
  const columns = [
    ["pending", "En attente"],
    ["preparing", "En preparation"],
    ["ready", "Pretes"],
    ["served", "Servies"],
  ];

  document.getElementById("kitchenColumns").innerHTML = columns
    .map(([status, label]) => {
      const items = orders.filter((order) => normalizeStatus(order.status) === status);
      const content = items.length
        ? items.map((order) => renderKitchenCard(order)).join("")
        : `<div class="empty-state">Aucune commande ${label.toLowerCase()}.</div>`;

      return `
        <section class="kitchen-column">
          <h3>${label}</h3>
          <div class="kitchen-stack">${content}</div>
        </section>
      `;
    })
    .join("");

  document.querySelectorAll("[data-order-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await kitchenApi.put(`/api/orders/${button.dataset.orderId}`, {
        status: button.dataset.status,
      });
      await loadKitchen();
    });
  });
}

function renderKitchenCard(order) {
  const nextActions = kitchenActionsFor(order.status, order.id);
  return `
    <article class="order-card">
      <header>
        <div>
          <strong>${order.tableId || "Salle"}</strong>
          <div class="order-meta">
            <span>${order.printedAt || order.createdAt || "-"}</span>
            <span>${formatMoney(order.total || 0)}</span>
          </div>
        </div>
        <span class="pill ${normalizeStatus(order.status)}">${labelForStatus(order.status)}</span>
      </header>
      <div class="items-list">
        ${(order.items || []).map((item) => `<div>${item.quantity} x ${escapeHtml(item.name)}</div>`).join("")}
      </div>
      <div class="status-row">${nextActions}</div>
    </article>
  `;
}

function kitchenActionsFor(status, orderId) {
  switch (normalizeStatus(status)) {
    case "pending":
      return `<button class="status-action" data-order-id="${orderId}" data-status="preparing">Demarrer</button>`;
    case "preparing":
      return `<button class="status-action" data-order-id="${orderId}" data-status="ready">Marquer prete</button>`;
    case "ready":
      return `<button class="status-action" data-order-id="${orderId}" data-status="served">Marquer servie</button>`;
    default:
      return `<span class="pill served">Terminee</span>`;
  }
}

function normalizeStatus(status) {
  return status || "pending";
}

function labelForStatus(status) {
  switch (normalizeStatus(status)) {
    case "preparing":
      return "En preparation";
    case "ready":
      return "Prete";
    case "served":
      return "Servie";
    default:
      return "En attente";
  }
}

function setKitchenStatus(text) {
  document.getElementById("kitchenStatusBadge").textContent = text;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("fr-FR")} CDF`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.getElementById("refreshKitchenBtn").addEventListener("click", loadKitchen);
loadKitchen();
setInterval(loadKitchen, 5000);
