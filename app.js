// app.js — Vanilla SPA: routing, decks, review (type->check->show->rate+Next), stats (bar chart), theme, menus, PWA

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Toasts */
function toast(msg, type = 'info') {
  const box = $('#toast-container'); if (!box) return alert(msg);
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 150); }, 2600);
}

/* State */
const state = {
  currentDeckId: null,
  session: null,
  timerId: null,
  fs: { text: '', min: 0, sort: 'updated_desc' },
  statsRange: 'today'
};

/* Boot */
document.addEventListener('DOMContentLoaded', boot);
function boot() {
  DB.load();
  applyUserSettings();
  markThemeActive();
  ensureReviewControlsInDom();   // make sure review buttons/progress are inside Review
  hydrateDeckGrids();
  initRouter();
  initControls();
  initStatsModal();
  initCardModal();
  initFilterSort();
  initGlobalSearch();
  initReviewInputs();
  registerSW();
  handleHashChange();
}

/* Router */
const routes = { home:'view-home', browse:'view-browse', review:'view-review', create:'view-create', settings:'view-settings' };
const titles = { home:'Home Dashboard', browse:'Deck Browser', review:'Flashcard Review', create:'Create New Deck', settings:'Settings' };
const topActionSets = {
  home:   [{label:'Create Deck',kind:'outline',nav:'#/create'},{label:'Start Review',kind:'primary',nav:'#/review'}],
  browse: [{label:'Filter',kind:'outline',id:'open-fs'},{label:'Sort',kind:'outline',id:'open-fs'},{label:'New Deck',kind:'primary',nav:'#/create'}],
  review: [{label:'Pause',kind:'outline',id:'btn-pause'},{label:'Stats',kind:'outline',open:'stats'}],
  create: [{label:'Guide',kind:'outline',id:'btn-guide'}],
  settings:[{label:'Help',kind:'outline',id:'btn-help'}]
};

function setActiveView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(routes[name] || routes.home);
  if (view) view.classList.add('active');

  $('#crumb-title').textContent = titles[name] || titles.home;
  $$('.side-nav .nav-link').forEach(a => a.classList.remove('active'));
  const link = document.getElementById(`nav-${name}`); if (link) link.classList.add('active');

  const actions = $('#top-actions'); actions.innerHTML = '';
  (topActionSets[name] || []).forEach(act => {
    const b = document.createElement('button');
    b.className = 'btn ' + (act.kind === 'primary' ? 'btn-primary' : 'btn-outline');
    b.textContent = act.label;
    if (act.nav) b.addEventListener('click', () => navigate(act.nav));
    if (act.id === 'btn-pause') b.addEventListener('click', togglePause);
    if (act.open === 'stats') b.addEventListener('click', openStats);
    if (act.id === 'open-fs') b.addEventListener('click', openFS);
    if (act.id === 'btn-guide') b.addEventListener('click', () => toast('Guide coming soon.'));
    if (act.id === 'btn-help') b.addEventListener('click', () => toast('Help center coming soon.'));
    actions.appendChild(b);
  });

  // show review-only UI only on Review page
  toggleReviewOnlyUI(name === 'review');

  if (name === 'review') ensureDeckForReview();
}

function navigate(hash){ window.location.hash = hash; }
function handleHashChange(){ const hash = window.location.hash || '#/home'; setActiveView(hash.replace('#/','') || 'home'); }
function initRouter(){
  window.addEventListener('hashchange', handleHashChange);
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]'); if (!btn) return;
    e.preventDefault(); navigate(btn.getAttribute('data-nav'));
  });
}

/* Ensure review controls live inside Review section; add Next button */
function ensureReviewControlsInDom() {
  const view = $('#view-review'); if (!view) return;

  // Move first .rate-grid found into Review (if needed)
  let rateGrid = view.querySelector('.rate-grid');
  if (!rateGrid) {
    const anyGrid = document.querySelector('.rate-grid');
    if (anyGrid && !view.contains(anyGrid)) {
      rateGrid = anyGrid; view.appendChild(rateGrid);
    }
  }
  // Create rating grid if missing (edge)
  if (!rateGrid) {
    rateGrid = document.createElement('div');
    rateGrid.className = 'rate-grid';
    rateGrid.innerHTML = `
      <button class="btn btn-pill danger">Again</button>
      <button class="btn btn-pill info">Hard</button>
      <button class="btn btn-pill lilac">Good</button>
      <button class="btn btn-pill success">Easy</button>
    `;
    view.appendChild(rateGrid);
  }
  // Center via inline (in case CSS wasn’t applied)
  rateGrid.style.maxWidth = '820px';
  rateGrid.style.margin = '14px auto 0';

  // Add Next button row (spans all columns)
  if (!$('#next-card')) {
    const row = document.createElement('div');
    row.style.gridColumn = '1 / -1';
    row.style.display = 'flex';
    row.style.justifyContent = 'center';
    row.style.marginTop = '6px';
    const nextBtn = document.createElement('button');
    nextBtn.id = 'next-card';
    nextBtn.className = 'btn btn-outline small';
    nextBtn.textContent = 'Next ▶';
    row.appendChild(nextBtn);
    rateGrid.appendChild(row);
  }

  // Move progress row into Review (if needed)
  let progress = view.querySelector('.progress-wide');
  if (!progress) {
    const anyProg = document.querySelector('.progress-wide');
    if (anyProg && !view.contains(anyProg)) {
      progress = anyProg; view.appendChild(progress);
    }
  }
  if (progress) {
    progress.style.maxWidth = '820px';
    progress.style.margin = '12px auto 0';
  }

  // Wire Next button
  $('#next-card')?.addEventListener('click', () => handleRateClick(3)); // default: Good
}

function toggleReviewOnlyUI(isReview) {
  // Hide all .rate-grid and .progress-wide globally
  $$('.rate-grid').forEach(el => el.style.display = 'none');
  $$('.progress-wide').forEach(el => el.style.display = 'none');
  // Show inside Review only
  if (isReview) {
    $('#view-review .rate-grid')?.style.setProperty('display','grid');
    $('#view-review .progress-wide')?.style.setProperty('display','flex');
  }
}

/* Decks + Filter/Sort */
function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s<60) return 'just now';
  const m = Math.floor(s/60); if (m<60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h<24) return `${h}h ago`;
  const d = Math.floor(h/24); if (d<7) return `${d}d ago`;
  return `${Math.floor(d/7)}w ago`;
}

function getFilteredSortedDecks(){
  const list = DB.listDecks().map(d => ({...d, count: DB.countCardsByDeck(d.id)}));
  const t = state.fs.text.trim().toLowerCase();
  let f = list.filter(d => (!t || d.name.toLowerCase().includes(t)) && d.count >= (state.fs.min||0));
  if (state.fs.sort==='name_az') f.sort((a,b)=>a.name.localeCompare(b.name));
  if (state.fs.sort==='cards_desc') f.sort((a,b)=>b.count-a.count);
  if (state.fs.sort==='updated_desc') f.sort((a,b)=>b.updatedAt-a.updatedAt);
  return f;
}

function renderDeckCard(deck){
  const el = document.createElement('div');
  el.className = 'deck-card';
  el.innerHTML = `
    <div class="deck-row">
      <div class="deck-title">${deck.name}</div>
      <button class="btn btn-outline small deck-menu-btn" title="More">•••</button>
    </div>
    <div class="muted small">Last studied ${timeAgo(deck.updatedAt)}</div>
    <div class="deck-row">
      <div class="muted small"><strong>${deck.count}</strong> cards</div>
      <div class="deck-actions">
        <button class="btn btn-outline small" data-review="${deck.id}">▶ Review</button>
        <button class="btn btn-outline small" data-add-card="${deck.id}">＋ Add Card</button>
      </div>
    </div>`;

  el.querySelector('[data-review]').addEventListener('click',()=>{ state.currentDeckId = deck.id; navigate('#/review'); });
  el.querySelector('[data-add-card]').addEventListener('click',()=> openCardModal(deck.id));

  // Minimal menu: delete or rename
  el.querySelector('.deck-menu-btn').addEventListener('click', () => {
    const act = prompt(`Menu for "${deck.name}"\nType: delete, rename, or cancel`, 'delete');
    if (!act) return;
    if (act.toLowerCase() === 'delete') {
      if (confirm(`Delete "${deck.name}" and all its cards?`)) {
        DB.deleteDeck(deck.id); hydrateDeckGrids(); toast('Deck deleted','success');
      }
    } else if (act.toLowerCase() === 'rename') {
      const name = prompt('New deck name:', deck.name);
      if (name && name.trim()) { DB.updateDeck(deck.id, { name: name.trim() }); hydrateDeckGrids(); toast('Deck renamed','success'); }
    }
  });

  return el;
}

function hydrateDeckGrids(){
  const decks = getFilteredSortedDecks();
  const homeGrid = $('#home-deck-grid');
  const browseGrid = $('#browse-deck-grid');
  if (homeGrid){ homeGrid.innerHTML=''; decks.slice(0,6).forEach(d=>homeGrid.appendChild(renderDeckCard(d))); }
  if (browseGrid){ browseGrid.innerHTML=''; decks.forEach(d=>browseGrid.appendChild(renderDeckCard(d))); }
}

/* Controls */
function initControls(){
  const toggle = $('#gridtoggle'), grid = $('#browse-deck-grid');
  if (toggle && grid){
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg'); if (!btn) return;
      $$('.seg',toggle).forEach(s=>s.classList.remove('active')); btn.classList.add('active');
      grid.style.gridTemplateColumns = btn.getAttribute('data-mode') === 'list' ? '1fr' : 'repeat(3, 1fr)';
    });
  }
  $$('.segmented').forEach(group=>{
    group.addEventListener('click', e=>{
      const btn=e.target.closest('.seg'); if (!btn) return;
      $$('.seg',group).forEach(s=>s.classList.remove('active')); btn.classList.add('active');
    });
  });
  $('#view-create .preview-actions .btn.btn-primary')?.addEventListener('click',()=>{
    const name=$('#deck-name').value.trim(); const desc=$('#deck-desc').value.trim();
    if (!name) return alert('Enter a deck name');
    const d=DB.addDeck(name,desc); hydrateDeckGrids(); state.currentDeckId=d.id; toast('Deck created','success'); navigate('#/browse');
  });
  $('#view-create .preview-actions .btn.btn-outline:nth-child(2)')?.addEventListener('click',()=>{
    const name=$('#deck-name').value.trim(); const desc=$('#deck-desc').value.trim();
    if (!name) return alert('Enter a deck name');
    const d=DB.addDeck(name,desc); hydrateDeckGrids(); openCardModal(d.id); toast('Deck created — add your first card','success');
  });
  $('#view-create .callout .btn')?.addEventListener('click',()=>openCardModal(state.currentDeckId||''));

  const importBtn = $('#view-create .row-tools .btn.btn-outline:first-child');
  if (importBtn) importBtn.addEventListener('click',()=>$('#import-file').click());
  $('#import-file')?.addEventListener('change', async e=>{
    const file=e.target.files?.[0]; if (!file) return;
    const text=await file.text();
    try { DB.importJSON(text,'replace'); hydrateDeckGrids(); toast('Import successful','success'); }
    catch(err){ toast(err.message||'Import failed','error'); }
    finally { e.target.value=''; }
  });

  document.querySelector('#view-settings .row-header .btn')?.addEventListener('click',()=>{
    DB.setSettings({ dailyNew:20, dailyReviewLimit:200, steps:[1,10], easeFactor:2.5, theme:'system', cardFont:'medium', animations:true });
    applyUserSettings(); markThemeActive(); toast('Settings reset','info');
  });

  const appearanceCard = $$('#view-settings .card')[2];
  if (appearanceCard){
    const themeGroup = appearanceCard.querySelector('[data-toggle="theme"]');
    if (themeGroup) themeGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg'); if (!btn) return;
      DB.setSettings({ theme: btn.textContent.trim().toLowerCase() }); applyUserSettings(); markThemeActive(); toast('Theme updated','info');
    });
    const fontGroup = appearanceCard.querySelectorAll('.segmented')[1];
    if (fontGroup) fontGroup.addEventListener('click', (e) => {
      const btn=e.target.closest('.seg'); if (!btn) return;
      DB.setSettings({ cardFont: btn.textContent.toLowerCase().includes('large')?'large':'medium' }); applyUserSettings();
    });
    const animGroup = appearanceCard.querySelectorAll('.segmented')[2];
    if (animGroup) animGroup.addEventListener('click', (e) => {
      const btn=e.target.closest('.seg'); if (!btn) return;
      DB.setSettings({ animations: btn.textContent.trim().toLowerCase()==='on' }); applyUserSettings();
    });
  }

  $('#delete-account')?.addEventListener('click',()=>{
    if (confirm('Delete all local data? This cannot be undone.')){ localStorage.removeItem('recallify_db_v1'); location.reload(); }
  });
  $('#export-data')?.addEventListener('click',()=>{
    const blob=new Blob([localStorage.getItem('recallify_db_v1')||'{}'],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='recallify-export.json'; a.click();
  });
}

/* Review — choose a deck with cards, allow switching */
function ensureDeckForReview(){
  const decks = DB.listDecks();
  if (!decks.length){ renderEmptyReview('No decks yet. Create one first.'); return; }

  const hasCards = (id) => DB.countCardsByDeck(id) > 0;
  if (!state.currentDeckId || !hasCards(state.currentDeckId)){
    const pick = decks.find(d => hasCards(d.id)) || decks[0];
    state.currentDeckId = pick?.id || null;
  }
  if (!state.currentDeckId){ renderEmptyReview('No cards to review. Add a card to any deck.'); return; }

  const nameSpan = $('#review-deck-name'); if (nameSpan) nameSpan.textContent = DB.deckById(state.currentDeckId)?.name || 'Deck';
  const changeBtn = $('#review-change-deck');
  if (changeBtn){
    changeBtn.onclick = () => {
      const all = DB.listDecks(); if (!all.length) return;
      let idx = all.findIndex(d => d.id === state.currentDeckId);
      for (let i=0;i<all.length;i++){
        idx = (idx + 1) % all.length;
        if (DB.countCardsByDeck(all[idx].id) > 0) { state.currentDeckId = all[idx].id; break; }
      }
      if (nameSpan) nameSpan.textContent = DB.deckById(state.currentDeckId)?.name || 'Deck';
      startSession(state.currentDeckId);
      toast(`Switched to ${nameSpan.textContent}`,'info');
    };
  }
  startSession(state.currentDeckId);
}

function renderEmptyReview(msg){
  const term = $('#view-review .main-flash .flash-term');
  const sub  = $('#view-review .main-flash .flash-sub');
  const ex   = $('#view-review .main-flash .flash-example');
  if (term){ term.textContent = msg; sub.textContent=''; ex.textContent=''; }
}

/* Review session */
function startSession(deckId){
  state.currentDeckId = deckId;
  const settings = DB.getSettings();
  const { queue, counts, total } = DB.getSessionQueue(deckId, 50);
  state.session = {
    deckId, settings,
    queue: queue.map(c=>c.id),
    index: 0, size: total,
    counts: { ...counts },
    revealed: false,
    startTs: Date.now(),
    clockStart: Date.now(),
    paused: false,
    elapsedMs: 0,
    lastCheck: null,
    lastRenderedId: null
  };
  renderReview();
  startTimer();
}

function currentCard(){
  if (!state.session) return null;
  const id = state.session.queue[state.session.index];
  if (!id) return null;
  return DB.cardsByDeck(state.session.deckId).find(c=>c.id===id);
}

/* Normalize + fuzzy compare */
function normalize(s){ return (s||'').toLowerCase().trim().replace(/[^\p{L}\p{N}\s]+/gu,'').replace(/\s+/g,' '); }
function levenshtein(a,b){
  const m=a.length, n=b.length; if(!m) return n; if(!n) return m;
  const dp=Array.from({length:m+1},(_,i)=>[i]);
  for(let j=1;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function similarity(a,b){
  const A=normalize(a), B=normalize(b);
  if (!A && !B) return 1;
  const dist=levenshtein(A,B);
  return 1 - dist / Math.max(A.length, B.length);
}

/* Answer check (no reveal here) + Show Answer button */
function initReviewInputs(){
  const input  = $('#answer-input');
  const btn    = $('#check-answer');
  const reveal = $('#reveal-answer');

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); checkAnswer(); }
    });
  }
  if (btn) btn.addEventListener('click', checkAnswer);
  if (reveal) reveal.addEventListener('click', () => {
    if (!state.session) return;
    state.session.revealed = true;
    renderReview();
  });
}

function checkAnswer(){
  if (!state.session) return false;
  const card = currentCard(); if (!card) return false;
  const input = $('#answer-input'); const fb = $('#answer-feedback');
  const given = (input?.value || '').trim();
  const expected = card.back || '';
  const sim = similarity(given, expected);
  const correct = sim >= 0.85 || normalize(given) === normalize(expected);

  // Only store check; DO NOT reveal here
  state.session.lastCheck = { given, expected, correct, sim };

  if (fb){
    fb.classList.remove('good','bad');
    fb.classList.add(correct ? 'good' : 'bad');
    fb.textContent = correct ? `Correct (${Math.round(sim*100)}%)` : `Incorrect (${Math.round(sim*100)}%)`;
  }
  return correct;
}

/* Render */
function renderReview(){
  if (!state.session) return;
  const card = currentCard();

  // left counts
  const leftKV = $('#view-review .card .kv');
  if (leftKV) {
    leftKV.children[1].textContent = state.session.counts.new;
    leftKV.children[3].textContent = state.session.counts.learning;
    leftKV.children[5].textContent = state.session.counts.review;
  }

  // x / n
  const progText = $('#view-review .review-toprow .pill-row:last-child .muted');
  if (progText) progText.textContent = `${Math.min(state.session.index + 1, state.session.size)} / ${state.session.size}`;

  // progress bar
  const pbar = $('#view-review .progress .progress-bar');
  if (pbar) {
    const pct = state.session.size ? ((state.session.index) / state.session.size) * 100 : 0;
    pbar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  const term = $('#view-review .main-flash .flash-term');
  const sub  = $('#view-review .main-flash .flash-sub');
  const ex   = $('#view-review .main-flash .flash-example');
  const input= $('#answer-input');
  const fb   = $('#answer-feedback');

  if (card) {
    term.textContent = card.front || '—';
    if (!state.session.revealed) {
      sub.textContent = 'Type your answer, click Check. Use “Show Answer” to reveal.';
      ex.textContent  = '';
      if (fb){ fb.textContent=''; fb.classList.remove('good','bad'); }
    } else {
      sub.textContent = card.back || '';
      ex.textContent  = card.notes || '';
    }
    if (input){
      if (state.session.lastRenderedId !== card.id){
        input.value = '';
        if (fb){ fb.textContent=''; fb.classList.remove('good','bad'); }
        state.session.lastRenderedId = card.id;
      }
      input.disabled = false;
    }
  } else {
    term.textContent = 'Session complete 🎉';
    sub.textContent  = 'Open Stats to see results.';
    ex.textContent   = '';
    if (input) input.disabled = true;
  }

  // keyboard shortcuts (ignore when typing)
  document.onkeydown = (e) => {
    if (!$('#view-review').classList.contains('active')) return;
    if (!state.session) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return; // don't hijack typing
    if (e.code === 'Space') { e.preventDefault(); state.session.revealed = true; renderReview(); }
    if (e.key === '1') return handleRateClick(1);
    if (e.key === '2') return handleRateClick(2);
    if (e.key === '3') return handleRateClick(3);
    if (e.key === '4') return handleRateClick(4);
  };

  // rating buttons
  const container = $('#view-review .rate-grid');
  if (container) {
    const btns = container.querySelectorAll('.btn');
    // first 4 are rating buttons, Next is separate row
    if (btns.length >= 4) {
      btns[0].onclick = () => handleRateClick(1); // Again
      btns[1].onclick = () => handleRateClick(2); // Hard
      btns[2].onclick = () => handleRateClick(3); // Good
      btns[3].onclick = () => handleRateClick(4); // Easy
    }
  }
}

function handleRateClick(rating){
  if (!state.session) return;
  if (!state.session.lastCheck) checkAnswer(); // silent check if user didn't press Check
  rateCurrent(rating);
}

function rateCurrent(rating){
  const sess = state.session;
  const card = currentCard(); if (!card) return;

  const spent = Date.now() - (sess.lastFlipTs || sess.clockStart);
  const { patch, meta } = SRS.rate(card, rating, sess.settings, Date.now());
  DB.updateCard(card.id, patch);

  DB.recordReview({
    id: 'r_' + Math.random().toString(36).slice(2,10),
    cardId: card.id,
    deckId: card.deckId,
    rating,
    timeTaken: spent,
    ts: Date.now(),
    correct: sess.lastCheck ? !!sess.lastCheck.correct : (rating >= 3),
    typed:   sess.lastCheck?.given || '',
    similarity: sess.lastCheck?.sim ?? null,
    before: meta.before,
    after:  meta.after
  });

  const bState = meta.before.state;
  if (bState === 'new')      sess.counts.new = Math.max(0, sess.counts.new - 1);
  if (bState === 'learning') sess.counts.learning = Math.max(0, sess.counts.learning - 1);
  if (bState === 'review')   sess.counts.review = Math.max(0, sess.counts.review - 1);

  sess.index += 1;
  sess.revealed = false;
  sess.lastCheck = null;

  if (sess.index >= sess.size){
    stopTimer();
    DB.updateDeck(sess.deckId, { updatedAt: Date.now() });
    hydrateDeckGrids();
    renderReview();
    toast('Session complete','success');
    openStats();
    return;
  }
  renderReview();
}

/* Timer */
function startTimer(){
  stopTimer();
  const badge = $('#view-review .review-toprow .pill-row:last-child .pill.soft');
  state.timerId = setInterval(()=>{
    if (!state.session || state.session.paused) return;
    const elapsed = Date.now() - state.session.startTs - state.session.elapsedMs;
    const s = Math.floor(elapsed/1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    if (badge) badge.textContent = `⏱ ${mm}:${ss}`;
  },250);
}
function stopTimer(){ if (state.timerId) clearInterval(state.timerId); state.timerId=null; }
function togglePause(){ if (!state.session) return; state.session.paused = !state.session.paused; toast(state.session.paused?'Paused':'Resumed','info'); }

/* Stats modal + bar chart */
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return +d; }
function rangeToSince(range){ if(range==='7d') return Date.now()-7*86400000; if(range==='30d') return Date.now()-30*86400000; return startOfToday(); }

function openStats(){
  fillStats(state.statsRange);                     // numbers
  const m=$('#stats-modal'); const p=$('#stats-modal .modal-panel');
  m.classList.remove('hidden'); requestAnimationFrame(()=>m.classList.add('show'));
  setTimeout(()=>{ p.focus({preventScroll:true}); fillStats(state.statsRange); }, 60); // redraw chart after layout
}
function closeStats(){ const m=$('#stats-modal'); m.classList.remove('show'); setTimeout(()=>m.classList.add('hidden'),180); }

function fillStats(range='today'){
  state.statsRange = range;
  const segs = $$('#stats-modal .segmented .seg'); segs.forEach(s=>s.classList.remove('active'));
  ({today:0,'7d':1,'30d':2}[range]!==undefined) && segs[{today:0,'7d':1,'30d':2}[range]]?.classList.add('active');

  const since = rangeToSince(range);
  const deckId = state.currentDeckId;
  const logs = DB.listReviewLogs({ deckId, since });

  const reviewed = logs.length;
  const correctCt = logs.filter(l => l.correct === true || (l.correct === undefined && l.rating >= 3)).length;
  const incorrectCt = reviewed - correctCt;
  const accuracy = reviewed ? Math.round((correctCt/reviewed)*100) : 0;

  const avgEase = logs.length ? (logs.reduce((a,l)=>a + (l.after.ease || l.before.ease || 2.5),0)/logs.length).toFixed(2) : '—';
  const avgTime = logs.length ? (logs.reduce((a,l)=>a + (l.timeTaken||0),0)/logs.length/1000).toFixed(1)+'s' : '—';
  const longestStreak = (()=>{ let best=0,cur=0; logs.forEach(l=>{ if (l.correct === true || (l.correct === undefined && l.rating>=3)) cur++; else cur=0; best=Math.max(best,cur); }); return best; })();
  const mature = logs.filter(l=>l.before.state==='review').length;
  const young = reviewed - mature;

  const left = $$('#stats-modal .stats-left .card');
  if (left[0]){ left[0].querySelector('.big').textContent = reviewed; left[0].querySelector('.small').textContent =
    `${logs.filter(l=>l.before.state==='new').length} new • ${logs.filter(l=>l.before.state==='learning').length} learning • ${logs.filter(l=>l.before.state==='review').length} review`; }
  if (left[1]){ left[1].querySelector('.big').textContent = `${accuracy}%`; left[1].querySelector('.small').textContent = `${correctCt} correct / ${incorrectCt} incorrect`; }
  if (left[2]){ const kv=left[2].querySelector('.kv'); kv.children[1].textContent=avgEase; kv.children[3].textContent=avgTime; kv.children[5].textContent=String(longestStreak); kv.children[7].textContent=`${mature} / ${young}`; }

  // Bar chart: Answer Distribution (ratings 1..4)
  renderAnswerDistributionChart(logs);
}

function renderAnswerDistributionChart(logs){
  const card = Array.from($$('#stats-modal .stats-right .card'))
    .find(c => c.querySelector('.h-card')?.textContent?.toLowerCase().includes('answer distribution'));
  const container = card?.querySelector('.chart');
  if (!container) return;

  const counts = [1,2,3,4].map(k => logs.filter(l => l.rating === k).length);
  const labels = ['Again','Hard','Good','Easy'];
  const colors = ['#fecdd3','#e0e7ff','#e9d5ff','#bbf7d0']; // rose/indigo/violet/emerald lights

  // Build simple bar chart with divs
  const H = container.clientHeight || 160;
  const max = Math.max(1, ...counts);
  const scale = (H - 28) / max; // leave room for labels

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'height:100%;display:flex;align-items:flex-end;gap:14px;justify-content:center;';
  counts.forEach((v, i) => {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;min-width:48px;';
    const bar = document.createElement('div');
    bar.style.cssText = `width:28px;border-radius:8px;background:${colors[i]};height:${Math.round(v*scale)}px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06);`;
    const cap = document.createElement('div');
    cap.style.cssText = 'font-size:12px;color:#64748b;';
    cap.textContent = `${labels[i]} (${v})`;
    col.appendChild(bar); col.appendChild(cap);
    wrap.appendChild(col);
  });
  container.appendChild(wrap);
}

function initStatsModal(){
  $$('#stats-modal [data-close="stats"]').forEach(b=>b.addEventListener('click',closeStats));
  const modal=$('#stats-modal'); modal.addEventListener('click',e=>{ if(e.target===modal||e.target.classList.contains('modal-backdrop')) closeStats(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!$('#stats-modal').classList.contains('hidden')) closeStats(); });
  const seg = $('#stats-modal .segmented');
  if (seg) seg.addEventListener('click',e=>{ const btn=e.target.closest('.seg'); if(!btn) return; const txt=btn.textContent.trim(); fillStats(txt==='Today'?'today':txt); });
  // Re-render chart on resize if modal open
  window.addEventListener('resize', () => {
    const m = $('#stats-modal'); if (m && !m.classList.contains('hidden')) fillStats(state.statsRange);
  });
}

/* Add Card modal */
function openCardModal(deckId){
  const modal=$('#card-modal'); const sel=$('#card-deck'); if (!modal || !sel) return;
  sel.innerHTML='';
  const options=DB.listDecks(); options.forEach(d=>{ const o=document.createElement('option'); o.value=d.id; o.textContent=d.name; sel.appendChild(o); });
  sel.value = deckId || state.currentDeckId || options[0]?.id || '';
  $('#card-front').value=''; $('#card-back').value=''; $('#card-tags').value='';
  modal.classList.remove('hidden'); requestAnimationFrame(()=>modal.classList.add('show')); $('#card-front').focus();
}
function closeCardModal(){ const m=$('#card-modal'); if (!m) return; m.classList.remove('show'); setTimeout(()=>m.classList.add('hidden'),180); }
function initCardModal(){
  const m=$('#card-modal'); if (!m) return;
  m.addEventListener('click',e=>{ if(e.target===m||e.target.classList.contains('modal-backdrop')) closeCardModal(); });
  $$('#card-modal [data-close="card"]').forEach(b=>b.addEventListener('click',closeCardModal));
  $('#card-save')?.addEventListener('click',()=>{
    const deckId=$('#card-deck').value;
    const front=$('#card-front').value.trim(); const back=$('#card-back').value.trim();
    const tags=$('#card-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
    if (!front||!back) return alert('Front and back are required');
    DB.addCard(deckId,front,back,tags); hydrateDeckGrids(); toast('Card added','success'); closeCardModal();
  });
}

/* Filter/Sort modal */
function openFS(){ const m=$('#fs-modal'); if (!m) return; $('#fs-search').value=state.fs.text; $('#fs-min').value=state.fs.min||0; $('#fs-sort').value=state.fs.sort; m.classList.remove('hidden'); requestAnimationFrame(()=>m.classList.add('show')); }
function closeFS(){ const m=$('#fs-modal'); if (!m) return; m.classList.remove('show'); setTimeout(()=>m.classList.add('hidden'),180); }
function initFilterSort(){
  const m=$('#fs-modal'); if(!m) return;
  m.addEventListener('click',e=>{ if(e.target===m||e.target.classList.contains('modal-backdrop')) closeFS(); });
  $('#fs-apply')?.addEventListener('click',()=>{ state.fs.text=$('#fs-search').value.trim(); state.fs.min=parseInt($('#fs-min').value||'0',10); state.fs.sort=$('#fs-sort').value; closeFS(); hydrateDeckGrids(); });
  $('#fs-clear')?.addEventListener('click',()=>{ state.fs={ text:'', min:0, sort:'updated_desc' }; closeFS(); $('#global-search').value=''; hydrateDeckGrids(); });
}

/* Global search */
function initGlobalSearch(){ const inp=$('#global-search'); if(!inp) return; inp.addEventListener('input',()=>{ state.fs.text=inp.value.trim(); hydrateDeckGrids(); }); }

/* User settings */
function applyUserSettings(){
  const s=DB.getSettings(); const body=document.body;
  body.classList.remove('theme-dark');
  if (s.theme==='dark') body.classList.add('theme-dark');
  if (s.theme==='system'){ const dark=window.matchMedia('(prefers-color-scheme: dark)').matches; if (dark) body.classList.add('theme-dark'); }
  body.classList.toggle('font-large', s.cardFont==='large');
  body.classList.toggle('no-anim', !s.animations);
}
function markThemeActive() {
  const s = DB.getSettings();
  const group = document.querySelector('#view-settings [data-toggle="theme"]');
  if (!group) return;
  const segs = group.querySelectorAll('.seg');
  segs.forEach(b => b.classList.remove('active'));
  const idx = s.theme === 'system' ? 0 : s.theme === 'light' ? 1 : 2;
  segs[idx]?.classList.add('active');
}

/* PWA */
function registerSW(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js').catch(()=>{}); } }