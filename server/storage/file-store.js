const fs = require("fs");
const path = require("path");
const {
  buildKitchenSummary,
  buildStats,
  createDefaultDb,
  sanitizeUsers,
} = require("./default-data");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function createFileStore() {
  return {
    mode: "file",
    async init() {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(createDefaultDb(), null, 2));
      }
    },
    async getBootstrapData() {
      const db = readDb();
      return {
        settings: db.settings,
        products: db.products,
        tables: db.tables,
        users: sanitizeUsers(db.users),
      };
    },
    async exportSnapshot() {
      return readDb();
    },
    async importSnapshot(snapshot) {
      assertWritable();
      const nextDb = {
        ...createDefaultDb(),
        ...snapshot,
        settings: {
          ...createDefaultDb().settings,
          ...(snapshot.settings || {}),
        },
        products: Array.isArray(snapshot.products) ? snapshot.products : createDefaultDb().products,
        tables: Array.isArray(snapshot.tables) ? snapshot.tables : createDefaultDb().tables,
        users: Array.isArray(snapshot.users) ? snapshot.users : createDefaultDb().users,
        orders: Array.isArray(snapshot.orders) ? snapshot.orders : [],
        meta: {
          ...(createDefaultDb().meta || {}),
          ...(snapshot.meta || {}),
          updatedAt: new Date().toISOString(),
        },
      };
      writeDb(nextDb);
      return nextDb;
    },
    async getProducts() {
      return readDb().products;
    },
    async getUsers() {
      return sanitizeUsers(readDb().users);
    },
    async authenticateUser(name, pin) {
      const user = readDb().users.find(
        (item) =>
          item.name.toLowerCase() === String(name || "").trim().toLowerCase() &&
          String(item.pin || "") === String(pin || "")
      );
      if (!user) {
        return null;
      }
      const { pin: hiddenPin, ...sanitized } = user;
      return sanitized;
    },
    async setProducts(products) {
      assertWritable();
      const db = readDb();
      db.products = products;
      touch(db);
      writeDb(db);
    },
    async getTables() {
      return readDb().tables;
    },
    async setTables(tables) {
      assertWritable();
      const db = readDb();
      db.tables = tables;
      touch(db);
      writeDb(db);
    },
    async getSettings() {
      return readDb().settings;
    },
    async updateSettings(nextSettings) {
      assertWritable();
      const db = readDb();
      db.settings = {
        ...db.settings,
        ...nextSettings,
        updatedAt: new Date().toISOString(),
      };
      touch(db);
      writeDb(db);
      return db.settings;
    },
    async getOrders() {
      return readDb().orders;
    },
    async createOrder(order) {
      assertWritable();
      const db = readDb();
      db.orders.unshift(order);
      touch(db);
      writeDb(db);
      return order;
    },
    async updateOrderStatus(orderId, status) {
      assertWritable();
      const db = readDb();
      const order = db.orders.find((item) => item.id === orderId);
      if (!order) {
        return null;
      }
      order.status = status || order.status;
      order.updatedAt = new Date().toISOString();
      touch(db);
      writeDb(db);
      return order;
    },
    async getKitchenSummary(tableId) {
      return buildKitchenSummary(readDb(), tableId);
    },
    async getStats() {
      return buildStats(readDb());
    },
  };
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function touch(db) {
  db.meta = {
    ...(db.meta || {}),
    updatedAt: new Date().toISOString(),
  };
}

function assertWritable() {
  if (process.env.VERCEL && !process.env.ALLOW_FILE_DB_ON_VERCEL) {
    throw new Error(
      "Cette instance Vercel n'a pas encore de DATABASE_URL. Configurez une base Postgres distante avant d'utiliser les endpoints d'ecriture."
    );
  }
}

module.exports = {
  createFileStore,
};
