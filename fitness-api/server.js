import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const root = fileURLToPath(new URL("..", import.meta.url));
const siteRoot = join(root, "fitness-saas");
const dataDir = join(root, "fitness-api", "data");
const dbPath = join(dataDir, "fitness.sqlite");
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function normalizeState(state) {
  return {
    activeUserId: state.activeUserId || "",
    selectedPeriod: state.selectedPeriod || "week",
    groupPeriod: state.groupPeriod || "week",
    groupName: state.groupName || "我的燃脂小组",
    currentChallenge: state.currentChallenge || "",
    completedChallenges: state.completedChallenges || {},
    users: state.users || [],
    body: state.body || [],
    foods: state.foods || [],
    workouts: state.workouts || []
  };
}

function createSqliteStore() {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '成员',
      avatar TEXT,
      in_group INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS body_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      bmr INTEGER NOT NULL,
      weight REAL,
      body_fat REAL,
      waist REAL,
      note TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS food_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      calories INTEGER NOT NULL,
      meal TEXT,
      photo TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workout_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      activity TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      calories INTEGER NOT NULL,
      photo TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS challenge_records (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      challenge TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const getMeta = (key, fallback = "") => db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key)?.value ?? fallback;
  const setMeta = (key, value) => {
    db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  };

  return {
    type: "sqlite",
    label: dbPath,
    async loadState() {
      const users = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all().map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        avatar: row.avatar || "",
        group: Boolean(row.in_group)
      }));

      const body = db.prepare("SELECT * FROM body_records ORDER BY date ASC, id ASC").all().map((row) => ({
        userId: row.user_id,
        date: row.date,
        bmr: row.bmr,
        weight: row.weight ?? "",
        bodyFat: row.body_fat ?? "",
        waist: row.waist ?? "",
        note: row.note || ""
      }));

      const foods = db.prepare("SELECT * FROM food_records ORDER BY date ASC, id ASC").all().map((row) => ({
        userId: row.user_id,
        date: row.date,
        name: row.name,
        calories: row.calories,
        meal: row.meal || "",
        photo: row.photo || ""
      }));

      const workouts = db.prepare("SELECT * FROM workout_records ORDER BY date ASC, id ASC").all().map((row) => ({
        userId: row.user_id,
        date: row.date,
        activity: row.activity,
        minutes: row.minutes,
        calories: row.calories,
        photo: row.photo || ""
      }));

      const completedChallenges = {};
      db.prepare("SELECT * FROM challenge_records").all().forEach((row) => {
        completedChallenges[`${row.user_id}:${row.date}`] = row.challenge;
      });

      return normalizeState({
        activeUserId: getMeta("activeUserId", users[0]?.id || ""),
        selectedPeriod: getMeta("selectedPeriod", "week"),
        groupPeriod: getMeta("groupPeriod", "week"),
        groupName: getMeta("groupName", "我的燃脂小组"),
        currentChallenge: getMeta("currentChallenge", ""),
        completedChallenges,
        users,
        body,
        foods,
        workouts
      });
    },
    async saveState(input) {
      const state = normalizeState(input);
      db.exec("BEGIN");
      try {
        db.exec(`
          DELETE FROM challenge_records;
          DELETE FROM workout_records;
          DELETE FROM food_records;
          DELETE FROM body_records;
          DELETE FROM users;
        `);

        const insertUser = db.prepare("INSERT INTO users (id, name, role, avatar, in_group) VALUES (?, ?, ?, ?, ?)");
        for (const user of state.users) {
          insertUser.run(user.id, user.name, user.role || "成员", user.avatar || "", user.group ? 1 : 0);
        }

        const insertBody = db.prepare("INSERT INTO body_records (user_id, date, bmr, weight, body_fat, waist, note) VALUES (?, ?, ?, ?, ?, ?, ?)");
        for (const item of state.body) {
          insertBody.run(item.userId, item.date, Number(item.bmr || 0), item.weight || null, item.bodyFat || null, item.waist || null, item.note || "");
        }

        const insertFood = db.prepare("INSERT INTO food_records (user_id, date, name, calories, meal, photo) VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of state.foods) {
          insertFood.run(item.userId, item.date, item.name || "未命名食物", Number(item.calories || 0), item.meal || "", item.photo || "");
        }

        const insertWorkout = db.prepare("INSERT INTO workout_records (user_id, date, activity, minutes, calories, photo) VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of state.workouts) {
          insertWorkout.run(item.userId, item.date, item.activity || "自定义运动", Number(item.minutes || 0), Number(item.calories || 0), item.photo || "");
        }

        const insertChallenge = db.prepare("INSERT INTO challenge_records (user_id, date, challenge) VALUES (?, ?, ?)");
        for (const [key, challenge] of Object.entries(state.completedChallenges)) {
          const [userId, date] = key.split(":");
          if (userId && date && challenge) insertChallenge.run(userId, date, challenge);
        }

        setMeta("activeUserId", state.activeUserId);
        setMeta("selectedPeriod", state.selectedPeriod);
        setMeta("groupPeriod", state.groupPeriod);
        setMeta("groupName", state.groupName);
        setMeta("currentChallenge", state.currentChallenge);

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

async function createPostgresStore() {
  const connectionString = process.env.DATABASE_URL;
  const localDatabase = /localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: localDatabase || process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '成员',
      avatar TEXT,
      in_group BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS body_records (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      bmr INTEGER NOT NULL,
      weight DOUBLE PRECISION,
      body_fat DOUBLE PRECISION,
      waist DOUBLE PRECISION,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS food_records (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      calories INTEGER NOT NULL,
      meal TEXT,
      photo TEXT
    );

    CREATE TABLE IF NOT EXISTS workout_records (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      activity TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      calories INTEGER NOT NULL,
      photo TEXT
    );

    CREATE TABLE IF NOT EXISTS challenge_records (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      challenge TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const getMeta = async (key, fallback = "") => {
    const result = await pool.query("SELECT value FROM app_meta WHERE key = $1", [key]);
    return result.rows[0]?.value ?? fallback;
  };

  const setMeta = (client, key, value) => client.query(`
    INSERT INTO app_meta (key, value)
    VALUES ($1, $2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, value]);

  return {
    type: "postgres",
    label: "DATABASE_URL",
    async loadState() {
      const [userRows, bodyRows, foodRows, workoutRows, challengeRows] = await Promise.all([
        pool.query("SELECT * FROM users ORDER BY created_at ASC"),
        pool.query("SELECT * FROM body_records ORDER BY date ASC, id ASC"),
        pool.query("SELECT * FROM food_records ORDER BY date ASC, id ASC"),
        pool.query("SELECT * FROM workout_records ORDER BY date ASC, id ASC"),
        pool.query("SELECT * FROM challenge_records")
      ]);

      const users = userRows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        avatar: row.avatar || "",
        group: Boolean(row.in_group)
      }));

      const completedChallenges = {};
      challengeRows.rows.forEach((row) => {
        completedChallenges[`${row.user_id}:${row.date}`] = row.challenge;
      });

      return normalizeState({
        activeUserId: await getMeta("activeUserId", users[0]?.id || ""),
        selectedPeriod: await getMeta("selectedPeriod", "week"),
        groupPeriod: await getMeta("groupPeriod", "week"),
        groupName: await getMeta("groupName", "我的燃脂小组"),
        currentChallenge: await getMeta("currentChallenge", ""),
        completedChallenges,
        users,
        body: bodyRows.rows.map((row) => ({
          userId: row.user_id,
          date: row.date,
          bmr: row.bmr,
          weight: row.weight ?? "",
          bodyFat: row.body_fat ?? "",
          waist: row.waist ?? "",
          note: row.note || ""
        })),
        foods: foodRows.rows.map((row) => ({
          userId: row.user_id,
          date: row.date,
          name: row.name,
          calories: row.calories,
          meal: row.meal || "",
          photo: row.photo || ""
        })),
        workouts: workoutRows.rows.map((row) => ({
          userId: row.user_id,
          date: row.date,
          activity: row.activity,
          minutes: row.minutes,
          calories: row.calories,
          photo: row.photo || ""
        }))
      });
    },
    async saveState(input) {
      const state = normalizeState(input);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM challenge_records");
        await client.query("DELETE FROM workout_records");
        await client.query("DELETE FROM food_records");
        await client.query("DELETE FROM body_records");
        await client.query("DELETE FROM users");

        for (const user of state.users) {
          await client.query("INSERT INTO users (id, name, role, avatar, in_group) VALUES ($1, $2, $3, $4, $5)", [
            user.id,
            user.name,
            user.role || "成员",
            user.avatar || "",
            Boolean(user.group)
          ]);
        }

        for (const item of state.body) {
          await client.query("INSERT INTO body_records (user_id, date, bmr, weight, body_fat, waist, note) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
            item.userId,
            item.date,
            Number(item.bmr || 0),
            item.weight || null,
            item.bodyFat || null,
            item.waist || null,
            item.note || ""
          ]);
        }

        for (const item of state.foods) {
          await client.query("INSERT INTO food_records (user_id, date, name, calories, meal, photo) VALUES ($1, $2, $3, $4, $5, $6)", [
            item.userId,
            item.date,
            item.name || "未命名食物",
            Number(item.calories || 0),
            item.meal || "",
            item.photo || ""
          ]);
        }

        for (const item of state.workouts) {
          await client.query("INSERT INTO workout_records (user_id, date, activity, minutes, calories, photo) VALUES ($1, $2, $3, $4, $5, $6)", [
            item.userId,
            item.date,
            item.activity || "自定义运动",
            Number(item.minutes || 0),
            Number(item.calories || 0),
            item.photo || ""
          ]);
        }

        for (const [key, challenge] of Object.entries(state.completedChallenges)) {
          const [userId, date] = key.split(":");
          if (userId && date && challenge) {
            await client.query("INSERT INTO challenge_records (user_id, date, challenge) VALUES ($1, $2, $3)", [userId, date, challenge]);
          }
        }

        await setMeta(client, "activeUserId", state.activeUserId);
        await setMeta(client, "selectedPeriod", state.selectedPeriod);
        await setMeta(client, "groupPeriod", state.groupPeriod);
        await setMeta(client, "groupName", state.groupName);
        await setMeta(client, "currentChallenge", state.currentChallenge);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requested = normalize(join(siteRoot, pathname));
  if (!requested.startsWith(siteRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const file = existsSync(requested) ? requested : join(siteRoot, "index.html");
  const ext = extname(file);
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream"
  });
  res.end(readFileSync(file));
}

const store = process.env.DATABASE_URL ? await createPostgresStore() : createSqliteStore();

createServer(async (req, res) => {
  try {
    if (req.url === "/api/health") {
      sendJson(res, 200, { ok: true, database: store.type, target: store.label });
      return;
    }

    if (req.url === "/api/state" && req.method === "GET") {
      sendJson(res, 200, await store.loadState());
      return;
    }

    if (req.url === "/api/state" && req.method === "POST") {
      await store.saveState(await readJson(req));
      sendJson(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}).listen(port, host, () => {
  const urlHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`FitRank server running at http://${urlHost}:${port}`);
  console.log(`Database: ${store.type} (${store.label})`);
});
