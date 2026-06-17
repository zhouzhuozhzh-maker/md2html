const today = new Date().toISOString().slice(0, 10);
const storageKey = "fitrank-team-state-v5";
const legacyStorageKeys = [
  "fitrank-team-state-v4",
  "fitrank-team-state-v3",
  "fitrank-team-state-v2",
  "fitrank-team-state-v1"
];
let backendAvailable = false;
let isHydratingFromBackend = false;

const challenges = [
  "今天把缺口率做到 20% 以上",
  "晚餐把摄入压到基础代谢以下 60%",
  "补 30 分钟运动，把缺口率再抬高一点",
  "今天所有加餐只保留一次，守住缺口",
  "把一顿高热量餐换成轻食，争取提升排名",
  "完成一次 40 分钟有氧，让缺口率突破赛季均值"
];

const state = loadState();

function loadState() {
  for (const key of [storageKey, ...legacyStorageKeys]) {
    const stored = localStorage.getItem(key);
    if (stored) return normalizeState(JSON.parse(stored));
  }

  return normalizeState({});
}

function normalizeState(value) {
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
    ...value
  };
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
      isHydratingFromBackend = true;
      Object.assign(state, remoteState);
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
      body: JSON.stringify(state)
    });
  } catch {
    backendAvailable = false;
  }
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

function groupMembers() {
  return state.users.filter((user) => user.group);
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
  $("#activeUser").innerHTML = state.users
    .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} · ${escapeHtml(user.id)}</option>`)
    .join("");
  $("#activeUser").value = state.activeUserId;
  const user = activeUser();
  $("#activeName").textContent = user ? user.name : "FitRank";
  $("#activeAvatar").innerHTML = user?.avatar
    ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">`
    : escapeHtml(user?.name?.slice(0, 1) || "F");
}

function renderAuthUsers() {
  const select = $("#loginUserSelect");
  if (!select) return;
  if (state.users.length === 0) {
    select.innerHTML = `<option value="">暂无账号，请先注册</option>`;
    select.disabled = true;
    $("#loginHint").textContent = "先注册一个账号，之后就可以在这里直接登录。";
    return;
  }

  select.disabled = false;
  select.innerHTML = state.users
    .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} · ${escapeHtml(user.id)}</option>`)
    .join("");
  select.value = state.users[0].id;
  $("#loginHint").textContent = `当前可登录 ${state.users.length} 个账号。`;
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
  return users.map((user, index) => `
    <div class="rank-row">
      <span class="place">${index + 1}</span>
      <span class="rank-main">
        <strong>${escapeHtml(user.name)} · ${escapeHtml(user.id)}</strong>
        <small>基础代谢 ${user.totals.bmr || 0} kcal · 缺口 ${user.totals.deficit} kcal · 缺口率 ${Math.round(user.totals.deficitRate * 100)}%</small>
      </span>
      <span class="rank-score">${Math.round(user.totals.deficitRate * 100)}%</span>
    </div>
  `).join("");
}

function renderGroup() {
  state.groupName ||= "我的燃脂小组";
  state.groupPeriod ||= "week";
  const members = groupMembers();
  $("#memberCount").textContent = `${members.length} 人`;
  $("#groupName").value = state.groupName;
  $("#groupMembers").innerHTML = members.map((user) => {
    const totals = userTotals(user.id, "week");
    return `<div class="member-card">
      <div class="avatar">${user.avatar ? `<img src="${user.avatar}" alt="${escapeHtml(user.name)}">` : escapeHtml(user.name.slice(0, 1))}</div>
      <strong>${escapeHtml(user.name)}</strong>
      <small>${escapeHtml(user.id)} · ${escapeHtml(user.role)}</small>
      <p>本周缺口率 ${Math.round(totals.deficitRate * 100)}%</p>
      <button class="ghost member-remove" data-user-id="${escapeHtml(user.id)}">移出小组</button>
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
  renderAuthUsers();
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
  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id")).trim();
    const name = String(form.get("name")).trim();
    const role = String(form.get("role")).trim() || "成员";
    const avatar = await readFileAsDataUrl(form.get("avatar"));
    if (!id || !name) return;
    if (state.users.some((user) => user.id.toLowerCase() === id.toLowerCase())) {
      event.target.querySelector('input[name="id"]').setCustomValidity("这个用户 ID 已存在");
      event.target.reportValidity();
      return;
    }
    event.target.querySelector('input[name="id"]').setCustomValidity("");
    state.users.push({ id, name, role, avatar, group: true });
    state.activeUserId = id;
    saveState();
    event.target.reset();
    renderAll();
  });

  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const typedId = String(form.get("id") || "").trim();
    const selectedId = String(form.get("userId") || "").trim();
    const id = typedId || selectedId;
    const user = state.users.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!user) {
      const input = event.target.querySelector('input[name="id"]');
      input.setCustomValidity("没有找到这个账号");
      event.target.reportValidity();
      return;
    }

    event.target.querySelector('input[name="id"]').setCustomValidity("");
    state.activeUserId = user.id;
    saveState();
    renderAll();
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$("[data-jump]").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.jump)));

  $("#activeUser").addEventListener("change", (event) => {
    state.activeUserId = event.target.value;
    saveState();
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
    user.group = true;
    $("#searchResult").textContent = `${user.name} 已加入 ${state.groupName || "健身小组"}。`;
    $("#userSearch").value = "";
    saveState();
    renderAll();
  });

  $("#teammateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id")).trim();
    const name = String(form.get("name")).trim();
    const bmr = Number(form.get("bmr"));
    const intake = Number(form.get("intake") || 0);
    const burned = Number(form.get("burned") || 0);
    const avatar = await readFileAsDataUrl(form.get("avatar"));
    if (!id || !name || !bmr) return;
    let user = state.users.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!user) {
      user = { id, name, role: "队友", avatar, group: true };
      state.users.push(user);
    } else {
      user.name = name;
      user.avatar = avatar || user.avatar;
      user.group = true;
    }
    state.body = state.body.filter((item) => !(item.userId === id && item.date === today));
    state.body.push({ userId: id, date: today, bmr, weight: "", bodyFat: "", waist: "", note: "组队快速录入" });
    if (intake) {
      state.foods.push({ userId: id, date: today, name: "今日摄入合计", calories: intake, meal: "合计", photo: "" });
    }
    if (burned) {
      state.workouts.push({ userId: id, date: today, activity: "今日运动合计", minutes: 0, calories: burned, photo: "" });
    }
    $("#searchResult").textContent = `${name} 已加入 ${state.groupName || "健身小组"}，并生成今天的比拼数据。`;
    event.target.reset();
    saveState();
    renderAll();
  });

  $("#groupMembers").addEventListener("click", (event) => {
    const button = event.target.closest(".member-remove");
    if (!button) return;
    const user = state.users.find((item) => item.id === button.dataset.userId);
    if (user) user.group = false;
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

bindEvents();
renderAll();
hydrateFromBackend();
