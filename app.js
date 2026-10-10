(() => {
  "use strict";

  const QUESTIONS = (window.QUESTIONS || []).filter(q => q.verified === true);
  const FLASHCARDS = (window.FLASHCARDS || []);
  // v2と同じキーを維持。既存の学習履歴を引き継ぐ。
  const STORAGE_KEY = "bizlaw3_state_v2";
  const STATE_VERSION = 4;
  const INTERVALS = [1, 3, 7, 14, 30];
  const SESSION_LIMIT = 20;

  const $ = id => document.getElementById(id);
  const screens = ["homeScreen","categoryScreen","quizScreen","resultScreen","flashScreen"];

  let state = loadState();
  let session = null;
  let current = null;
  let answered = false;
  let lastAnswerCorrect = null;
  let flashSession = null;
  let shownFlash = null;

  function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }

  function addDays(n) {
    const d = new Date();
    d.setHours(12,0,0,0);
    d.setDate(d.getDate()+n);
    return todayKey(d);
  }

  function defaultState(){ return {version:STATE_VERSION,cards:{},daily:{},totalAnswered:0,flashStates:{},flashNewDaily:{}}; }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== "object") return defaultState();
      parsed.version = STATE_VERSION;
      parsed.cards ||= {};
      parsed.daily ||= {};
      parsed.totalAnswered ||= 0;
      parsed.flashStates ||= {};
      parsed.flashNewDaily ||= {};
      return parsed;
    }catch(e){
      return defaultState();
    }
  }

  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch(e){ console.warn("保存失敗",e); }
  }

  function cardState(id){
    if(!state.cards[id]){
      state.cards[id] = {
        seenCount:0,correctCount:0,wrongCount:0,lastAnswered:null,nextReview:null,
        stage:0,weak:false,uncertain:false
      };
    }
    return state.cards[id];
  }

  function showScreen(id){
    screens.forEach(s => $(s).classList.toggle("active", s===id));
    $("homeBtn").classList.toggle("hidden", id==="homeScreen");
    window.scrollTo({top:0,behavior:"instant"});
  }

  function shuffle(arr){
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function scoreWeight(q){
    const r=cardState(q.id);
    let w=1;
    if(r.weak) w+=4;
    if(r.uncertain) w+=3;
    if(r.wrongCount>0) w+=Math.min(4,r.wrongCount);
    if(r.seenCount===0) w+=1;
    return w;
  }

  function weightedUnique(list){
    const pool=[];
    list.forEach(q=>{
      const w=scoreWeight(q);
      for(let i=0;i<w;i++) pool.push(q);
    });
    const out=[], used=new Set();
    for(const q of shuffle(pool)){
      if(!used.has(q.id)){ used.add(q.id); out.push(q); }
    }
    return out;
  }

  function dueQuestions(){
    const today=todayKey();
    return QUESTIONS.filter(q=>{
      const r=cardState(q.id);
      return r.seenCount>0 && r.nextReview && r.nextReview<=today;
    });
  }

  function weakQuestions(){
    return QUESTIONS.filter(q=>{
      const r=cardState(q.id);
      return r.seenCount>0 && (r.weak || r.uncertain || r.wrongCount>r.correctCount);
    });
  }

  function startSession(mode, category=null, forced=null){
    let pool=[];
    if(forced) pool=forced;
    else if(mode==="due") pool=weightedUnique(dueQuestions());
    else if(mode==="weak") pool=weightedUnique(weakQuestions());
    else if(mode==="random") pool=weightedUnique(QUESTIONS);
    else if(mode==="civil") pool=weightedUnique(QUESTIONS.filter(q=>q.domain==="民法"));
    else if(mode==="lecture5") pool=weightedUnique(QUESTIONS.filter(q=>q.lecture===5));
    else if(mode==="category") pool=weightedUnique(QUESTIONS.filter(q=>q.category===category));
    else if(mode==="mock") pool=shuffle(QUESTIONS).slice(0,Math.min(20,QUESTIONS.length));
    else if(mode==="lecture6") pool=weightedUnique(QUESTIONS.filter(q=>q.lecture===6));
    else if(mode==="lecture7") pool=weightedUnique(QUESTIONS.filter(q=>q.lecture===7));
    else if(mode==="compare") pool=weightedUnique(QUESTIONS.filter(q=>q.compare===true));

    if(!pool.length){
      alert(mode==="due" ? "今日の復習はありません。全分野ランダムや民法特訓で新しい問題を進めてください。" : "該当する問題がありません。");
      renderHome();
      return;
    }

    const limit = mode==="mock" ? pool.length : Math.min(SESSION_LIMIT,pool.length);
    session={mode,category,queue:pool.slice(0,limit),index:0,results:[],mistakes:[],mock:mode==="mock"};
    showScreen("quizScreen");
    renderQuestion();
  }

  function modeName(){
    if(session.mock) return "模擬20問";
    if(session.mode==="due") return "今日の復習";
    if(session.mode==="weak") return "弱点だけ";
    if(session.mode==="civil") return "民法特訓";
    if(session.mode==="lecture5") return "第5回 復習";
    if(session.mode==="lecture6") return "第6回 弱点特訓";
    if(session.mode==="lecture7") return "第7回 重要論点";
    if(session.mode==="compare") return "混同特訓";
    if(session.mode==="category") return session.category;
    return "全分野ランダム";
  }

  function renderQuestion(){
    current=session.queue[session.index];
    answered=false;
    lastAnswerCorrect=null;
    $("modeLabel").textContent=modeName();
    $("progressLabel").textContent=`${session.index+1} / ${session.queue.length}`;
    $("progressBar").style.width=`${(session.index/session.queue.length)*100}%`;
    $("categoryTag").textContent=current.category;
    $("subCategoryTag").textContent=current.subCategory;
    $("domainTag").textContent=current.domain;
    if(current.lecture){
      $("lectureTag").textContent=`第${current.lecture}回`;
      $("lectureTag").classList.remove("hidden");
    }else $("lectureTag").classList.add("hidden");
    $("questionText").textContent=current.question;
    $("answerButtons").classList.remove("hidden");
    $("explanationBox").classList.add("hidden");
    $("gradeButtons").classList.toggle("hidden",session.mock);
    $("mockNextBtn").classList.toggle("hidden",!session.mock);
  }

  function answer(value){
    if(!current || answered) return;
    answered=true;
    lastAnswerCorrect=(value===current.answer);
    const r=cardState(current.id);
    r.seenCount+=1;
    r.lastAnswered=todayKey();
    if(lastAnswerCorrect) r.correctCount+=1;
    else{
      r.wrongCount+=1;
      r.weak=true;
      r.uncertain=false;
      r.stage=0;
      r.nextReview=addDays(1);
    }

    const dk=todayKey();
    state.daily[dk] ||= {answered:0,correct:0};
    state.daily[dk].answered+=1;
    if(lastAnswerCorrect) state.daily[dk].correct+=1;
    state.totalAnswered+=1;

    session.results.push({id:current.id,correct:lastAnswerCorrect,category:current.category});
    if(!lastAnswerCorrect) session.mistakes.push(current.id);

    $("verdict").textContent=lastAnswerCorrect ? "正解" : "不正解";
    $("verdict").style.color=lastAnswerCorrect ? "#166534" : "#991b1b";
    $("explanationText").textContent=current.explanation;
    $("memoryTip").textContent=current.memoryTip;
    $("confusionText").textContent=current.confusion;
    $("sourceText").textContent=`${current.source} ${current.sourcePage}`;
    $("answerButtons").classList.add("hidden");
    $("explanationBox").classList.remove("hidden");
    saveState();
  }

  function grade(kind){
    if(!current || !answered) return;
    const r=cardState(current.id);

    if(!lastAnswerCorrect){
      // 正答できなかった問題は自己評価が「分かった」でも翌日再確認
      r.weak=true; r.stage=0; r.nextReview=addDays(1);
      r.uncertain=(kind==="uncertain");
    }else if(kind==="wrong"){
      r.weak=true; r.uncertain=false; r.stage=0; r.nextReview=addDays(1);
    }else if(kind==="uncertain"){
      r.weak=true; r.uncertain=true; r.nextReview=addDays(1);
    }else{
      r.uncertain=false;
      r.stage=Math.min((r.stage||0)+1,INTERVALS.length);
      r.nextReview=addDays(INTERVALS[r.stage-1]||30);
      if(r.stage>=3 && r.correctCount>=r.wrongCount) r.weak=false;
    }

    saveState();
    nextQuestion();
  }

  function nextQuestion(){
    session.index+=1;
    if(session.index>=session.queue.length){
      if(session.mock) renderMockResult();
      else{
        alert("このセッションは終了です。");
        renderHome();
      }
      return;
    }
    renderQuestion();
  }

  function renderMockResult(){
    showScreen("resultScreen");
    const correct=session.results.filter(r=>r.correct).length;
    const total=session.results.length;
    const pct=Math.round(correct/total*100);
    $("mockScore").textContent=`${correct} / ${total}　${pct}%`;

    const byCat={};
    session.results.forEach(r=>{
      byCat[r.category] ||= {total:0,correct:0};
      byCat[r.category].total++;
      if(r.correct) byCat[r.category].correct++;
    });
    $("mockBreakdown").innerHTML=Object.entries(byCat)
      .sort((a,b)=>a[0].localeCompare(b[0],"ja"))
      .map(([cat,v])=>`<div class="mock-line"><span>${escapeHtml(cat)}</span><strong>${v.correct}/${v.total}</strong></div>`)
      .join("");

    const mistakes=[...new Set(session.mistakes)];
    $("mockMistakes").innerHTML=mistakes.length
      ? `<h3>誤答 ${mistakes.length}問</h3>`+mistakes.map(id=>{
          const q=QUESTIONS.find(x=>x.id===id);
          return `<div class="mistake-item">${escapeHtml(q.question)}<small>${escapeHtml(q.memoryTip)}</small></div>`;
        }).join("")
      : "<h3>誤答なし</h3><p>20問すべて正解です。</p>";

    $("reviewMistakesBtn").disabled=mistakes.length===0;
    $("reviewMistakesBtn").onclick=()=>{
      const selected=mistakes.map(id=>QUESTIONS.find(q=>q.id===id)).filter(Boolean);
      startSession("weak",null,selected);
    };
  }

  function renderHome(){
    showScreen("homeScreen");
    updateDashboard();
  }

  function updateDashboard(){
    const d=state.daily[todayKey()]||{answered:0,correct:0};
    $("todayAnswered").textContent=d.answered;
    $("todayAccuracy").textContent=d.answered ? Math.round(d.correct/d.answered*100) : "-";
    $("dueCount").textContent=dueQuestions().length;
    $("totalAnswered").textContent=state.totalAnswered||0;
    updateFlashStats();

    const civil=QUESTIONS.filter(q=>q.domain==="民法").length;
    const l5=QUESTIONS.filter(q=>q.lecture===5).length;
    $("bankSummary").textContent=`収録 ${QUESTIONS.length}問 ／ 第6回補強30問 ／ 第7回新規50問 ／ 暗記カード${FLASHCARDS.length}枚`;

    const cats=[...new Set(QUESTIONS.map(q=>q.category))];
    $("categoryStats").innerHTML=cats.map(cat=>{
      const list=QUESTIONS.filter(q=>q.category===cat);
      let correct=0,wrong=0,weak=0;
      list.forEach(q=>{
        const r=cardState(q.id);
        correct+=r.correctCount;
        wrong+=r.wrongCount;
        if(r.seenCount>0 && (r.weak||r.uncertain)) weak++;
      });
      const attempts=correct+wrong;
      const pct=attempts ? Math.round(correct/attempts*100) : null;
      return `<div class="category-row">
        <div class="name">${escapeHtml(cat)}</div>
        <div class="meta">${attempts}回答 / 要復習${weak}</div>
        <div class="pct">${pct===null?"-":pct+"%"}</div>
      </div>`;
    }).join("");
  }

  function renderCategoryButtons(){
    const cats=[...new Set(QUESTIONS.map(q=>q.category))];
    $("categoryButtons").innerHTML="";
    cats.forEach(cat=>{
      const count=QUESTIONS.filter(q=>q.category===cat).length;
      const btn=document.createElement("button");
      btn.type="button";
      btn.innerHTML=`${escapeHtml(cat)}<br><small>${count}問</small>`;
      btn.addEventListener("click",()=>startSession("category",cat));
      $("categoryButtons").appendChild(btn);
    });
  }

  function exportData(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=`bizlaw3-study-${todayKey()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file){
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(reader.result);
        if(!parsed || typeof parsed!=="object" || !parsed.cards) throw new Error("invalid");
        parsed.version=STATE_VERSION; parsed.daily ||= {}; parsed.totalAnswered ||= 0; parsed.flashStates ||= {}; parsed.flashNewDaily ||= {};
      parsed.flashStates ||= {};
      parsed.flashNewDaily ||= {};
        state=parsed; saveState(); updateDashboard(); alert("学習データを読み込みました。");
      }catch(e){ alert("読み込めないJSONです。"); }
    };
    reader.readAsText(file);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }


  function flashState(id){
    if(!state.flashStates[id]){
      state.flashStates[id]={seenCount:0,stage:0,nextReview:null,lastAnswered:null,misses:0};
    }
    return state.flashStates[id];
  }
  function flashDue(){
    const t=todayKey();
    return FLASHCARDS.filter(f=>{
      const s=flashState(f.id);
      return s.seenCount>0 && s.nextReview && s.nextReview<=t;
    });
  }
  function flashNewAvailable(){
    const remaining=Math.max(0,5-(state.flashNewDaily[todayKey()]||0));
    if(!remaining) return [];
    return FLASHCARDS.filter(f=>flashState(f.id).seenCount===0).slice(0,remaining);
  }
  function updateFlashStats(){
    const due=flashDue().length;
    const fresh=flashNewAvailable().length;
    $("flashProgressLabel").textContent=`復習${due}枚＋新規${fresh}枚`;
    $("startFlashBtn").textContent=(due+fresh)?`今日のカード ${due+fresh}枚を開始`:'今日のカードは完了';
  }
  function startFlash(){
    const due=flashDue().sort((a,b)=>(flashState(b.id).misses||0)-(flashState(a.id).misses||0));
    const fresh=flashNewAvailable();
    const queue=[...due,...fresh];
    if(!queue.length){alert("今日のカードは完了です。翌日の復習を待ちましょう。");return;}
    flashSession={queue,index:0};
    showScreen("flashScreen");
    renderFlash();
  }
  function renderFlash(){
    shownFlash=flashSession.queue[flashSession.index];
    $("flashCount").textContent=`${flashSession.index+1}/${flashSession.queue.length}`;
    $("flashProgressBar").style.width=`${flashSession.index/flashSession.queue.length*100}%`;
    $("flashTag").textContent=shownFlash.category;
    $("flashOrigin").textContent=`第${shownFlash.lecture}回`;
    $("flashFront").textContent=shownFlash.front;
    $("flashBack").textContent=shownFlash.back;
    $("flashHiddenArea").classList.remove("hidden");
    $("flashRevealedArea").classList.add("hidden");
  }
  function revealFlash(){
    $("flashHiddenArea").classList.add("hidden");
    $("flashRevealedArea").classList.remove("hidden");
  }
  function gradeFlash(kind){
    if(!shownFlash || !flashSession || $("flashRevealedArea").classList.contains("hidden")) return;
    const s=flashState(shownFlash.id);
    const fresh=s.seenCount===0;
    s.seenCount++;
    s.lastAnswered=todayKey();
    if(fresh) state.flashNewDaily[todayKey()]=(state.flashNewDaily[todayKey()]||0)+1;
    if(kind==='again'){
      s.misses++; s.stage=0; s.nextReview=addDays(1);
    } else if(kind==='hard'){
      s.misses++; s.stage=Math.max(0,s.stage-1); s.nextReview=addDays(1);
    } else {
      s.stage=Math.min((s.stage||0)+1,INTERVALS.length);
      s.nextReview=addDays(INTERVALS[s.stage-1]||30);
    }
    saveState();
    flashSession.index++;
    if(flashSession.index>=flashSession.queue.length){
      flashSession=null; shownFlash=null;
      alert("今日の暗記カードが終わりました。忘れた・怪しいカードは翌日また出ます。");
      renderHome();
    }else renderFlash();
  }

  function bind(){
    $("startFlashBtn").addEventListener("click",startFlash);
    $("flashRevealBtn").addEventListener("click",revealFlash);
    document.querySelectorAll("[data-flash-grade]").forEach(btn=>btn.addEventListener("click",()=>gradeFlash(btn.dataset.flashGrade)));
    document.querySelectorAll("[data-mode]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const mode=btn.dataset.mode;
        if(mode==="category"){ renderCategoryButtons(); showScreen("categoryScreen"); }
        else startSession(mode);
      });
    });
    $("trueBtn").addEventListener("click",()=>answer(true));
    $("falseBtn").addEventListener("click",()=>answer(false));
    document.querySelectorAll("[data-grade]").forEach(btn=>btn.addEventListener("click",()=>grade(btn.dataset.grade)));
    $("mockNextBtn").addEventListener("click",nextQuestion);
    $("homeBtn").addEventListener("click",renderHome);
    $("backHomeBtn").addEventListener("click",renderHome);
    $("refreshStatsBtn").addEventListener("click",updateDashboard);
    $("exportBtn").addEventListener("click",exportData);
    $("importInput").addEventListener("change",e=>{
      const f=e.target.files&&e.target.files[0];
      if(f) importData(f);
      e.target.value="";
    });
    $("resetBtn").addEventListener("click",()=>{
      if(confirm("学習記録をすべて初期化しますか？")){
        state=defaultState(); saveState(); updateDashboard();
      }
    });
    document.addEventListener("keydown",e=>{
      if(!$("quizScreen").classList.contains("active")) return;
      if(!answered && e.key==="1") answer(true);
      else if(!answered && e.key==="2") answer(false);
      else if(answered && session?.mock && e.key==="Enter") nextQuestion();
    });
  }

  function registerSW(){
    if("serviceWorker" in navigator && location.protocol.startsWith("http")){
      navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
    }
  }

  if(!QUESTIONS.length){
    document.body.innerHTML="<p style='padding:24px'>問題データを読み込めませんでした。</p>";
    return;
  }
  bind(); updateDashboard(); registerSW();
})();
