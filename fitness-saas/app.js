const today = new Date().toISOString().slice(0, 10);
const storageKey = "fitrank-team-state-v5";
const sessionKey = "fitrank-team-session-user";
const legacyStorageKeys = [
  "fitrank-team-state-v4",
  "fitrank-team-state-v3",
  "fitrank-team-state-v2",
  "fitrank-team-state-v1"
];
let backendAvailable = false;
let isHydratingFromBackend = false;
let authMode = "login";

const challenges = [
  "今天把缺口率做到 20% 以上",
  "晚餐把摄入压到基础代谢以下 60%",
  "补 30 分钟运动，把缺口率再抬高一点",
  "今天所有加餐只保留一次，守住缺口",
  "把一顿高热量餐换成轻食，争取提升排名",
  "完成一次 40 分钟有氧，让缺口率突破赛季均值"
];

const state = loadState();
state.activeUserId = loadSessionUserId();
authMode = state.users.length > 0 ? "login" : "register";

function loadState() {
  for (const key of [storageKey, ...legacyStorageKeys]) {
    const stored = localStorage.getItem(key);
    if (stored) return normalizeState(JSON.parse(stored));
  }

  return normalizeState({});
}

function normalizeState(value) {
  const users = Array.isArray(value.users) ? value.users : [];
  const explicitGroupMemberIds = Array.isArray(value.groupMemberIds) ? value.groupMemberIds : [];
  const legacyGroupMemberIds = users.filter((user) => user.group !== false).map((user) => user.id);
  const groupMemberIds = unique(
    (explicitGroupMemberIds.length ? explicitGroupMemberIds : legacyGroupMemberIds).filter((id) =>
      users.some((user) => user.id === id)
    )
  );

  return {
    activeUserId: "",
    selectedPeriod: "week",
    groupPeriod: "week",
    groupName: "我的燃脂小组",
    currentChallenge: "",
    completedChallenges: {},
    users: [],
    body: [],
    foods: [],
    workouts: [],
    ...value,
    users,
    groupMemberIds,
    groupRequests: normalizeGroupRequests(value.groupRequests)
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeGroupRequests(value) {
  if (!Array.isArray(value)) return [];
  return value.map((request, index) => ({
    id: request.id || `group-request-${index}`,
    type: request.type || "invite",
    fromUserId: request.fromUserId || "",
    toUserId: request.toUserId || "",
    status: request.status || "pending",
    createdAt: request.createdAt || today
  }));
}

function loadSessionUserId() {
  return localStorage.getItem(sessionKey) || "";
}

function setSessionUser(userId) {
  state.activeUserId = userId;
  localStorage.setItem(sessionKey, userId);
}

function clearSessionUser() {
  state.activeUserId = "";
  localStorage.removeItem(sessionKey);
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomBase64Url(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bufferToBase64Url(buffer);
}

async function hashPassword(password, salt) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bufferToBase64Url(digest);
}

async function verifyPassword(user, password) {
  if (!user) return false;
  if (user.passwordHash && user.passwordSalt) {
    return (await hashPassword(password, user.passwordSalt)) === user.passwordHash;
  }
  return password === user.id;
}

function isGroupMember(userId) {
  return (state.groupMemberIds || []).includes(userId);
}

function groupMembers() {
  return state.users.filter((user) => isGroupMember(user.id));
}

function pendingRequestsFor(userId) {
  return (state.groupRequests || []).filter(
    (request) => request.status === "pending" && request.toUserId === userId
  );
}

function sentRequestsBy(userId) {
  return (state.groupRequests || []).filter(
    (request) => request.status === "pending" && request.fromUserId === userId
  );
}

function hasPendingRequest(fromUserId, toUserId) {
  return (state.groupRequests || []).some(
    (request) =>
      request.status === "pending" &&
      request.type === "invite" &&
      request.fromUserId === fromUserId &&
      request.toUserId === toUserId
  );
}

function createGroupRequest(type, fromUserId, toUserId) {
  const existing = (state.groupRequests || []).find(
    (request) =>
      request.status === "pending" &&
      request.type === type &&
      request.fromUserId === fromUserId &&
      request.toUserId === toUserId
  );
  if (existing) return existing;

  const request = {
    id: `group-request-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    fromUserId,
    toUserId,
    status: "pending",
    createdAt: today
  };
  state.groupRequests = [...(state.groupRequests || []), request];
  return request;
}

function resolveGroupRequest(requestId, status) {
  state.groupRequests = (state.groupRequests || []).map((request) =>
    request.id === requestId ? { ...request, status } : request
  );
}

function addGroupMember(userId) {
  state.groupMemberIds = unique([...(state.groupMemberIds || []), userId]);
}

function saveState() {
  state.groupName ||= "我的燃脂小组";
  state.groupPeriod ||= "week";
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (backendAvailable && !isHydratingFromBackend) {
    persistStateToBackend();
  }
}

async function hydrateFromBackend() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    backendAvailable = true;
    const remoteState = normalizeState(await response.json());
    if (remoteState.users.length > 0 || state.users.length === 0) {
      const sessionUserId = loadSessionUserId();
      isHydratingFromBackend = true;
      Object.assign(state, remoteState);
      state.activeUserId = remoteState.users.some((user) => user.id === sessionUserId) ? sessionUserId : "";
      if (!state.activeUserId) localStorage.removeItem(sessionKey);
      localStorage.setItem(storageKey, JSON.stringify(state));
      isHydratingFromBackend = false;
      renderAll();
    } else {
      persistStateToBackend();
    }
  } catch {
    backendAvailable = false;
  }
}

async function persistStateToBackend() {
  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sharedStatePayload())
    });
  } catch {
    backendAvailable = false;
  }
}

function sharedStatePayload() {
  return {
    ...state,
    activeUserId: ""
  };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function activeUser() {
  return state.users.find((user) => user.id === state.activeUserId);
}

function hasActiveUser() {
  return Boolean(activeUser());
}

function samePeriod(dateText, period) {
  const date = new Date(`${dateText}T00:00:00`);
  const now = new Date(`${today}T00:00:00`);
  if (period === "day") return dateText === today;
  if (period === "week") return daysBetween(date, now) < 7;
  if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  const currentQuarter = Math.floor(now.getMonth() / 3);
  return date.getFullYear() === now.getFullYear() && Math.floor(date.getMonth() / 3) === currentQuarter;
}

function daysBetween(a, b) {
  return Math.abs((b - a) / 86400000);
}

function latestBody(userId) {
  const body = [...state.body].filter((item) => item.userId === userId).sort((a, b) => b.date.localeCompare(a.date))[0];
  return body || null;
}

function calculateTotals(userId, foods, workouts, includeChallengeBonus = false) {
  const body = latestBody(userId);
  const bmr = Number(body?.bmr || 0);
  const intake = foods.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  const burned = workouts.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  const deficit = Math.max(0, bmr + burned - intake);
  const deficitRate = bmr > 0 ? deficit / bmr : 0;
  const challengeBonus = includeChallengeBonus && state.completedChallenges[`${userId}:${today}`] ? 0.03 : 0;
  const adjustedRate = Math.max(0, deficitRate + challengeBonus);
  const net = intake - burned;
  return {
    intake,
    burned,
    net,
    bmr,
    deficit,
    deficitRate: adjustedRate,
    foodCount: foods.length,
    workoutCount: workouts.length
  };
}

function userTotals(userId, period = "day") {
  const foods = state.foods.filter((item) => item.userId === userId && samePeriod(item.date, period));
  const workouts = state.workouts.filter((item) => item.userId === userId && samePeriod(item.date, period));
  return calculateTotals(userId, foods, workouts, samePeriod(today, period));
}

function userTotalsForDate(userId, dateText) {
  const foods = state.foods.filter((item) => item.userId === userId && item.date === dateText);
  const workouts = state.workouts.filter((item) => item.userId === userId && item.date === dateText);
  return calculateTotals(userId, foods, workouts, dateText === today);
}

function dateRange(period) {
  const end = new Date(`${today}T00:00:00`);
  const start = new Date(end);
  if (period === "day") {
    return [today];
  }
  if (period === "week") {
    start.setDate(end.getDate() - 6);
  } else if (period === "month") {
    start.setDate(1);
  } else {
    start.setMonth(Math.floor(end.getMonth() / 3) * 3, 1);
  }
  const days = Math.round((end - start) / 86400000) + 1;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function periodLabel(period) {
  return { day: "今天", week: "近 7 天", month: "本月", quarter: "本季度" }[period] || "本周";
}

function rankedUsers(period = "week") {
  return groupMembers()
    .map((user) => ({ ...user, totals: userTotals(user.id, period) }))
    .sort((a, b) => b.totals.deficitRate - a.totals.deficitRate);
}

async function readFileAsDataUrl(file) {
  if (!file || !file.size) return "";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setDefaultDates() {
  $$('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today;
  });
}

function renderUsers() {
  const user = activeUser();
  $("#activeName").textContent = user ? user.name : "FitRank";
  $("#activeMeta").textContent = user ? `${user.id} · ${user.role || "成员"}` : "未登录";
  $("#activeAvatar").innerHTML = user?.avatar
    ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">`
    : escapeHtml(user?.name?.slice(0, 1) || "F");
}

function renderAuthMode() {
  const title = $("#authTitle");
  const subtitle = $("#authSubtitle");
  const tabs = $$(".auth-tab");
  const loginForm = $("#loginForm");
  const registerForm = $("#registerForm");
  if (!title || !subtitle || !loginForm || !registerForm) return;

  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === authMode));
  loginForm.classList.toggle("hidden", authMode !== "login");
  registerForm.classList.toggle("hidden", authMode !== "register");
  title.textContent = authMode === "login" ? "登录账号" : "创建账号";
  subtitle.textContent =
    authMode === "login"
      ? "已有账号可直接登录，保留你之前录入的体测、饮食和运动记录。"
      : "注册后账号会进入全局用户目录，可被邀请加入健身小组。";
}

function renderDashboard() {
  const user = activeUser();
  if (!user) return;
  const totals = userTotals(user.id, "day");
  $("#dailyHeadline").textContent = totals.bmr
    ? `${user.name} 当前缺口率 ${Math.round(totals.deficitRate * 100)}%`
    : `${user.name} 还没有基础代谢数据`;
  $("#dailySummary").textContent =
    totals.bmr
      ? `基础代谢 ${totals.bmr} kcal，今日摄入 ${totals.intake} kcal，运动 ${totals.burned} kcal，热量缺口 ${totals.deficit} kcal。`
      : `先去体测页填写基础代谢，之后系统会自动计算今天的热量缺口率。`;
  $("#deficitRate").textContent = `${Math.round(totals.deficitRate * 100)}%`;
  $("#todayIn").textContent = totals.intake;
  $("#todayOut").textContent = totals.burned;
  $("#todayDeficit").textContent = totals.deficit;
  $("#castleWall").style.height = `${Math.min(92, Math.max(20, 20 + totals.deficitRate * 300))}%`;

  const feed = [
    ...state.foods.filter((item) => item.userId === user.id).map((item) => ({ type: "摄入", title: item.name, kcal: item.calories, date: item.date })),
    ...state.workouts.filter((item) => item.userId === user.id).map((item) => ({ type: "运动", title: item.activity || "运动", kcal: item.calories, date: item.date }))
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  $("#recentFeed").innerHTML = feed.length
    ? feed.map((item) => `<div class="feed-item"><span><strong>${escapeHtml(item.type)}</strong> ${escapeHtml(item.title)}<br><small>${item.date}</small></span><b>${item.kcal} kcal</b></div>`).join("")
    : `<div class="feed-item"><span>还没有记录</span><b>0 kcal</b></div>`;

  $("#dashboardRanking").innerHTML = rankingRows(rankedUsers("week").slice(0, 5));
  $("#groupBadge").textContent = `${groupMembers().length} 人小组`;
}

function renderBody() {
  const items = state.body
    .filter((item) => item.userId === state.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date));

  $("#bodyList").innerHTML = items.length
    ? items.map((item) => `
      <div class="table-row">
        <span><strong>${item.date}</strong><br><small>${escapeHtml(item.note || "无备注")}</small></span>
        <span>${item.bmr || "-"} kcal 基础代谢</span>
        <span>${item.weight || "-"} kg</span>
        <span>${item.bodyFat || "-"}% 体脂</span>
        <span>${item.waist || "-"} cm 腰围</span>
      </div>`).join("")
    : `<div class="table-row"><span>暂无体测记录</span><small>先上传体测报告或手动填入基础代谢</small></div>`;
}

function renderFood() {
  const items = state.foods
    .filter((item) => item.userId === state.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#foodList").innerHTML = items.length
    ? items.map((item) => photoCard(item.photo, item.name, `${item.meal} · ${item.date}`, `${item.calories} kcal`)).join("")
    : `<div class="photo-card"><div class="empty-img">等待上传食品照片</div><strong>暂无摄入记录</strong><small>记录热量后会出现在这里</small></div>`;
}

function renderWorkout() {
  const items = state.workouts
    .filter((item) => item.userId === state.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#workoutList").innerHTML = items.length
    ? items.map((item) => photoCard(item.photo, item.activity || "运动", `${item.minutes || 0} 分钟 · ${item.date}`, `${item.calories} kcal`)).join("")
    : `<div class="photo-card"><div class="empty-img">等待上传 Apple 运动截图</div><strong>暂无运动记录</strong><small>手动录入也可以参与排名</small></div>`;
}

function photoCard(photo, title, meta, value) {
  const safeTitle = escapeHtml(title);
  const visual = photo ? `<img src="${photo}" alt="${safeTitle}">` : `<div class="empty-img">无图片</div>`;
  return `<div class="photo-card">${visual}<strong>${safeTitle}</strong><small>${escapeHtml(meta)}</small><p><b>${escapeHtml(value)}</b></p></div>`;
}

function renderRanking() {
  $$("#periodTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === state.selectedPeriod);
  });
  renderTrendChart();
  $("#rankingList").innerHTML = rankingRows(rankedUsers(state.selectedPeriod));
}

function renderTrendChart() {
  const user = activeUser();
  if (!user) return;
  const days = dateRange(state.selectedPeriod);
  const series = days.map((date) => ({ date, ...userTotalsForDate(user.id, date) }));
  const maxKcal = Math.max(1, ...series.flatMap((item) => [item.intake, item.burned, item.deficit]));
  const totalIntake = series.reduce((sum, item) => sum + item.intake, 0);
  const totalBurned = series.reduce((sum, item) => sum + item.burned, 0);
  const totalDeficit = series.reduce((sum, item) => sum + item.deficit, 0);
  const avgRate = series.length ? series.reduce((sum, item) => sum + item.deficitRate, 0) / series.length : 0;

  $("#chartPeriodLabel").textContent = periodLabel(state.selectedPeriod);
  $("#seasonSummary").innerHTML = [
    ["总摄入", `${totalIntake} kcal`],
    ["总运动", `${totalBurned} kcal`],
    ["总缺口", `${totalDeficit} kcal`],
    ["平均缺口率", `${Math.round(avgRate * 100)}%`]
  ].map(([label, value]) => `<div class="season-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("#trendChart").innerHTML = series.map((item) => {
    const intakeHeight = Math.max(4, Math.round((item.intake / maxKcal) * 120));
    const burnedHeight = Math.max(4, Math.round((item.burned / maxKcal) * 120));
    const deficitHeight = Math.max(4, Math.round((item.deficit / maxKcal) * 120));
    const rate = Math.round(item.deficitRate * 100);
    const dayLabel = item.date.slice(5).replace("-", "/");
    return `<div class="trend-day" title="${item.date} 缺口率 ${rate}%">
      <div class="rate-line" style="bottom:${Math.min(140, Math.max(8, rate * 2.2))}px"></div>
      <div class="bar-stack">
        <span class="bar intake" style="height:${intakeHeight}px"></span>
        <span class="bar burned" style="height:${burnedHeight}px"></span>
        <span class="bar deficit" style="height:${deficitHeight}px"></span>
      </div>
      <strong>${rate}%</strong>
      <small>${dayLabel}</small>
    </div>`;
  }).join("");
}

function rankingRows(users) {
  if (!users.length) {
    return `<div class="rank-row empty-rank"><span>暂无排名数据</span><small>上传基础代谢、摄入和运动后开始排名</small></div>`;
  }

  return users.map((user, index) => {
    const rate = Math.round(user.totals.deficitRate * 100);
    const medal = index === 0 ? "领跑" : index === 1 ? "追击" : index === 2 ? "冲刺" : "上榜";
    const avatar = user.avatar
      ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">`
      : escapeHtml(user.name.slice(0, 1) || "F");
    return `
    <div class="rank-row" style="--rank-delay:${index * 55}ms">
      <span class="place">${index + 1}</span>
      <span class="rank-avatar">${avatar}</span>
      <span class="rank-main">
        <strong>${escapeHtml(user.name)} <em>${escapeHtml(medal)}</em></strong>
        <small>${escapeHtml(user.id)} · 基础代谢 ${user.totals.bmr || 0} kcal · 缺口 ${user.totals.deficit} kcal</small>
      </span>
      <span class="rank-score">${rate}%</span>
    </div>
  `;
  }).join("");
}

function renderGroup() {
  state.groupName ||= "我的燃脂小组";
  state.groupPeriod ||= "week";
  const members = groupMembers();
  const pendingRequests = pendingRequestsFor(state.activeUserId);
  const sentRequests = sentRequestsBy(state.activeUserId);
  const query = $("#userSearch").value.trim().toLowerCase();
  const directory = state.users
    .filter((user) => {
      const role = String(user.role || "");
      return !query || user.id.toLowerCase().includes(query) || user.name.toLowerCase().includes(query) || role.toLowerCase().includes(query);
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  $("#memberCount").textContent = `${members.length} 人 · ${pendingRequests.length} 待处理`;
  $("#groupName").value = state.groupName;
  $("#searchResult").textContent = sentRequests.length
    ? `已发出 ${sentRequests.length} 个待确认请求。`
    : `搜索全局用户 ID，邀请后对方需要确认。`;
  $("#userDirectory").innerHTML = directory.length
    ? directory.map((user) => {
      const member = isGroupMember(user.id);
      const waiting = hasPendingRequest(state.activeUserId, user.id);
      const avatar = user.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">` : escapeHtml(user.name.slice(0, 1));
      return `<div class="member-card directory-card">
        <div class="avatar">${avatar}</div>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.id)} · ${escapeHtml(user.role)}</small>
        <p>${member ? "已在小组" : waiting ? "邀请已发送" : "可邀请加入"}</p>
        <button class="ghost invite-user" data-user-id="${escapeHtml(user.id)}" ${member || user.id === state.activeUserId || waiting ? "disabled" : ""}>${member ? "已加入" : waiting ? "等待确认" : "邀请加入"}</button>
      </div>`;
    }).join("")
    : `<div class="empty-rank">没有匹配的用户。先注册账号，或切换搜索词。</div>`;

  $("#groupRequests").innerHTML = pendingRequests.length
    ? pendingRequests.map((request) => {
      const requester = state.users.find((user) => user.id === request.fromUserId);
      const isMine = request.toUserId === state.activeUserId;
      return `<div class="request-card">
        <div>
          <strong>${escapeHtml(requester?.name || request.fromUserId)} 邀请 ${escapeHtml(request.toUserId)}</strong>
          <small>${escapeHtml(request.createdAt)} · ${request.type === "invite" ? "邀请入组" : "加入申请"}</small>
        </div>
        <div class="request-actions">
          ${isMine ? `<button class="primary accept-request" data-request-id="${escapeHtml(request.id)}">同意</button><button class="secondary reject-request" data-request-id="${escapeHtml(request.id)}">拒绝</button>` : `<span class="pill">待确认</span>`}
        </div>
      </div>`;
    }).join("")
    : `<div class="empty-rank">没有待处理请求。</div>`;

  $("#groupMembers").innerHTML = members.map((user) => {
    const totals = userTotals(user.id, "week");
    const avatar = user.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">` : escapeHtml(user.name.slice(0, 1));
    return `<div class="member-card">
      <div class="avatar">${avatar}</div>
      <strong>${escapeHtml(user.name)}</strong>
      <small>${escapeHtml(user.id)} · ${escapeHtml(user.role)}</small>
      <p>本周缺口率 ${Math.round(totals.deficitRate * 100)}%</p>
      ${user.id === state.activeUserId ? `<span class="pill">当前账号</span>` : ""}
    </div>`;
  }).join("");
  renderGroupBattle();
}

function renderGroupBattle() {
  const period = state.groupPeriod || "week";
  $$("#groupPeriodTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === period);
  });
  const ranked = rankedUsers(period);
  const maxDeficit = Math.max(1, ...ranked.map((user) => user.totals.deficit));
  const avgRate = ranked.length
    ? ranked.reduce((sum, user) => sum + user.totals.deficitRate, 0) / ranked.length
    : 0;
  const leader = ranked[0];
  $("#battleSummary").innerHTML = [
    ["小组", state.groupName || "我的燃脂小组"],
    ["周期", periodLabel(period)],
    ["平均缺口率", `${Math.round(avgRate * 100)}%`],
    ["当前领先", leader ? `${escapeHtml(leader.name)} ${Math.round(leader.totals.deficitRate * 100)}%` : "暂无成员"]
  ].map(([label, value]) => `<div class="season-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("#battleBoard").innerHTML = ranked.length
    ? ranked.map((user, index) => {
      const rate = Math.round(user.totals.deficitRate * 100);
      const deficitWidth = Math.max(3, Math.round((user.totals.deficit / maxDeficit) * 100));
      return `<div class="battle-row">
        <div class="battle-person">
          <span class="place">${index + 1}</span>
          <span class="avatar small">${user.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">` : escapeHtml(user.name.slice(0, 1))}</span>
          <span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.id)}</small></span>
        </div>
        <div class="battle-bars">
          <div class="battle-bar"><span style="width:${Math.min(100, Math.max(3, user.totals.intake / Math.max(1, user.totals.bmr) * 70))}%"></span><small>摄入 ${user.totals.intake}</small></div>
          <div class="battle-bar burned"><span style="width:${Math.min(100, Math.max(3, user.totals.burned / Math.max(1, user.totals.bmr) * 100))}%"></span><small>运动 ${user.totals.burned}</small></div>
          <div class="battle-bar deficit"><span style="width:${deficitWidth}%"></span><small>缺口 ${user.totals.deficit}</small></div>
        </div>
        <strong class="battle-rate">${rate}%</strong>
      </div>`;
    }).join("")
    : `<div class="empty-battle">先添加队友，组队比拼会显示每个人的摄入、运动、缺口和缺口率。</div>`;
}

function renderGame() {
  const completed = state.completedChallenges[`${state.activeUserId}:${today}`];
  const totals = activeUser() ? userTotals(state.activeUserId, "day") : null;
  const rateText = totals ? `${Math.round(totals.deficitRate * 100)}%` : "0%";
  $("#challengeText").textContent = state.currentChallenge || `点击生成一个围绕当前 ${rateText} 缺口率的挑战。`;
  $("#streakPill").textContent = completed ? `已加成 +3%` : "今日待挑战";
}

function renderAll() {
  renderAuthMode();
  const registered = hasActiveUser();
  $("#authScreen").classList.toggle("hidden", registered);
  $("#appShell").classList.toggle("hidden", !registered);
  if (!registered) return;
  renderUsers();
  renderDashboard();
  renderBody();
  renderFood();
  renderWorkout();
  renderRanking();
  renderGroup();
  renderGame();
  setDefaultDates();
}

function switchView(viewId) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

function bindEvents() {
  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      authMode = tab.dataset.authMode || "login";
      renderAuthMode();
    });
  });

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id")).trim();
    const name = String(form.get("name")).trim();
    const role = String(form.get("role")).trim() || "成员";
    const password = String(form.get("password") || "");
    const passwordConfirm = String(form.get("passwordConfirm") || "");
    const avatar = await readFileAsDataUrl(form.get("avatar"));
    if (!id || !name || !password) return;
    if (password !== passwordConfirm) {
      const confirm = event.target.querySelector('input[name="passwordConfirm"]');
      confirm.setCustomValidity("两次密码不一致");
      event.target.reportValidity();
      return;
    }
    if (state.users.some((user) => user.id.toLowerCase() === id.toLowerCase())) {
      event.target.querySelector('input[name="id"]').setCustomValidity("这个用户 ID 已存在");
      event.target.reportValidity();
      return;
    }
    event.target.querySelector('input[name="id"]').setCustomValidity("");
    event.target.querySelector('input[name="passwordConfirm"]').setCustomValidity("");
    const passwordSalt = randomBase64Url(16);
    const passwordHash = await hashPassword(password, passwordSalt);
    state.users.push({ id, name, role, avatar, passwordSalt, passwordHash });
    if (!(state.groupMemberIds || []).length) addGroupMember(id);
    setSessionUser(id);
    saveState();
    event.target.reset();
    renderAll();
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id") || "").trim();
    const password = String(form.get("password") || "");
    const user = state.users.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!user) {
      const input = event.target.querySelector('input[name="id"]');
      input.setCustomValidity("没有找到这个账号");
      event.target.reportValidity();
      return;
    }

    event.target.querySelector('input[name="id"]').setCustomValidity("");
    if (!password) return;
    const matched = await verifyPassword(user, password);
    if (!matched) {
      const input = event.target.querySelector('input[name="password"]');
      input.setCustomValidity("密码不正确");
      event.target.reportValidity();
      return;
    }

    inputResetValidity(event.target, 'input[name="password"]');
    if (!user.passwordHash || !user.passwordSalt) {
      user.passwordSalt = "legacy";
      user.passwordHash = await hashPassword(user.id, user.passwordSalt);
      saveState();
    }
    setSessionUser(user.id);
    saveState();
    renderAll();
  });

  $$("#loginForm input").forEach((input) => {
    input.addEventListener("input", () => input.setCustomValidity(""));
  });

  $$("#registerForm input").forEach((input) => {
    input.addEventListener("input", () => input.setCustomValidity(""));
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$("[data-jump]").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.jump)));

  $("#logoutButton").addEventListener("click", () => {
    clearSessionUser();
    authMode = "login";
    renderAll();
  });

  $("#saveGroupName").addEventListener("click", () => {
    state.groupName = $("#groupName").value.trim() || "我的燃脂小组";
    saveState();
    renderGroup();
  });

  $("#bodyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.body.push({
      userId: state.activeUserId,
      date: data.date,
      bmr: Number(data.bmr),
      weight: data.weight ? Number(data.weight) : "",
      bodyFat: data.bodyFat ? Number(data.bodyFat) : "",
      waist: data.waist ? Number(data.waist) : "",
      note: data.note || ""
    });
    saveState();
    event.target.reset();
    renderAll();
  });

  $("#foodForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    state.foods.push({
      userId: state.activeUserId,
      date: form.get("date"),
      name: form.get("name"),
      calories: Number(form.get("calories")),
      meal: form.get("meal"),
      photo: await readFileAsDataUrl(form.get("photo"))
    });
    saveState();
    event.target.reset();
    renderAll();
  });

  $("#workoutForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    state.workouts.push({
      userId: state.activeUserId,
      date: form.get("date"),
      activity: form.get("activity") || "自定义运动",
      minutes: Number(form.get("minutes") || 0),
      calories: Number(form.get("calories")),
      photo: await readFileAsDataUrl(form.get("photo"))
    });
    saveState();
    event.target.reset();
    renderAll();
  });

  $("#periodTabs").addEventListener("click", (event) => {
    if (!event.target.matches("button")) return;
    state.selectedPeriod = event.target.dataset.period;
    saveState();
    renderRanking();
  });

  $("#addUser").addEventListener("click", () => {
    const id = $("#userSearch").value.trim();
    const user = state.users.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!user) {
      $("#searchResult").textContent = "没有找到该用户 ID。请确认对方已在此设备注册。";
      return;
    }
    if (user.id === state.activeUserId) {
      $("#searchResult").textContent = "不能邀请自己。";
      return;
    }
    if (isGroupMember(user.id)) {
      $("#searchResult").textContent = `${user.name} 已经在小组里。`;
      return;
    }
    if (hasPendingRequest(state.activeUserId, user.id)) {
      $("#searchResult").textContent = `${user.name} 的邀请已经发出，等待确认。`;
      return;
    }
    createGroupRequest("invite", state.activeUserId, user.id);
    $("#searchResult").textContent = `已向 ${user.name} 发出加入邀请，等待对方确认。`;
    $("#userSearch").value = "";
    saveState();
    renderAll();
  });

  $("#userDirectory").addEventListener("click", (event) => {
    const button = event.target.closest(".invite-user");
    if (!button) return;
    const targetId = button.dataset.userId;
    const target = state.users.find((item) => item.id === targetId);
    if (!target || target.id === state.activeUserId) return;
    if (isGroupMember(target.id)) return;
    if (hasPendingRequest(state.activeUserId, target.id)) {
      $("#searchResult").textContent = `${target.name} 的邀请已经发出，等待确认。`;
      return;
    }
    createGroupRequest("invite", state.activeUserId, target.id);
    $("#searchResult").textContent = `已向 ${target.name} 发出加入邀请。`;
    saveState();
    renderAll();
  });

  $("#groupRequests").addEventListener("click", (event) => {
    const acceptButton = event.target.closest(".accept-request");
    const rejectButton = event.target.closest(".reject-request");
    const requestId = acceptButton?.dataset.requestId || rejectButton?.dataset.requestId;
    if (!requestId) return;
    const request = (state.groupRequests || []).find((item) => item.id === requestId);
    if (!request || request.toUserId !== state.activeUserId) return;
    if (acceptButton) {
      addGroupMember(request.toUserId);
      resolveGroupRequest(requestId, "accepted");
      $("#searchResult").textContent = `${state.users.find((user) => user.id === request.toUserId)?.name || request.toUserId} 已加入小组。`;
    } else {
      resolveGroupRequest(requestId, "rejected");
      $("#searchResult").textContent = "已拒绝该邀请。";
    }
    saveState();
    renderAll();
  });

  $("#groupPeriodTabs").addEventListener("click", (event) => {
    if (!event.target.matches("button")) return;
    state.groupPeriod = event.target.dataset.period;
    saveState();
    renderGroupBattle();
  });

  $("#drawChallenge").addEventListener("click", () => {
    const totals = userTotals(state.activeUserId, "day");
    const band = totals.deficitRate >= 0.3 ? 4 : totals.deficitRate >= 0.2 ? 3 : totals.deficitRate >= 0.1 ? 2 : 1;
    const pool = challenges.slice(0, Math.min(challenges.length, band + 2));
    state.currentChallenge = pool[Math.floor(Math.random() * pool.length)];
    saveState();
    renderGame();
  });

  $("#completeChallenge").addEventListener("click", () => {
    if (!state.currentChallenge) state.currentChallenge = challenges[0];
    state.completedChallenges[`${state.activeUserId}:${today}`] = state.currentChallenge;
    saveState();
    renderAll();
  });

  $("#clearToday").addEventListener("click", () => {
    state.foods = state.foods.filter((item) => !(item.userId === state.activeUserId && item.date === today));
    state.workouts = state.workouts.filter((item) => !(item.userId === state.activeUserId && item.date === today));
    delete state.completedChallenges[`${state.activeUserId}:${today}`];
    saveState();
    renderAll();
  });
}

function inputResetValidity(form, selector) {
  const input = form.querySelector(selector);
  if (input) input.setCustomValidity("");
}

bindEvents();
renderAll();
hydrateFromBackend();
