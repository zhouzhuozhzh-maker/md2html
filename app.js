const today = new Date().toISOString().slice(0, 10);
const storageKey = "fitrank-team-state-v2";

const challenges = [
  "晚饭主食减半，并补 20 分钟步行",
  "今天完成 3 组核心训练",
  "只喝无糖饮料，拍照记录三餐",
  "午后走楼梯 10 分钟",
  "睡前拉伸 12 分钟",
  "今日净热量控制在 500 kcal 内"
];

const state = loadState();

function loadState() {
  const stored = localStorage.getItem(storageKey);
  if (stored) return JSON.parse(stored);

  return {
    activeUserId: "",
    selectedPeriod: "week",
    currentChallenge: "",
    completedChallenges: {},
    users: [],
    body: [],
    foods: [],
    workouts: []
  };
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
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

function userTotals(userId, period = "day") {
  const foods = state.foods.filter((item) => item.userId === userId && samePeriod(item.date, period));
  const workouts = state.workouts.filter((item) => item.userId === userId && samePeriod(item.date, period));
  const intake = foods.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  const burned = workouts.reduce((sum, item) => sum + Number(item.calories || 0), 0);
  const challengeBonus = state.completedChallenges[`${userId}:${today}`] ? 120 : 0;
  const score = Math.max(0, burned - Math.floor(intake * 0.35)) + challengeBonus;
  return { intake, burned, net: intake - burned, score, foodCount: foods.length, workoutCount: workouts.length };
}

function rankedUsers(period = "week") {
  const groupIds = new Set(state.users.filter((user) => user.group).map((user) => user.id));
  return state.users
    .filter((user) => groupIds.has(user.id))
    .map((user) => ({ ...user, totals: userTotals(user.id, period) }))
    .sort((a, b) => b.totals.score - a.totals.score);
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
}

function renderDashboard() {
  const user = activeUser();
  if (!user) return;
  const totals = userTotals(user.id, "day");
  $("#dailyHeadline").textContent =
    totals.net <= 0 ? `${user.name} 今天已经形成热量缺口` : `${user.name} 今天还可以继续运动`;
  $("#dailySummary").textContent =
    `今日摄入 ${totals.intake} kcal，运动消耗 ${totals.burned} kcal，当前积分 ${totals.score}。`;
  $("#netCalories").textContent = totals.net;
  $("#todayIn").textContent = totals.intake;
  $("#todayOut").textContent = totals.burned;
  $("#todayScore").textContent = totals.score;
  $("#castleWall").style.height = `${Math.min(92, Math.max(18, 42 + totals.score / 15))}%`;

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
  $("#groupBadge").textContent = `${state.users.filter((user) => user.group).length} 人小组`;
}

function renderBody() {
  const items = state.body
    .filter((item) => item.userId === state.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date));

  $("#bodyList").innerHTML = items.length
    ? items.map((item) => `
      <div class="table-row">
        <span><strong>${item.date}</strong><br><small>${escapeHtml(item.note || "无备注")}</small></span>
        <span>${item.weight || "-"} kg</span>
        <span>${item.bodyFat || "-"}% 体脂</span>
        <span>${item.waist || "-"} cm 腰围</span>
      </div>`).join("")
    : `<div class="table-row"><span>暂无体测记录</span></div>`;
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
  $("#rankingList").innerHTML = rankingRows(rankedUsers(state.selectedPeriod));
}

function rankingRows(users) {
  return users.map((user, index) => `
    <div class="rank-row">
      <span class="place">${index + 1}</span>
      <span class="rank-main">
        <strong>${escapeHtml(user.name)} · ${escapeHtml(user.id)}</strong>
        <small>摄入 ${user.totals.intake} kcal · 消耗 ${user.totals.burned} kcal · 净热量 ${user.totals.net}</small>
      </span>
      <span class="rank-score">${user.totals.score}</span>
    </div>
  `).join("");
}

function renderGroup() {
  const members = state.users.filter((user) => user.group);
  $("#memberCount").textContent = `${members.length} 人`;
  $("#groupMembers").innerHTML = members.map((user) => {
    const totals = userTotals(user.id, "week");
    return `<div class="member-card">
      <div class="avatar">${escapeHtml(user.name.slice(0, 1))}</div>
      <strong>${escapeHtml(user.name)}</strong>
      <small>${escapeHtml(user.id)} · ${escapeHtml(user.role)}</small>
      <p>本周 ${totals.score} 分</p>
    </div>`;
  }).join("");
}

function renderGame() {
  const completed = state.completedChallenges[`${state.activeUserId}:${today}`];
  $("#challengeText").textContent = state.currentChallenge || "点击抽签生成一个今天的小挑战。";
  $("#streakPill").textContent = completed ? "连续 1 天" : "连续 0 天";
}

function renderAll() {
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
  $("#registerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const id = String(form.get("id")).trim();
    const name = String(form.get("name")).trim();
    const role = String(form.get("role")).trim() || "成员";
    if (!id || !name) return;
    if (state.users.some((user) => user.id.toLowerCase() === id.toLowerCase())) {
      event.target.querySelector('input[name="id"]').setCustomValidity("这个用户 ID 已存在");
      event.target.reportValidity();
      return;
    }
    event.target.querySelector('input[name="id"]').setCustomValidity("");
    state.users.push({ id, name, role, group: true });
    state.activeUserId = id;
    saveState();
    event.target.reset();
    renderAll();
  });

  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$("[data-jump]").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.jump)));

  $("#activeUser").addEventListener("change", (event) => {
    state.activeUserId = event.target.value;
    saveState();
    renderAll();
  });

  $("#bodyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.body.push({ userId: state.activeUserId, ...data });
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
    $("#searchResult").textContent = `${user.name} 已加入健身小组。`;
    $("#userSearch").value = "";
    saveState();
    renderAll();
  });

  $("#drawChallenge").addEventListener("click", () => {
    state.currentChallenge = challenges[Math.floor(Math.random() * challenges.length)];
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
