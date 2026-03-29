const { randomUUID } = require("crypto");
const { createStorage } = require("./storage");

function createHandler() {
  const storage = createStorage();
  let initialized = false;

  async function ensureStorage() {
    if (!initialized) {
      await storage.init();
      initialized = true;
    }
  }

  return async function handler(req, res) {
    try {
      await ensureStorage();
      setCors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "la-passion-api",
          storage: storage.mode,
          time: new Date().toISOString(),
        });
      }

      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        return sendJson(res, 200, await storage.getBootstrapData());
      }

      if (url.pathname === "/api/users" && req.method === "GET") {
        return sendJson(res, 200, await storage.getUsers());
      }

      if (url.pathname === "/api/login" && req.method === "POST") {
        const body = await readJsonBody(req);
        const user = await storage.authenticateUser(body.name, body.pin);
        if (!user) {
          return sendJson(res, 401, { error: "Identifiants invalides" });
        }
        return sendJson(res, 200, { ok: true, user });
      }

      if (url.pathname === "/api/products") {
        if (req.method === "GET") {
          return sendJson(res, 200, await storage.getProducts());
        }
        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const products = Array.isArray(body.products) ? body.products : [];
          await storage.setProducts(products);
          return sendJson(res, 200, { ok: true, count: products.length });
        }
      }

      if (url.pathname === "/api/tables") {
        if (req.method === "GET") {
          return sendJson(res, 200, await storage.getTables());
        }
        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const tables = Array.isArray(body.tables) ? body.tables : [];
          await storage.setTables(tables);
          return sendJson(res, 200, { ok: true, count: tables.length });
        }
      }

      if (url.pathname === "/api/settings") {
        if (req.method === "GET") {
          return sendJson(res, 200, await storage.getSettings());
        }
        if (req.method === "PUT") {
          const body = await readJsonBody(req);
          const settings = await storage.updateSettings(body.settings || {});
          return sendJson(res, 200, { ok: true, settings });
        }
      }

      if (url.pathname === "/api/orders") {
        if (req.method === "GET") {
          return sendJson(res, 200, await storage.getOrders());
        }
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const order = {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            status: body.source === "restaurant" ? "pending" : "paid",
            ...body,
          };
          await storage.createOrder(order);
          return sendJson(res, 201, { ok: true, orderId: order.id });
        }
      }

      if (url.pathname.startsWith("/api/orders/") && req.method === "PUT") {
        const orderId = url.pathname.split("/").pop();
        const body = await readJsonBody(req);
        const order = await storage.updateOrderStatus(orderId, body.status);
        if (!order) {
          return sendJson(res, 404, { error: "Order not found" });
        }
        return sendJson(res, 200, { ok: true, order });
      }

      if (url.pathname === "/api/kitchen-summary" && req.method === "GET") {
        const tableId = url.searchParams.get("tableId");
        return sendJson(res, 200, await storage.getKitchenSummary(tableId));
      }

      if (url.pathname === "/api/stats" && req.method === "GET") {
        return sendJson(res, 200, await storage.getStats());
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "Server error" });
    }
  };
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = {
  createHandler,
};
