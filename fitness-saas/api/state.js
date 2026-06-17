import { get, put } from "@vercel/blob";

const statePath = "fitrank/state.json";

const emptyState = {
  activeUserId: "",
  selectedPeriod: "week",
  groupPeriod: "week",
  groupName: "我的燃脂小组",
  currentChallenge: "",
  completedChallenges: {},
  users: [],
  body: [],
  foods: [],
  workouts: []
};

function sendJson(response, status, payload) {
  response.status(status).setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.json(payload);
}

function normalizeState(state = {}) {
  return {
    ...emptyState,
    ...state,
    completedChallenges: state.completedChallenges || {},
    users: Array.isArray(state.users) ? state.users : [],
    body: Array.isArray(state.body) ? state.body : [],
    foods: Array.isArray(state.foods) ? state.foods : [],
    workouts: Array.isArray(state.workouts) ? state.workouts : []
  };
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
    if (request.method === "GET") {
      sendJson(response, 200, await loadState());
      return;
    }

    if (request.method === "POST") {
      await saveState(request.body || {});
      sendJson(response, 200, { ok: true });
      return;
    }

    response.setHeader("allow", "GET, POST");
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
}
