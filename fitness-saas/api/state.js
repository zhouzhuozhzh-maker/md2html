import { get, put } from "@vercel/blob";

const statePath = "fitrank/state.json";

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

function sendJson(response, status, payload) {
  if (isNetlifyResponse(response)) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8"
      }
    });
  }

  response.status(status).setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.json(payload);
  return null;
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

async function loadState() {
  try {
    const result = await get(statePath, { access: "private" });
    if (!result || result.statusCode === 404) return emptyState;
    const text = await readStream(result.stream);
    return normalizeState(JSON.parse(text));
  } catch (error) {
    if (error.status === 404 || error.statusCode === 404 || /not found/i.test(error.message)) {
      return emptyState;
    }
    throw error;
  }
}

async function saveState(state) {
  await put(statePath, JSON.stringify(normalizeState(state)), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });
}

export default async function handler(request, response) {
  try {
    const method = requestMethod(request);

    if (method === "GET") {
      const payload = await loadState();
      const result = sendJson(response, 200, payload);
      if (result) return result;
      return;
    }

    if (method === "POST") {
      const body = await readJsonBody(request);
      await saveState(body || {});
      const result = sendJson(response, 200, { ok: true });
      if (result) return result;
      return;
    }

    if (isNetlifyResponse(response)) {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: {
          allow: "GET, POST",
          "content-type": "application/json; charset=utf-8"
        }
      });
    }

    response.setHeader("allow", "GET, POST");
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    const payload = { ok: false, error: error.message };
    if (isNetlifyResponse(response)) {
      return new Response(JSON.stringify(payload), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
    sendJson(response, 500, payload);
  }
}
