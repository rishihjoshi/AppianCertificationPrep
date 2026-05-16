'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const TOTAL_QUESTIONS_PER_SESSION = 60;
const TOTAL_SCORE_POINTS          = 120;
const EXAM_TIME_MINUTES           = 60;
const PASSING_PERCENTAGE          = 73;
const SHEET_CSV_URL               = 'https://docs.google.com/spreadsheets/d/19yf_hnwbM63Wzfk0E-4N0ODIq0Ahig6Y2sElUpmTiJM/edit?usp=sharing';

// Exam category weights (real exam proportions)
const CATEGORY_WEIGHTS = {
  'Interface Design':                   0.19,
  'Process Models':                     0.17,
  'Expression Rules':                   0.15,
  'Introduction to Appian Platform':    0.14,
  'Data Persistence':                   0.13,
  'Records':                            0.13,
  'General Appian Principles':          0.09,
};

// ── App state (StrideVault pattern: single state object) ─────────────────────
const state = {
  allQuestions:   [],   // Full parsed question bank
  session: null,        // Active test session (null when no test in progress)
  timerInterval: null,  // setInterval handle for countdown
  timerPaused:   false, // True while modal is open
};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  loading:  $('screen-loading'),
  start:    $('screen-start'),
  question: $('screen-question'),
  results:  $('screen-results'),
  review:   $('screen-review'),
};

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  restoreSession();
  wireStaticHandlers();
  await loadQuestions();
});

// ── Question bank loading ────────────────────────────────────────────────────
async function loadQuestions() {
  showScreen('loading');
  $('loading-error').classList.add('hidden');

  try {
    const questions = await fetchQuestions();
    state.allQuestions = questions;

    $('bank-count').textContent = `Question bank: ${questions.length} questions loaded`;

    // If a session was restored from sessionStorage, jump straight to question screen
    if (state.session) {
      showScreen('question');
      renderQuestion();
      startTimer();
    } else {
      showScreen('start');
    }
  } catch (err) {
    $('loading-error').classList.remove('hidden');
    $('loading-error-msg').textContent = `Failed to load question bank: ${err.message}. Check your internet connection.`;
    showScreen('loading');
  }
}

async function fetchQuestions() {
  const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  return parseCSV(csv);
}

// ── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(csv) {
  const rows    = splitCSVRows(csv);
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = parseCSVRow(rows[i]);
    if (cols.length < 9) continue; // Skip malformed rows

    const optionE = trim(cols[7]);
    const answers = trim(cols[8])
      .split(',')
      .map(a => a.trim().toUpperCase())
      .filter(Boolean);

    if (!answers.length) continue; // Skip rows with no answer

    const q = {
      num:         trim(cols[0]),
      category:    trim(cols[1]),
      question:    trim(cols[2]),
      options: {
        A: trim(cols[3]),
        B: trim(cols[4]),
        C: trim(cols[5]),
        D: trim(cols[6]),
        E: optionE || null, // null when empty — don't render
      },
      answers,              // e.g. ['B'] or ['A','C']
      explanation: trim(cols[9] || ''),
      isMulti: answers.length > 1,
    };

    if (!q.question || !q.options.A) continue;
    records.push(q);
  }

  return records;
}

function splitCSVRows(csv) {
  // Split on newlines but respect quoted fields containing newlines.
  // Quotes are preserved in the output so parseCSVRow can handle quoted
  // fields with commas (e.g. Google Sheets exports "A, B" for multi-answers).
  const rows = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuote && csv[i + 1] === '"') { cur += '""'; i++; } // escaped quote — preserve both
      else { inQuote = !inQuote; cur += ch; }                   // toggle and keep the quote
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur.trim()) rows.push(cur);
      cur = '';
      if (ch === '\r' && csv[i + 1] === '\n') i++; // CRLF
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCSVRow(row) {
  // Returns array of field values, handling quoted fields
  const fields = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function trim(s) {
  return (s || '').replace(/^\s+|\s+$/g, '');
}

// ── Question selection (category-proportional) ───────────────────────────────
function selectQuestions(pool) {
  const total = TOTAL_QUESTIONS_PER_SESSION;

  // Group by category
  const byCategory = {};
  for (const q of pool) {
    if (!byCategory[q.category]) byCategory[q.category] = [];
    byCategory[q.category].push(q);
  }

  const selected = [];

  // First pass: fill proportional slots
  const allocations = {};
  let assigned = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const quota = Math.round(weight * total);
    allocations[cat] = quota;
    assigned += quota;
  }

  // Adjust rounding drift (assigned may differ from total by ±1)
  const drift = total - assigned;
  if (drift !== 0) {
    const firstCat = Object.keys(allocations)[0];
    allocations[firstCat] += drift;
  }

  const remaining = []; // Questions that weren't needed for quota

  for (const [cat, quota] of Object.entries(allocations)) {
    const available = shuffle([...(byCategory[cat] || [])]);
    const take = Math.min(quota, available.length);
    selected.push(...available.slice(0, take));
    remaining.push(...available.slice(take));
  }

  // Also include questions from categories not in CATEGORY_WEIGHTS
  for (const [cat, qs] of Object.entries(byCategory)) {
    if (!CATEGORY_WEIGHTS[cat]) remaining.push(...qs);
  }

  // Fill up to total if proportional pass fell short
  if (selected.length < total) {
    const extra = shuffle(remaining).slice(0, total - selected.length);
    selected.push(...extra);
  }

  // Trim to exactly TOTAL_QUESTIONS_PER_SESSION and shuffle final list
  return shuffle(selected.slice(0, total));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Scoring logic ────────────────────────────────────────────────────────────
//
// scoreAnswer(selected, correct) → { points, outcome }
//
// Test cases (validates all four scenarios):
//
//   Single-answer, correct:
//     scoreAnswer(['B'], ['B'])  → { points: 2, outcome: 'correct' }   ✓ expected: 2
//
//   Single-answer, wrong:
//     scoreAnswer(['A'], ['B'])  → { points: 0, outcome: 'incorrect' }  ✓ expected: 0
//
//   Multi-answer, all correct, none wrong:
//     scoreAnswer(['A','C'], ['A','C'])  → { points: 2, outcome: 'correct' }   ✓ expected: 2
//
//   Multi-answer, partial correct only (K=1 of N=2, no wrong):
//     scoreAnswer(['A'], ['A','C'])  → { points: 1, outcome: 'partial' }   ✓ expected: floor(1/2 * 2) = 1
//
//   Multi-answer, partial correct only (K=2 of N=3, no wrong):
//     scoreAnswer(['A','B'], ['A','B','C'])  → { points: 1, outcome: 'partial' }  ✓ expected: floor(2/3 * 2) = 1
//
//   Multi-answer, any wrong answer selected:
//     scoreAnswer(['A','D'], ['A','C'])  → { points: 0, outcome: 'incorrect' }  ✓ expected: 0 (penalty)
//
//   Skipped / timed out:
//     scoreAnswer([], ['B'])  → { points: 0, outcome: 'incorrect' }   ✓ expected: 0
//
function scoreAnswer(selected, correct) {
  if (!selected || selected.length === 0) {
    return { points: 0, outcome: 'incorrect' };
  }

  const correctSet  = new Set(correct);
  const selectedSet = new Set(selected);

  if (correct.length === 1) {
    // Single-answer
    const isRight = selectedSet.has(correct[0]) && selectedSet.size === 1;
    return isRight
      ? { points: 2, outcome: 'correct' }
      : { points: 0, outcome: 'incorrect' };
  }

  // Multi-answer
  const hasWrong = [...selectedSet].some(s => !correctSet.has(s));
  if (hasWrong) return { points: 0, outcome: 'incorrect' };

  const correctSelected = [...selectedSet].filter(s => correctSet.has(s)).length;
  const N = correct.length;

  if (correctSelected === N) return { points: 2, outcome: 'correct' };

  // Partial credit: floor((K / N) * 2)
  const partial = Math.floor((correctSelected / N) * 2);
  return { points: partial, outcome: partial > 0 ? 'partial' : 'incorrect' };
}

// ── State persistence ─────────────────────────────────────────────────────────
function saveState() {
  if (!state.session) return;
  try {
    sessionStorage.setItem('appianprep_session', JSON.stringify(state.session));
  } catch (_) {}
}

function restoreSession() {
  try {
    const raw = sessionStorage.getItem('appianprep_session');
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Adjust savedAt to account for elapsed time while page was closed
    if (saved && saved.timerSecondsLeft > 0) {
      const elapsed = Math.floor((Date.now() - saved.savedAt) / 1000);
      saved.timerSecondsLeft = Math.max(0, saved.timerSecondsLeft - elapsed);
    }
    state.session = saved;
  } catch (_) {
    sessionStorage.removeItem('appianprep_session');
  }
}

function clearSession() {
  sessionStorage.removeItem('appianprep_session');
  state.session = null;
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// ── Test session initialization ───────────────────────────────────────────────
function startNewTest() {
  clearSession();

  const questions = selectQuestions(state.allQuestions);
  state.session = {
    questions,
    answers:          [],   // { selected: [], points, outcome } per question index
    currentIndex:     0,
    timerSecondsLeft: EXAM_TIME_MINUTES * 60,
    startedAt:        Date.now(),
    savedAt:          Date.now(),
    submitted:        false,
    answeredCurrent:  false,
  };

  saveState();
  showScreen('question');
  renderQuestion();
  startTimer();
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  renderTimer();

  state.timerInterval = setInterval(() => {
    if (state.timerPaused || !state.session) return;

    state.session.timerSecondsLeft = Math.max(0, state.session.timerSecondsLeft - 1);
    state.session.savedAt = Date.now();
    saveState();
    renderTimer();

    if (state.session.timerSecondsLeft === 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      handleTimerExpired();
    }
  }, 1000);
}

function renderTimer() {
  const s   = state.session?.timerSecondsLeft ?? 0;
  const min = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  const el  = $('timer');
  el.textContent = `${min}:${sec}`;
  el.setAttribute('aria-label', `${min} minutes ${sec} seconds remaining`);
  el.classList.toggle('warning', s < 300 && s > 0);
}

function handleTimerExpired() {
  if (!state.session) return;
  // Auto-submit current question with no answer if not already answered
  if (!state.session.answeredCurrent) {
    recordAnswer(state.session.currentIndex, []);
  }
  finishTest();
}

// ── Question rendering ────────────────────────────────────────────────────────
function renderQuestion() {
  const { session } = state;
  if (!session) return;

  const idx = session.currentIndex;
  const q   = session.questions[idx];
  if (!q) { finishTest(); return; }

  session.answeredCurrent = false;

  // Header
  $('q-progress').textContent = `Question ${idx + 1} of ${session.questions.length}`;
  const total = session.questions.length;
  const pct = (idx / total) * 100;
  $('progress-bar').style.width = `${pct}%`;
  $('progress-bar-wrap').setAttribute('aria-valuemax', total);
  $('progress-bar-wrap').setAttribute('aria-valuenow', idx);

  // Category badge
  const badge = $('q-category');
  badge.textContent = q.category;
  badge.dataset.cat = q.category;

  // Question text
  $('q-text').textContent = q.question;

  // Options
  const optionsEl = $('q-options');
  optionsEl.innerHTML = '';

  const inputType = q.isMulti ? 'checkbox' : 'radio';
  const groupName = `q_${idx}`;

  for (const [letter, text] of Object.entries(q.options)) {
    if (!text) continue; // Skip empty option E

    const label = document.createElement('label');
    label.className = 'option-label';
    label.htmlFor   = `opt_${idx}_${letter}`;

    const input = document.createElement('input');
    input.type  = inputType;
    input.id    = `opt_${idx}_${letter}`;
    input.name  = groupName;
    input.value = letter;
    input.setAttribute('aria-label', `Option ${letter}: ${text}`);

    input.addEventListener('change', () => {
      onOptionChange();
      optionsEl.querySelectorAll('.option-label').forEach(l => {
        l.classList.toggle('selected', l.querySelector('input').checked);
      });
    });

    const letterSpan = document.createElement('span');
    letterSpan.className   = 'option-letter';
    letterSpan.textContent = `${letter}.`;

    const textSpan = document.createElement('span');
    textSpan.className   = 'option-text';
    textSpan.textContent = text;

    label.append(input, letterSpan, textSpan);
    optionsEl.appendChild(label);
  }

  // Reset submit button and result panel
  const btnSubmit = $('btn-submit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Submit Answer';
  btnSubmit.classList.remove('hidden');
  $('result-panel').classList.add('hidden');

  // Scroll to top of question
  $('question-main').scrollTop = 0;

  saveState();
}

function onOptionChange() {
  const anyChecked = !!$('q-form').querySelector('input:checked');
  $('btn-submit').disabled = !anyChecked;
}

// ── Answer submission ─────────────────────────────────────────────────────────
function submitAnswer() {
  const { session } = state;
  if (!session || session.answeredCurrent) return;

  const idx      = session.currentIndex;
  const q        = session.questions[idx];
  const checked  = [...$('q-form').querySelectorAll('input:checked')].map(i => i.value);
  const { points, outcome } = scoreAnswer(checked, q.answers);

  recordAnswer(idx, checked, points, outcome);

  // Disable all inputs
  $('q-form').querySelectorAll('input').forEach(inp => { inp.disabled = true; });
  $('btn-submit').classList.add('hidden');

  // Highlight correct / incorrect options
  $('q-options').querySelectorAll('.option-label').forEach(label => {
    const inp    = label.querySelector('input');
    const letter = inp.value;
    const isCorrect  = q.answers.includes(letter);
    const isSelected = checked.includes(letter);

    if (isCorrect)          label.classList.add('correct');
    else if (isSelected)    label.classList.add('incorrect');
  });

  // Show result panel
  showResultPanel(checked, q, points, outcome);

  session.answeredCurrent = true;
  saveState();
}

function recordAnswer(idx, selected, points, outcome) {
  const { session } = state;
  const q = session.questions[idx];

  if (points === undefined) {
    const result = scoreAnswer(selected, q.answers);
    points  = result.points;
    outcome = result.outcome;
  }

  session.answers[idx] = { selected, points, outcome };
}

function showResultPanel(selected, q, points, outcome) {
  const verdictEl = $('result-verdict');
  const verdictMap = {
    correct:   { icon: '✅', text: 'Correct!',        cls: 'correct'   },
    partial:   { icon: '⚠️', text: 'Partially Correct', cls: 'partial'  },
    incorrect: { icon: '❌', text: 'Incorrect',        cls: 'incorrect' },
  };
  const v = verdictMap[outcome] || verdictMap.incorrect;

  verdictEl.className = `result-verdict ${v.cls}`;
  verdictEl.textContent = `${v.icon} ${v.text}`;

  $('result-points').textContent = `${points} / 2 points`;

  // Build explanation with correct answer highlighted
  const correctLetters = q.answers.join(', ');
  $('result-explanation').innerHTML =
    `<p class="result-correct-answer">Correct answer${q.answers.length > 1 ? 's' : ''}: ${esc(correctLetters)}</p>` +
    `<p class="result-explanation-text">${esc(q.explanation || 'No explanation provided.')}</p>`;

  $('result-panel').classList.remove('hidden');
  $('btn-next').focus();
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Navigation ────────────────────────────────────────────────────────────────
function nextQuestion() {
  const { session } = state;
  if (!session) return;

  session.currentIndex++;
  if (session.currentIndex >= session.questions.length) {
    finishTest();
  } else {
    renderQuestion();
  }
}

function finishTest() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;

  const { session } = state;
  if (!session) return;

  session.submitted = true;

  const elapsed     = Math.floor((Date.now() - session.startedAt) / 1000);
  const totalPoints = session.answers.reduce((sum, a) => sum + (a?.points || 0), 0);
  const pct         = Math.round((totalPoints / TOTAL_SCORE_POINTS) * 100);
  const passed      = pct >= PASSING_PERCENTAGE;

  // Build category breakdown
  const catStats = {};
  for (const q of session.questions) {
    if (!catStats[q.category]) catStats[q.category] = { attempted: 0, correct: 0, points: 0 };
    catStats[q.category].attempted++;
  }
  session.answers.forEach((ans, i) => {
    if (!ans) return;
    const cat = session.questions[i]?.category;
    if (!cat || !catStats[cat]) return;
    if (ans.outcome === 'correct') catStats[cat].correct++;
    catStats[cat].points += ans.points;
  });

  const results = {
    totalPoints, pct, passed, elapsed,
    catStats,
    questions: session.questions,
    answers:   session.answers,
    timestamp: Date.now(),
  };

  clearSession();

  renderResults(results);
  showScreen('results');
}

// ── Results rendering ─────────────────────────────────────────────────────────
function renderResults(results) {
  const { totalPoints, pct, passed, elapsed, catStats } = results;

  $('score-main').textContent = totalPoints;
  $('score-pct').textContent  = `${pct}%`;

  const badge = $('pass-badge');
  badge.textContent = passed ? '✅ PASS' : '❌ FAIL';
  badge.className   = `pass-badge ${passed ? 'pass' : 'fail'}`;

  // Animate score circle
  const circle = $('score-circle');
  const deg    = (totalPoints / TOTAL_SCORE_POINTS) * 360;
  const color  = passed ? 'var(--green)' : (pct >= 50 ? 'var(--yellow)' : 'var(--red)');
  circle.style.background = `conic-gradient(${color} ${deg}deg, var(--border) ${deg}deg)`;
  circle.style.boxShadow  = `0 0 32px ${passed ? 'var(--green-dim)' : 'var(--red-dim)'}`;

  // Time taken
  if (elapsed < EXAM_TIME_MINUTES * 60) {
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    $('time-taken').textContent = `Completed in ${m}m ${s}s`;
  } else {
    $('time-taken').textContent = 'Time expired';
  }

  // Category breakdown table
  const tableEl = $('category-table');
  tableEl.innerHTML = '';

  for (const [cat, stats] of Object.entries(catStats)) {
    const catPct = stats.attempted > 0
      ? Math.round((stats.correct / stats.attempted) * 100)
      : 0;

    const pctClass = catPct >= 73 ? 'good' : catPct >= 50 ? 'mid' : 'poor';

    const row = document.createElement('div');
    row.className = 'category-row';
    row.setAttribute('role', 'row');
    row.innerHTML = `
      <span class="cat-row-name">${esc(cat)}</span>
      <span class="cat-row-score">${stats.correct}/${stats.attempted}</span>
      <span class="cat-row-pct ${pctClass}">${catPct}%</span>
    `;
    tableEl.appendChild(row);
  }

  // Store results on DOM for review screen
  tableEl.dataset.results = JSON.stringify(results);
}

// ── Review mode ───────────────────────────────────────────────────────────────
function renderReview() {
  const raw = $('category-table').dataset.results;
  if (!raw) return;

  const results  = JSON.parse(raw);
  const listEl   = $('review-list');
  listEl.innerHTML = '';

  results.questions.forEach((q, i) => {
    const ans = results.answers[i] || { selected: [], points: 0, outcome: 'incorrect' };
    const cls = ans.outcome === 'correct' ? 'correct' : ans.outcome === 'partial' ? 'partial' : 'incorrect';
    const statusLabel = { correct: 'Correct', partial: 'Partial', incorrect: 'Incorrect' }[cls];

    const selectedText = ans.selected.length
      ? ans.selected.map(l => `${l}. ${q.options[l] || l}`).join('; ')
      : '(no answer)';

    const correctText = q.answers.map(l => `${l}. ${q.options[l] || l}`).join('; ');

    const item = document.createElement('article');
    item.className = `review-item ${cls}`;
    item.innerHTML = `
      <div class="review-item-header">
        <span class="review-item-num">Q${i + 1}</span>
        <span class="review-item-status">${statusLabel}</span>
        <span class="review-item-points">${ans.points}/2 pts</span>
      </div>
      <div class="review-item-body">
        <p class="review-question-text">${esc(q.question)}</p>
        <div class="review-answer-row">
          <span class="review-answer-label">Your answer</span>
          <span class="review-answer-value">${esc(selectedText)}</span>
        </div>
        <div class="review-answer-row">
          <span class="review-answer-label">Correct answer</span>
          <span class="review-answer-value highlight-correct">${esc(correctText)}</span>
        </div>
        <p class="review-explanation">${esc(q.explanation || 'No explanation provided.')}</p>
      </div>
    `;
    listEl.appendChild(item);
  });

  showScreen('review');
  listEl.scrollTop = 0;
}

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.remove('active');
    el.classList.add('hidden');
  }
  screens[name].classList.remove('hidden');
  screens[name].classList.add('active');
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wireStaticHandlers() {
  // Start test
  $('btn-start').addEventListener('click', () => startNewTest());

  // Retry on load error
  $('btn-retry').addEventListener('click', () => loadQuestions());

  // Submit answer
  $('btn-submit').addEventListener('click', () => submitAnswer());

  // Next question
  $('btn-next').addEventListener('click', () => nextQuestion());

  // Abandon — open modal
  $('btn-abandon').addEventListener('click', () => openAbandonModal());
  $('btn-abandon-cancel').addEventListener('click', () => closeAbandonModal());
  $('btn-abandon-confirm').addEventListener('click', () => {
    closeAbandonModal();
    abandonTest();
  });

  // Close modal on backdrop click
  $('modal-abandon').addEventListener('click', e => {
    if (e.target === $('modal-abandon')) closeAbandonModal();
  });

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('modal-abandon').classList.contains('hidden')) {
      closeAbandonModal();
    }
  });

  // Results actions
  $('btn-review').addEventListener('click', () => renderReview());
  $('btn-back-results').addEventListener('click', () => showScreen('results'));
  $('btn-new-test-results').addEventListener('click', () => {
    clearSession();
    showScreen('start');
  });
  $('btn-new-test-review').addEventListener('click', () => {
    clearSession();
    showScreen('start');
  });
}

function openAbandonModal() {
  state.timerPaused = true;
  $('modal-abandon').classList.remove('hidden');
  $('btn-abandon-cancel').focus();
}

function closeAbandonModal() {
  state.timerPaused = false;
  $('modal-abandon').classList.add('hidden');
}

function abandonTest() {
  clearSession();
  showScreen('start');
}

// ── Service Worker registration (StrideVault pattern) ────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch(err => console.warn('SW:', err));
}
