// srs.js — simplified SM-2 for ratings 1..4
(() => {
  const MIN_EASE = 1.3;
  const d2ms = (d) => d * 24 * 60 * 60 * 1000;
  const m2ms = (m) => m * 60 * 1000;

  // rating: 1 Again, 2 Hard, 3 Good, 4 Easy
  function rate(card, rating, settings, now = Date.now()) {
    const steps = settings.steps || [1, 10];
    let ease = card.ease || settings.easeFactor || 2.5;
    let interval = card.interval || 0;
    let state = card.state || 'new';
    let stepIndex = card.stepIndex || 0;
    let lapses = card.lapses || 0;
    let due = now;

    const before = { state, ease, interval, stepIndex };

    if (state === 'new' || state === 'learning') {
      if (rating === 1) {
        state = 'learning'; stepIndex = 0; due = now + m2ms(steps[0]);
      } else if (rating === 2) {
        state = 'learning'; stepIndex = Math.max(0, stepIndex); due = now + m2ms(steps[Math.min(stepIndex, steps.length - 1)]);
        ease = Math.max(MIN_EASE, ease - 0.05);
      } else if (rating === 3) {
        if (stepIndex < steps.length - 1) {
          state = 'learning'; stepIndex += 1; due = now + m2ms(steps[stepIndex]);
        } else {
          state = 'review'; interval = 1; due = now + d2ms(interval);
        }
      } else if (rating === 4) {
        state = 'review'; ease = Math.max(MIN_EASE, ease + 0.1); interval = 4; due = now + d2ms(interval);
      }
    } else if (state === 'review') {
      if (rating === 1) {
        state = 'learning'; stepIndex = 0; lapses += 1; due = now + m2ms(steps[0]); ease = Math.max(MIN_EASE, ease - 0.2);
      } else if (rating === 2) {
        interval = Math.max(1, Math.round(interval * 1.2)); ease = Math.max(MIN_EASE, ease - 0.15); due = now + d2ms(interval);
      } else if (rating === 3) {
        interval = Math.max(1, Math.round(interval * ease)); due = now + d2ms(interval);
      } else if (rating === 4) {
        ease = Math.max(MIN_EASE, ease + 0.05); interval = Math.max(1, Math.round(interval * ease * 1.3)); due = now + d2ms(interval);
      }
    }

    const after = { state, ease, interval, stepIndex, lapses, due };

    return { patch: { state, ease, interval, stepIndex, lapses, due, updatedAt: now }, meta: { before, after } };
  }

  window.SRS = { rate };
})();