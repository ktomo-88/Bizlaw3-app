(() => {
  "use strict";

  const QUESTIONS = (window.QUESTIONS || []).filter(q => q.verified === true);
  const STORAGE_KEY = "bizlaw3_state_v2";
  const STATE_VERSION = 2;
  const INTERVALS = [1, 3, 7, 14, 30];

  const $ = id => document.getElementById(id);
  const screens = ["homeScreen", "categoryScreen", "quizScreen", "resultScreen"];

  let state = loadState();
  let session = null;
  let current = null;
  let answered = false;

  function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(n) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }

  function defaultState() {
    return { version: STATE_VERSION, cards: {}, daily: {}, totalAnswered: 0 };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      parsed.version = STATE_VERSION;
      parsed.cards ||= {};
      parsed.daily ||= {};
      parsed.totalAnswered ||= 0;
      return parsed;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("学習データの保存に失敗しました", e); }
  }

  function cardState(id) {
    if (!state.cards[id]) {
      state.cards[id] = {
        seenCount: 0, correctCount: 0, wrongCount: 0,
        lastAnswered: null, nextReview: todayKey(), stage: 0,
        weak: false, uncertain: false
      };
    }
    return state.cards[id];
  }

  function showScreen(id) {
    screens.forEach(s => $(s).classList.toggle("active", s === id));
    $("homeBtn").classList.toggle("hidden", id === "homeScreen");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function weightedRandomPool() {
    const pool = [];
    QUESTIONS.forEach(q => {
      const r = cardState(q.id);
      let weight = 1;
      if (r.weak) weight += 3;
      if (r.uncertain) weight += 2;
      if (r.wrongCount > 0) weight += Math.min(3, r.wrongCount);
      for (let i = 0; i < weight; i++) pool.push(q);
    });
    const result = [];
    const used = new Set();
    for (const q of shuffle(pool)) {
      if (!used.has(q.id)) {
        result.push(q);
        used.add(q.id);
      }
    }
    return result;
  }

  function dueQuestions() {
    const today = todayKey();
    return QUESTIONS.filter(q => cardState(q.id).nextReview <= today);
  }

  function weakQuestions() {
    return QUESTIONS.filter(q => {
      const r = cardState(q.id);
      return r.weak || r.uncertain || r.wrongCount > r.correctCount;
    });
  }

  function startSession(mode, category = null, forced = null) {
    let pool = [];
    if (forced) pool = forced;
    else if (mode === "due") pool = shuffle(dueQuestions());
    else if (mode === "weak") pool = shuffle(weakQuestions());
    else if (mode === "random") pool = weightedRandomPool();
    else if (mode === "category") pool = shuffle(QUESTIONS.filter(q => q.category === category));
    else if (mode === "mock") pool = shuffle(QUESTIONS).slice(0, Math.min(20, QUESTIONS.length));

    if (!pool.length) {
      alert(mode === "due" ? "今日の復習は完了しています。" : "該当する問題がありません。");
      renderHome();
      return;
    }

    const limit = mode === "mock" ? pool.length : Math.min(20, pool.length);
    session = {
      mode, category, queue: pool.slice(0, limit), index: 0,
      results: [], mistakes: [], mock: mode === "mock"
    };
    showScreen("quizScreen");
    renderQuestion();
  }

  function renderQuestion() {
    current = session.queue[session.index];
    answered = false;
    $("modeLabel").textContent =
      session.mock ? "模擬20問" :
      session.mode === "due" ? "今日の復習" :
      session.mode === "weak" ? "弱点だけ" :
      session.mode === "category" ? session.category :
      "全分野ランダム";

    $("progressLabel").textContent = `${session.index + 1} / ${session.queue.length}`;
    $("progressBar").style.width = `${(session.index / session.queue.length) * 100}%`;
    $("categoryTag").textContent = current.category;
    $("subCategoryTag").textContent = current.subCategory;
    $("questionText").textContent = current.question;
    $("answerButtons").classList.remove("hidden");
    $("explanationBox").classList.add("hidden");
    $("gradeButtons").classList.toggle("hidden", session.mock);
    $("mockNextBtn").classList.toggle("hidden", !session.mock);
  }

  function answer(value) {
    if (!current || answered) return;
    answered = true;
    const correct = value === current.answer;
    const r = cardState(current.id);
    r.seenCount += 1;
    r.lastAnswered = todayKey();
    if (correct) r.correctCount += 1;
    else {
      r.wrongCount += 1;
      r.weak = true;
      r.uncertain = false;
      r.stage = 0;
      r.nextReview = addDays(1);
    }

    const dk = todayKey();
    state.daily[dk] ||= { answered: 0, correct: 0 };
    state.daily[dk].answered += 1;
    if (correct) state.daily[dk].correct += 1;
    state.totalAnswered += 1;

    session.results.push({ id: current.id, correct, category: current.category });
    if (!correct) session.mistakes.push(current.id);

    $("verdict").textContent = correct ? "正解" : "不正解";
    $("verdict").style.color = correct ? "#166534" : "#991b1b";
    $("explanationText").textContent = current.explanation;
    $("memoryTip").textContent = current.memoryTip;
    $("confusionText").textContent = current.confusion;
    $("sourceText").textContent = `${current.source} ${current.sourcePage}`;
    $("answerButtons").classList.add("hidden");
    $("explanationBox").classList.remove("hidden");
    saveState();
  }

  function grade(kind) {
    if (!current || !answered) return;
    const r = cardState(current.id);

    if (kind === "wrong") {
      r.weak = true;
      r.uncertain = false;
      r.stage = 0;
      r.nextReview = addDays(1);
    } else if (kind === "uncertain") {
      r.weak = true;
      r.uncertain = true;
      r.nextReview = addDays(1);
    } else {
      r.uncertain = false;
      r.stage = Math.min((r.stage || 0) + 1, INTERVALS.length);
      const days = INTERVALS[r.stage - 1] || 30;
      r.nextReview = addDays(days);
      if (r.stage >= 3 && r.correctCount >= r.wrongCount) r.weak = false;
    }

    saveState();
    nextQuestion();
  }

  function nextQuestion() {
    session.index += 1;
    if (session.index >= session.queue.length) {
      if (session.mock) renderMockResult();
      else {
        alert("このセッションは終了です。");
        renderHome();
      }
      return;
    }
    renderQuestion();
  }

  function renderMockResult() {
    showScreen("resultScreen");
    const correct = session.results.filter(r => r.correct).length;
    const total = session.results.length;
    const pct = Math.round((correct / total) * 100);
    $("mockScore").textContent = `${correct} / ${total}　${pct}%`;

    const byCat = {};
    session.results.forEach(r => {
      byCat[r.category] ||= { total: 0, correct: 0 };
      byCat[r.category].total += 1;
      if (r.correct) byCat[r.category].correct += 1;
    });
    $("mockBreakdown").innerHTML = Object.entries(byCat)
      .sort((a,b) => a[0].localeCompare(b[0], "ja"))
      .map(([cat,v]) => `<div class="mock-line"><span>${escapeHtml(cat)}</span><strong>${v.correct}/${v.total}</strong></div>`)
      .join("");

    const uniqueMistakes = [...new Set(session.mistakes)];
    $("mockMistakes").innerHTML = uniqueMistakes.length
      ? `<h3>誤答 ${uniqueMistakes.length}問</h3>` + uniqueMistakes.map(id => {
          const q = QUESTIONS.find(x => x.id === id);
          return `<div class="mistake-item">${escapeHtml(q.question)}<small>${escapeHtml(q.memoryTip)}</small></div>`;
        }).join("")
      : "<h3>誤答なし</h3><p>20問すべて正解です。</p>";

    $("reviewMistakesBtn").disabled = uniqueMistakes.length === 0;
    $("reviewMistakesBtn").onclick = () => {
      const qs = uniqueMistakes.map(id => QUESTIONS.find(q => q.id === id)).filter(Boolean);
      startSession("weak", null, qs);
    };
  }

  function renderHome() {
    showScreen("homeScreen");
    updateDashboard();
  }

  function updateDashboard() {
    const d = state.daily[todayKey()] || { answered: 0, correct: 0 };
    $("todayAnswered").textContent = d.answered;
    $("todayAccuracy").textContent = d.answered ? Math.round((d.correct / d.answered) * 100) : "-";
    $("dueCount").textContent = dueQuestions().length;
    $("totalAnswered").textContent = state.totalAnswered || 0;

    const cats = [...new Set(QUESTIONS.map(q => q.category))];
    $("categoryStats").innerHTML = cats.map(cat => {
      const qs = QUESTIONS.filter(q => q.category === cat);
      let seen = 0, correct = 0, wrong = 0, weak = 0;
      qs.forEach(q => {
        const r = cardState(q.id);
        seen += r.seenCount;
        correct += r.correctCount;
        wrong += r.wrongCount;
        if (r.weak || r.uncertain) weak += 1;
      });
      const attempts = correct + wrong;
      const pct = attempts ? Math.round((correct / attempts) * 100) : null;
      return `<div class="category-row">
        <div class="name">${escapeHtml(cat)}</div>
        <div class="meta">${attempts}回答 / 要復習${weak}</div>
        <div class="pct">${pct === null ? "-" : pct + "%"}</div>
      </div>`;
    }).join("");
  }

  function renderCategoryButtons() {
    const cats = [...new Set(QUESTIONS.map(q => q.category))];
    $("categoryButtons").innerHTML = "";
    cats.forEach(cat => {
      const count = QUESTIONS.filter(q => q.category === cat).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `${escapeHtml(cat)}<br><small>${count}問</small>`;
      btn.addEventListener("click", () => startSession("category", cat));
      $("categoryButtons").appendChild(btn);
    });
  }

  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bizlaw3-study-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.cards) throw new Error("invalid");
        parsed.version = STATE_VERSION;
        parsed.daily ||= {};
        parsed.totalAnswered ||= 0;
        state = parsed;
        saveState();
        updateDashboard();
        alert("学習データを読み込みました。");
      } catch {
        alert("読み込めないJSONです。");
      }
    };
    reader.readAsText(file);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[c]);
  }

  function bind() {
    document.querySelectorAll("[data-mode]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (mode === "category") {
          renderCategoryButtons();
          showScreen("categoryScreen");
        } else startSession(mode);
      });
    });

    $("trueBtn").addEventListener("click", () => answer(true));
    $("falseBtn").addEventListener("click", () => answer(false));
    document.querySelectorAll("[data-grade]").forEach(btn =>
      btn.addEventListener("click", () => grade(btn.dataset.grade))
    );
    $("mockNextBtn").addEventListener("click", nextQuestion);
    $("homeBtn").addEventListener("click", renderHome);
    $("backHomeBtn").addEventListener("click", renderHome);
    $("refreshStatsBtn").addEventListener("click", updateDashboard);
    $("exportBtn").addEventListener("click", exportData);
    $("importInput").addEventListener("change", e => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    });
    $("resetBtn").addEventListener("click", () => {
      if (confirm("学習記録をすべて初期化しますか？")) {
        state = defaultState();
        saveState();
        updateDashboard();
      }
    });

    document.addEventListener("keydown", e => {
      if (!$("quizScreen").classList.contains("active")) return;
      if (!answered && e.key === "1") answer(true);
      else if (!answered && e.key === "2") answer(false);
      else if (answered && session?.mock && e.key === "Enter") nextQuestion();
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  if (!QUESTIONS.length) {
    document.body.innerHTML = "<p style='padding:24px'>問題データを読み込めませんでした。</p>";
    return;
  }

  bind();
  updateDashboard();
  registerServiceWorker();
})();
