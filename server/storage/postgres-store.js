const { Pool } = require("pg");
const {
  buildKitchenSummary,
  buildStats,
  createDefaultDb,
  sanitizeUsers,
} = require("./default-data");

function createPostgresStore() {
  const connectionString =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for postgres storage");
  }

  const pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  });

  return {
    mode: "postgres",
    async init() {
      await pool.query(`
        create table if not exists app_settings (
          singleton_key text primary key,
          payload jsonb not null
        );

        create table if not exists products (
          id text primary key,
          name text not null,
          price integer not null default 0,
          category text not null default 'misc',
          active boolean not null default true,
          payload jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists dining_tables (
          id text primary key,
          status text not null default 'free',
          payload jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists app_users (
          id text primary key,
          name text not null,
          role text not null,
          pin text not null,
          payload jsonb not null,
          updated_at timestamptz not null default now()
        );

        create table if not exists orders (
          id text primary key,
          source text,
          table_id text,
          payment_method text,
          total numeric not null default 0,
          status text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz,
          items jsonb not null default '[]'::jsonb,
          payload jsonb not null
        );
      `);

      const defaults = createDefaultDb();
      await pool.query(
        `
          insert into app_settings (singleton_key, payload)
          values ('main', $1::jsonb)
          on conflict (singleton_key) do nothing
        `,
        [JSON.stringify(defaults.settings)]
      );

      await seedPayloadTableIfEmpty("products", defaults.products);
      await seedPayloadTableIfEmpty("dining_tables", defaults.tables);
      await seedPayloadTableIfEmpty("app_users", defaults.users);
    },
    async getBootstrapData() {
      const snapshot = await getSnapshot();
      return {
        settings: snapshot.settings,
        products: snapshot.products,
        tables: snapshot.tables,
        users: sanitizeUsers(snapshot.users),
      };
    },
    async exportSnapshot() {
      return getSnapshot();
    },
    async importSnapshot(snapshot) {
      const defaults = createDefaultDb();
      const nextSettings = {
        ...defaults.settings,
        ...(snapshot.settings || {}),
        updatedAt: new Date().toISOString(),
      };

      await pool.query(
        `
          insert into app_settings (singleton_key, payload)
          values ('main', $1::jsonb)
          on conflict (singleton_key) do update set payload = excluded.payload
        `,
        [JSON.stringify(nextSettings)]
      );

      await replacePayloadTable("products", Array.isArray(snapshot.products) ? snapshot.products : defaults.products);
      await replacePayloadTable("dining_tables", Array.isArray(snapshot.tables) ? snapshot.tables : defaults.tables);
      await replacePayloadTable("app_users", Array.isArray(snapshot.users) ? snapshot.users : defaults.users);
      await replaceOrders(Array.isArray(snapshot.orders) ? snapshot.orders : []);

      return {
        settings: nextSettings,
        products: Array.isArray(snapshot.products) ? snapshot.products : defaults.products,
        tables: Array.isArray(snapshot.tables) ? snapshot.tables : defaults.tables,
        users: Array.isArray(snapshot.users) ? snapshot.users : defaults.users,
        orders: Array.isArray(snapshot.orders) ? snapshot.orders : [],
      };
    },
    async getProducts() {
      return (await getSnapshot()).products;
    },
    async setProducts(products) {
      await replacePayloadTable("products", products);
    },
    async getTables() {
      return (await getSnapshot()).tables;
    },
    async setTables(tables) {
      await replacePayloadTable("dining_tables", tables);
    },
    async getSettings() {
      return (await getSnapshot()).settings;
    },
    async updateSettings(nextSettings) {
      const current = await getSettings();
      const merged = {
        ...current,
        ...nextSettings,
        updatedAt: new Date().toISOString(),
      };
      await pool.query(
        `
          insert into app_settings (singleton_key, payload)
          values ('main', $1::jsonb)
          on conflict (singleton_key) do update set payload = excluded.payload
        `,
        [JSON.stringify(merged)]
      );
      return merged;
    },
    async getOrders() {
      return (await getSnapshot()).orders;
    },
    async createOrder(order) {
      await pool.query(
        `
          insert into orders (
            id, source, table_id, payment_method, total, status, created_at, updated_at, items, payload
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        `,
        [
          order.id,
          order.source || null,
          order.tableId || null,
          order.paymentMethod || null,
          Number(order.total || 0),
          order.status || "pending",
          order.createdAt || new Date().toISOString(),
          order.updatedAt || null,
          JSON.stringify(order.items || []),
          JSON.stringify(order),
        ]
      );
      return order;
    },
    async updateOrderStatus(orderId, status) {
      const current = await fetchOrder(orderId);
      if (!current) {
        return null;
      }
      const nextOrder = {
        ...current,
        status: status || current.status,
        updatedAt: new Date().toISOString(),
      };
      await pool.query(
        `
          update orders
          set
            status = $2,
            updated_at = $3,
            payload = $4::jsonb
          where id = $1
        `,
        [orderId, nextOrder.status, nextOrder.updatedAt, JSON.stringify(nextOrder)]
      );
      return nextOrder;
    },
    async getKitchenSummary(tableId) {
      return buildKitchenSummary(await getSnapshot(), tableId);
    },
    async getStats() {
      return buildStats(await getSnapshot());
    },
  };

  async function getSnapshot() {
    const [settings, products, tables, users, orders] = await Promise.all([
      getSettings(),
      selectPayloadArray("products"),
      selectPayloadArray("dining_tables"),
      selectPayloadArray("app_users"),
      selectOrders(),
    ]);

    return {
      settings,
      products,
      tables,
      users,
      orders,
    };
  }

  async function getSettings() {
    const result = await pool.query(
      "select payload from app_settings where singleton_key = 'main' limit 1"
    );
    if (!result.rows[0]) {
      return createDefaultDb().settings;
    }
    return result.rows[0].payload;
  }

  async function selectPayloadArray(tableName) {
    const result = await pool.query(`select payload from ${tableName} order by id asc`);
    return result.rows.map((row) => row.payload);
  }

  async function selectOrders() {
    const result = await pool.query("select payload from orders order by created_at desc");
    return result.rows.map((row) => row.payload);
  }

  async function fetchOrder(orderId) {
    const result = await pool.query("select payload from orders where id = $1 limit 1", [orderId]);
    return result.rows[0] ? result.rows[0].payload : null;
  }

  async function replacePayloadTable(tableName, items) {
    const defaults = createDefaultDb();
    const fallbackItems =
      tableName === "products"
        ? defaults.products
        : tableName === "dining_tables"
          ? defaults.tables
          : defaults.users;
    const rows = Array.isArray(items) && items.length > 0 ? items : fallbackItems;

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from ${tableName}`);
      for (const item of rows) {
        if (tableName === "products") {
          await client.query(
            `
              insert into products (id, name, price, category, active, payload, updated_at)
              values ($1, $2, $3, $4, $5, $6::jsonb, now())
            `,
            [
              item.id,
              item.name || "",
              Number(item.price || 0),
              item.category || "misc",
              item.active !== false,
              JSON.stringify(item),
            ]
          );
        } else if (tableName === "dining_tables") {
          await client.query(
            `
              insert into dining_tables (id, status, payload, updated_at)
              values ($1, $2, $3::jsonb, now())
            `,
            [item.id, item.status || "free", JSON.stringify(item)]
          );
        } else {
          await client.query(
            `
              insert into app_users (id, name, role, pin, payload, updated_at)
              values ($1, $2, $3, $4, $5::jsonb, now())
            `,
            [
              item.id,
              item.name || "",
              item.role || "serveur",
              item.pin || "0000",
              JSON.stringify(item),
            ]
          );
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function seedPayloadTableIfEmpty(tableName, items) {
    const result = await pool.query(`select count(*)::int as count from ${tableName}`);
    if ((result.rows[0]?.count || 0) > 0) {
      return;
    }
    await replacePayloadTable(tableName, items);
  }

  async function replaceOrders(orders) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from orders");
      for (const order of orders) {
        await client.query(
          `
            insert into orders (
              id, source, table_id, payment_method, total, status, created_at, updated_at, items, payload
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
          `,
          [
            order.id,
            order.source || null,
            order.tableId || null,
            order.paymentMethod || null,
            Number(order.total || 0),
            order.status || "pending",
            order.createdAt || new Date().toISOString(),
            order.updatedAt || null,
            JSON.stringify(order.items || []),
            JSON.stringify(order),
          ]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function shouldUseSsl(connectionString) {
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

module.exports = {
  createPostgresStore,
};
