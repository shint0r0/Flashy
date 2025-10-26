
(() => {
  const KEY = 'recallify_db_v1';

  const DEFAULTS = {
    dailyNew: 20,
    dailyReviewLimit: 200,
    steps: [1, 10],      // minutes for learning steps
    easeFactor: 2.5,
    theme: 'system',     // system | light | dark
    cardFont: 'medium',  // medium | large
    animations: true
  };

  let db;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => Date.now();

  function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

  function ensureSettings() {
    db.settings = Object.assign({}, DEFAULTS, db.settings || {});
  }

  function load() {
    const raw = localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw);
    else {
      db = { decks: [], cards: [], reviewLogs: [], settings: { ...DEFAULTS } };
      seed();
      save();
    }
    ensureSettings();
    return db;
  }

  function seed() {
    if (db.decks.length) return;
    const names = [
      'Spanish A1',
      'Biology: Cell',
      'Interview Prep',
      'Anatomy',
      'French Verbs',
      'Chemistry Basics'
    ];
    names.forEach((name) => {
      const d = addDeck(name, 'Demo deck');
      for (let i = 1; i <= 12; i++) {
        addCard(d.id, `${name} Term ${i}`, `${name} Answer ${i}`, []);
      }
    });
  }

  function addDeck(name, description = '', tags = []) {
    const d = { id: 'd_' + uid(), name, description, tags, createdAt: now(), updatedAt: now() };
    db.decks.push(d); save(); return d;
  }

  function updateDeck(id, patch) {
    const d = db.decks.find((x) => x.id === id);
    if (!d) return null;
    Object.assign(d, patch, { updatedAt: now() });
    save(); return d;
  }

  function deleteDeck(id) {
    db.cards = db.cards.filter((c) => c.deckId !== id);
    db.decks = db.decks.filter((d) => d.id !== id);
    save();
  }

  function listDecks() { return db.decks.slice(); }
  function deckById(id) { return db.decks.find((d) => d.id === id); }

  function addCard(deckId, front, back, tags = []) {
    const c = {
      id: 'c_' + uid(),
      deckId, front, back, notes: '',
      tags,
      state: 'new',      // new | learning | review
      stepIndex: 0,
      due: now(),
      ease: db.settings.easeFactor || DEFAULTS.easeFactor,
      interval: 0,       // days
      lapses: 0,
      createdAt: now(),
      updatedAt: now()
    };
    db.cards.push(c); save(); return c;
  }

  function updateCard(id, patch) {
    const c = db.cards.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch, { updatedAt: now() });
    save(); return c;
  }

  function deleteCard(id) { db.cards = db.cards.filter((c) => c.id !== id); save(); }

  function cardsByDeck(deckId) { return db.cards.filter((c) => c.deckId === deckId); }

  function countCardsByDeck(deckId) {
    return db.cards.reduce((n, c) => n + (c.deckId === deckId ? 1 : 0), 0);
  }

  function getSettings() { ensureSettings(); return db.settings; }

  function setSettings(patch) { db.settings = Object.assign({}, getSettings(), patch); save(); return db.settings; }

  // Build a session queue: learning due, review due, then new
  function getSessionQueue(deckId, limit = 20) {
    const t = now();
    const cards = cardsByDeck(deckId);
    const learningDue = cards.filter((c) => c.state === 'learning' && c.due <= t);
    const reviewDue   = cards.filter((c) => c.state === 'review'   && c.due <= t);
    const newCards    = cards.filter((c) => c.state === 'new');
    const queue = [...learningDue, ...reviewDue, ...newCards].slice(0, limit);
    const counts = {
      new: queue.filter((c) => c.state === 'new').length,
      learning: queue.filter((c) => c.state === 'learning').length,
      review: queue.filter((c) => c.state === 'review').length
    };
    return { queue, counts, total: queue.length };
  }

  function recordReview(log) { db.reviewLogs.push(log); save(); }

  function listReviewLogs({ deckId = null, since = 0 } = {}) {
    return db.reviewLogs.filter((l) => (!deckId || l.deckId === deckId) && l.ts >= since);
  }

  // Import/Export/Reset
  function exportJSON() { return JSON.stringify(db); }
  function clear() { db = { decks: [], cards: [], reviewLogs: [], settings: { ...DEFAULTS } }; save(); }
  function importJSON(text, mode = 'replace') {
    let obj; try { obj = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
    if (!obj || !Array.isArray(obj.decks) || !Array.isArray(obj.cards) || !obj.settings) {
      throw new Error('Invalid schema');
    }
    if (mode === 'replace') {
      db = obj; ensureSettings(); save(); return true;
    }
    // merge
    const deckIds = new Set(db.decks.map(d => d.id));
    obj.decks.forEach(d => { if (!deckIds.has(d.id)) db.decks.push(d); });
    db.cards = db.cards.concat(obj.cards || []);
    db.reviewLogs = db.reviewLogs.concat(obj.reviewLogs || []);
    db.settings = Object.assign({}, db.settings, obj.settings || {});
    save(); return true;
  }

  window.DB = {
    load, save, seed,
    listDecks, deckById,
    addDeck, updateDeck, deleteDeck,
    addCard, updateCard, deleteCard, cardsByDeck, countCardsByDeck,
    getSettings, setSettings,
    getSessionQueue, recordReview, listReviewLogs,
    exportJSON, importJSON, clear
  };
})();