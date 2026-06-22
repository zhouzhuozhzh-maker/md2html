import { get, put } from "@vercel/blob";
import pg from "pg";

const { Pool } = pg;

const statePath = "fitrank/state.json";
const stateRowId = "fitrank-state";

const emptyState = {
  activeUserId: "",
  selectedPeriod: "week",
  groupPeriod: "week",
  groupName: "我的燃脂小组",
  currentChallenge: "",
  currentChallenges: {},
  completedChallenges: {},
  groupMemberIds: [],
  groupRequests: [],
  users: [],
  body: [],
  foods: [],
  workouts: []
};

function normalizeState(state = {}) {
  return {
    ...emptyState,
    ...state,
    currentChallenges: isPlainObject(state.currentChallenges) ? state.currentChallenges : {},
    completedChallenges: isPlainObject(state.completedChallenges) ? state.completedChallenges : {},
    groupMemberIds: Array.isArray(state.groupMemberIds) ? [...new Set(state.groupMemberIds.filter(Boolean))] : [],
    groupRequests: normalizeGroupRequests(state.groupRequests),
    users: Array.isArray(state.users) ? state.users : [],
    body: Array.isArray(state.body) ? state.body : [],
    foods: Array.isArray(state.foods) ? state.foods : [],
    workouts: Array.isArray(state.workouts) ? state.workouts : []
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGroupRequests(value) {
  if (!Array.isArray(value)) return [];
  return value.map((request, index) => ({
    id: request.id || `group-request-${index}`,
    type: request.type || "invite",
    fromUserId: request.fromUserId || "",
    toUserId: request.toUserId || "",
    status: request.status || "pending",
    createdAt: request.createdAt || new Date().toISOString().slice(0, 10)
  }));
}

function isNetlifyResponse(value) {
  return value && typeof value === "object" && !("status" in value && "json" in value);
}

function requestMethod(request) {
  return request.method || request.httpMethod || "GET";
}

async function readJsonBody(request) {
  if (request && typeof request.body === "string") {
    if (!request.body) return {};
    if (request.isBase64Encoded) {
      return JSON.parse(Buffer.from(request.body, "base64").toString("utf8"));
    }
    return JSON.parse(request.body);
  }

  return request.body || {};
}

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function postgresAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

function postgresSslOptions() {
  const url = process.env.DATABASE_URL || "";
  const localDatabase = /localhost|127\.0\.0\.1|::1/.test(url);
  return localDatabase || process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };
}

let pool;

function getPool() {
  if (!postgresAvailable()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: postgresSslOptions()
    });
  }
  return pool;
}

async function ensurePostgresSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readBlobState() {
  if (!blobAvailable()) return null;

  try {
    const result = await get(statePath, { access: "private" });
    if (!result || result.statusCode === 404) return null;
    const text = await readStream(result.stream);
    return normalizeState(JSON.parse(text));
  } catch (error) {
    if (error.status === 404 || error.statusCode === 404 || /not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function saveBlobState(state) {
  if (!blobAvailable()) return;
  await put(statePath, JSON.stringify(normalizeState(state)), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });
}

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function readPostgresState() {
  const db = getPool();
  if (!db) return null;

  const client = await db.connect();
  try {
    await ensurePostgresSchema(client);
    const result = await client.query("SELECT payload FROM app_state WHERE id = $1", [stateRowId]);
    if (result.rowCount > 0) {
      return normalizeState(result.rows[0].payload);
    }

    const legacyBlobState = await readBlobState();
    if (legacyBlobState) {
      await client.query(
        `INSERT INTO app_state (id, payload)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [stateRowId, JSON.stringify(legacyBlobState)]
      );
      return legacyBlobState;
    }

    return null;
  } finally {
    client.release();
  }
}

async function savePostgresState(state) {
  const db = getPool();
  if (!db) return false;

  const client = await db.connect();
  try {
    await ensurePostgresSchema(client);
    await client.query(
      `INSERT INTO app_state (id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [stateRowId, JSON.stringify(normalizeState(state))]
    );
    return true;
  } finally {
    client.release();
  }
}

async function loadState() {
  if (postgresAvailable()) {
    try {
      const dbState = await readPostgresState();
      if (dbState) return dbState;
    } catch {
      // Fall back to blob-backed state during migration or if Postgres is unavailable.
    }
  }

  const blobState = await readBlobState();
  if (blobState) return blobState;

  return emptyState;
}

async function saveState(state) {
  const normalized = normalizeState(state);
  if (postgresAvailable()) {
    try {
      await savePostgresState(normalized);
    } catch {
      // Keep the site usable while the database connection is being migrated.
    }
  }
  if (blobAvailable()) {
    await saveBlobState(normalized);
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export default async function handler(request) {
  try {
    const method = requestMethod(request);

    if (method === "GET") {
      return jsonResponse(200, await loadState());
    }

    if (method === "POST") {
      const body = await readJsonBody(request);
      await saveState(body || {});
      return jsonResponse(200, { ok: true, storage: postgresAvailable() ? "postgres" : "blob" });
    }

    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error.message });
  }
}
