function createDefaultDb() {
  const now = new Date().toISOString();
  return {
    settings: {
      establishmentName: "La Passion",
      address: "L'avenue des aviation Q/ Gare-centrale C/ Gombe",
      currency: "CDF",
      terraceHappyHourPercent: 10,
      printerFooter: "Merci pour votre visite",
      updatedAt: now,
    },
    products: [
      { id: "p1", name: "Eau minerale", price: 500, category: "drink", active: true },
      { id: "p2", name: "Soda", price: 1000, category: "drink", active: true },
      { id: "p3", name: "Cafe", price: 1000, category: "drink", active: true },
      { id: "p4", name: "Sandwich", price: 2500, category: "food", active: true },
      { id: "p5", name: "Jus", price: 1500, category: "drink", active: true },
      { id: "p6", name: "Pain", price: 300, category: "food", active: true },
    ],
    tables: [
      { id: "T1", status: "free" },
      { id: "T2", status: "occupied" },
      { id: "T3", status: "reserved" },
      { id: "T4", status: "free" },
      { id: "T5", status: "free" },
      { id: "T6", status: "occupied" },
    ],
    users: [
      { id: "u1", name: "Admin", role: "admin", pin: "0000" },
      { id: "u2", name: "Serveur 1", role: "serveur", pin: "1234" },
      { id: "u3", name: "Cuisine", role: "kitchen", pin: "2222" },
    ],
    orders: [],
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

function sanitizeUsers(users) {
  return (users || []).map(({ pin, ...user }) => user);
}

function buildStats(db) {
  const totalRevenue = (db.orders || []).reduce((sum, order) => sum + Number(order.total || 0), 0);
  const byPaymentMethod = {};
  const revenueByPaymentMethod = {};
  const topProducts = {};
  const bySource = { restaurant: 0, terrace: 0 };
  const revenueBySource = { restaurant: 0, terrace: 0 };
  const dailyTotals = {};
  let totalDiscounts = 0;

  (db.orders || []).forEach((order) => {
    const paymentMethod = order.paymentMethod || "Inconnu";
    byPaymentMethod[paymentMethod] = (byPaymentMethod[paymentMethod] || 0) + 1;
    revenueByPaymentMethod[paymentMethod] = (revenueByPaymentMethod[paymentMethod] || 0) + Number(order.total || 0);
    const source = order.source === "terrace" ? "terrace" : "restaurant";
    bySource[source] = (bySource[source] || 0) + 1;
    revenueBySource[source] = (revenueBySource[source] || 0) + Number(order.total || 0);
    totalDiscounts += Number(order.manualDiscount || 0) + Number(order.happyHourDiscount || 0);
    const bucket = String(order.printedAt || order.createdAt || "").slice(0, 10) || "Inconnu";
    dailyTotals[bucket] = (dailyTotals[bucket] || 0) + Number(order.total || 0);
    (order.items || []).forEach((item) => {
      topProducts[item.name] = (topProducts[item.name] || 0) + Number(item.quantity || 0);
    });
  });

  return {
    totalOrders: (db.orders || []).length,
    totalRevenue,
    byPaymentMethod,
    revenueByPaymentMethod,
    bySource,
    revenueBySource,
    totalDiscounts,
    dailyTotals: Object.entries(dailyTotals)
      .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
      .slice(0, 7)
      .map(([date, total]) => ({ date, total })),
    topProducts: Object.entries(topProducts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity })),
    activeProducts: (db.products || []).filter((product) => product.active).length,
    freeTables: (db.tables || []).filter((table) => table.status === "free").length,
    kitchenPending: (db.orders || []).filter((order) => order.status === "pending").length,
    kitchenReady: (db.orders || []).filter((order) => order.status === "ready").length,
  };
}

function buildKitchenSummary(db, tableId) {
  const restaurantOrders = (db.orders || []).filter((order) => order.source === "restaurant");
  const relevantOrders = tableId
    ? restaurantOrders.filter((order) => order.tableId === tableId)
    : restaurantOrders;
  const latest = relevantOrders[0] || null;

  return {
    pendingCount: restaurantOrders.filter((order) => order.status === "pending").length,
    preparingCount: restaurantOrders.filter((order) => order.status === "preparing").length,
    readyCount: restaurantOrders.filter((order) => order.status === "ready").length,
    latestTableStatus: latest ? latest.status : null,
    latestTableOrderId: latest ? latest.id : null,
  };
}

module.exports = {
  buildKitchenSummary,
  buildStats,
  createDefaultDb,
  sanitizeUsers,
};
