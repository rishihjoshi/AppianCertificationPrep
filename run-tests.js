'use strict';

// ── Constants (mirrored from app.js) ─────────────────────────────────────────
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/19yf_hnwbM63Wzfk0E-4N0ODIq0Ahig6Y2sElUpmTiJM/gviz/tq?tqx=out:csv&gid=0';

// ── Logic under test (extracted from app.js) ──────────────────────────────────

function scoreAnswer(selected, correct) {
  if (!selected || selected.length === 0) return { points: 0, outcome: 'incorrect' };
  const correctSet  = new Set(correct);
  const selectedSet = new Set(selected);
  if (correct.length === 1) {
    const isRight = selectedSet.has(correct[0]) && selectedSet.size === 1;
    return isRight ? { points: 2, outcome: 'correct' } : { points: 0, outcome: 'incorrect' };
  }
  const hasWrong = [...selectedSet].some(s => !correctSet.has(s));
  if (hasWrong) return { points: 0, outcome: 'incorrect' };
  const correctSelected = [...selectedSet].filter(s => correctSet.has(s)).length;
  const N = correct.length;
  if (correctSelected === N) return { points: 2, outcome: 'correct' };
  const partial = Math.floor((correctSelected / N) * 2);
  return { points: partial, outcome: partial > 0 ? 'partial' : 'incorrect' };
}

function trim(s) { return (s || '').replace(/^\s+|\s+$/g, ''); }

function splitCSVRows(csv) {
  const rows = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuote && csv[i + 1] === '"') { cur += '""'; i++; }
      else { inQuote = !inQuote; cur += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur.trim()) rows.push(cur);
      cur = '';
      if (ch === '\r' && csv[i + 1] === '\n') i++;
    } else { cur += ch; }
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCSVRow(row) {
  const fields = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) { fields.push(cur); cur = ''; }
    else { cur += ch; }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(csv) {
  const rows = splitCSVRows(csv);
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = parseCSVRow(rows[i]);
    if (cols.length < 9) continue;
    const optionE = trim(cols[7]);
    const answers = trim(cols[8]).split(',').map(a => a.trim().toUpperCase()).filter(Boolean);
    if (!answers.length) continue;
    const q = {
      num: trim(cols[0]), category: trim(cols[1]), question: trim(cols[2]),
      options: { A: trim(cols[3]), B: trim(cols[4]), C: trim(cols[5]), D: trim(cols[6]), E: optionE || null },
      answers, explanation: trim(cols[9] || ''), isMulti: answers.length > 1,
    };
    if (!q.question || !q.options.A) continue;
    records.push(q);
  }
  return records;
}

const CATEGORY_WEIGHTS = {
  'Interface Design':                0.19,
  'Process Models':                  0.17,
  'Expression Rules':                0.15,
  'Introduction to Appian Platform': 0.14,
  'Data Persistence':                0.13,
  'Records':                         0.13,
  'General Appian Principles':       0.09,
};
const TOTAL_QUESTIONS_PER_SESSION = 60;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function selectQuestions(pool) {
  const total = TOTAL_QUESTIONS_PER_SESSION;
  const byCategory = {};
  for (const q of pool) {
    if (!byCategory[q.category]) byCategory[q.category] = [];
    byCategory[q.category].push(q);
  }
  const selected = [];
  const allocations = {};
  let assigned = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const quota = Math.round(weight * total);
    allocations[cat] = quota;
    assigned += quota;
  }
  const drift = total - assigned;
  if (drift !== 0) { const firstCat = Object.keys(allocations)[0]; allocations[firstCat] += drift; }
  const remaining = [];
  for (const [cat, quota] of Object.entries(allocations)) {
    const available = shuffle([...(byCategory[cat] || [])]);
    const take = Math.min(quota, available.length);
    selected.push(...available.slice(0, take));
    remaining.push(...available.slice(take));
  }
  for (const [cat, qs] of Object.entries(byCategory)) {
    if (!CATEGORY_WEIGHTS[cat]) remaining.push(...qs);
  }
  if (selected.length < total) {
    const extra = shuffle(remaining).slice(0, total - selected.length);
    selected.push(...extra);
  }
  return shuffle(selected.slice(0, total));
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST HARNESS
// ══════════════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;

function assert(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? '  PASS' : '  FAIL') + '  ' + desc);
  if (!ok) {
    console.log('       expected: ' + JSON.stringify(expected));
    console.log('       got:      ' + JSON.stringify(actual));
  }
  ok ? pass++ : fail++;
}

function assertApprox(desc, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log((ok ? '  PASS' : '  FAIL') + '  ' + desc);
  if (!ok) console.log(`       expected ≈${expected} ±${tolerance}, got ${actual}`);
  ok ? pass++ : fail++;
}

// ── scoreAnswer ───────────────────────────────────────────────────────────────
console.log('\nscoreAnswer — single-answer');
assert('correct',                         scoreAnswer(['B'], ['B']),           { points: 2, outcome: 'correct'   });
assert('wrong letter',                    scoreAnswer(['A'], ['B']),           { points: 0, outcome: 'incorrect' });
assert('skipped (empty array)',           scoreAnswer([], ['B']),              { points: 0, outcome: 'incorrect' });
assert('null selected',                   scoreAnswer(null, ['B']),            { points: 0, outcome: 'incorrect' });
assert('over-selected (2 chosen for 1)',  scoreAnswer(['A','B'], ['B']),       { points: 0, outcome: 'incorrect' });
assert('correct, alt letter C',          scoreAnswer(['C'], ['C']),           { points: 2, outcome: 'correct'   });

console.log('\nscoreAnswer — multi-answer');
assert('all correct (N=2)',              scoreAnswer(['A','C'], ['A','C']),       { points: 2, outcome: 'correct'   });
assert('all correct (N=3)',              scoreAnswer(['A','B','C'], ['A','B','C']),{ points: 2, outcome: 'correct' });
assert('partial K=1 of N=2',            scoreAnswer(['A'], ['A','C']),           { points: 1, outcome: 'partial'   });
assert('partial K=2 of N=3',            scoreAnswer(['A','B'], ['A','B','C']),   { points: 1, outcome: 'partial'   });
assert('partial K=1 of N=3 → floor=0', scoreAnswer(['A'], ['A','B','C']),       { points: 0, outcome: 'incorrect' });
assert('any wrong selected → 0',        scoreAnswer(['A','D'], ['A','C']),       { points: 0, outcome: 'incorrect' });
assert('all wrong → 0',                 scoreAnswer(['D','E'], ['A','B']),       { points: 0, outcome: 'incorrect' });
assert('no overlap single wrong pick',  scoreAnswer(['D'], ['A','B','C']),       { points: 0, outcome: 'incorrect' });
assert('order-independent all correct', scoreAnswer(['C','A'], ['A','C']),       { points: 2, outcome: 'correct'   });
assert('duplicate selections ignored',  scoreAnswer(['A','A'], ['A','C']),       { points: 1, outcome: 'partial'   });

// ── trim ──────────────────────────────────────────────────────────────────────
console.log('\ntrim');
assert('trims leading/trailing spaces', trim('  hello  '), 'hello');
assert('trims tabs',                    trim('\thello\t'), 'hello');
assert('trims mixed whitespace',        trim(' \t hello \t '), 'hello');
assert('no-op on clean string',         trim('clean'), 'clean');
assert('empty string',                  trim(''), '');
assert('null input',                    trim(null), '');
assert('undefined input',               trim(undefined), '');
assert('only whitespace',               trim('   '), '');
assert('internal spaces preserved',     trim('  a b  '), 'a b');

// ── splitCSVRows ──────────────────────────────────────────────────────────────
console.log('\nsplitCSVRows');
assert('LF newlines',          splitCSVRows('a\nb\nc').length, 3);
assert('CRLF newlines',        splitCSVRows('a\r\nb\r\nc').length, 3);
assert('CR only',              splitCSVRows('a\rb\rc').length, 3);
assert('skips blank lines',    splitCSVRows('a\n\nb\n').length, 2);
assert('quoted newline kept',  splitCSVRows('"a\nb",c\nd,e').length, 2);
assert('trailing whitespace',  splitCSVRows('a\n  \nb\n').length, 2);
assert('empty string',         splitCSVRows('').length, 0);
assert('single row no newline',splitCSVRows('a,b,c').length, 1);

// ── parseCSVRow ───────────────────────────────────────────────────────────────
console.log('\nparseCSVRow');
assert('simple row',               parseCSVRow('a,b,c'),            ['a','b','c']);
assert('quoted field with comma',  parseCSVRow('"a,b",c'),          ['a,b','c']);
assert('escaped quote',            parseCSVRow('"a""b",c'),         ['a"b','c']);
assert('empty field mid-row',      parseCSVRow('a,,c'),             ['a','','c']);
assert('empty field at end',       parseCSVRow('a,b,'),             ['a','b','']);
assert('all empty',                parseCSVRow(',,,'),              ['','','','']);
assert('quoted multi-answer',      parseCSVRow('"A, B"'),           ['A, B']);
assert('quoted with newline',      parseCSVRow('"line1\nline2"'),   ['line1\nline2']);

// ── parseCSV ─────────────────────────────────────────────────────────────────
console.log('\nparseCSV');

const HDR = 'Sr. No.,Category,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer(s),Explanation\n';

// Basic 2-row parse
const CSV_BASIC = HDR +
  '1,Cat A,What is X?,Yes,No,Maybe,,, A ,Because A.\n' +
  '2,Cat B,Multi Q?,True,False,Both,,,"A, B",Combined.';
const r1 = parseCSV(CSV_BASIC);
assert('parses 2 data rows',              r1.length, 2);
assert('trims answer leading spaces',     r1[0].answers, ['A']);
assert('multi-answer splits correctly',   r1[1].answers, ['A', 'B']);
assert('isMulti true for multi-answer',   r1[1].isMulti, true);
assert('isMulti false for single-answer', r1[0].isMulti, false);
assert('option E null when empty',        r1[0].options.E, null);
assert('option E populated when present', (() => {
  const csv = HDR + '1,Cat,Q,A,B,C,D,E-opt,A,exp';
  return parseCSV(csv)[0].options.E;
})(), 'E-opt');
assert('category trimmed',                r1[0].category, 'Cat A');
assert('question text preserved',         r1[0].question, 'What is X?');
assert('explanation parsed',              r1[0].explanation, 'Because A.');
assert('num field parsed',                r1[0].num, '1');

// Quoted field with comma in question text
const CSV_QUOTED = HDR + '1,CatQ,"Q, complicated?",A,B,C,D,,C,exp';
const r2 = parseCSV(CSV_QUOTED);
assert('handles quoted question with comma', r2[0].question, 'Q, complicated?');
assert('answer correct from quoted row',     r2[0].answers, ['C']);

// Blank / malformed row skipping
const CSV_SKIP = HDR +
  '1,Cat,Valid question,A,B,C,D,,A,Exp\n' +
  ',,,,,,,,,\n' +
  '3,Cat,Another valid,X,Y,Z,W,,B,Exp2';
const r3 = parseCSV(CSV_SKIP);
assert('skips blank rows',              r3.length, 2);

// Row with < 9 columns skipped
const CSV_SHORT = HDR + '1,Cat,Q,A,B,C,D';
assert('skips rows with < 9 cols',     parseCSV(CSV_SHORT).length, 0);

// Row with empty answer skipped
const CSV_NO_ANS = HDR + '1,Cat,Q,A,B,C,D,,,exp';
assert('skips rows with empty answer', parseCSV(CSV_NO_ANS).length, 0);

// Row with empty question skipped
const CSV_NO_Q = HDR + '1,Cat,,A,B,C,D,,A,exp';
assert('skips rows with empty question', parseCSV(CSV_NO_Q).length, 0);

// Row with empty Option A skipped
const CSV_NO_A = HDR + '1,Cat,Q,,B,C,D,,A,exp';
assert('skips rows with empty Option A', parseCSV(CSV_NO_A).length, 0);

// Header-only (offline fallback) → 0 questions, not an error
const CSV_HEADER_ONLY = HDR;
assert('header-only returns 0 questions', parseCSV(CSV_HEADER_ONLY).length, 0);

// Multi-answer uppercase normalisation
const CSV_LOWER = HDR + '1,Cat,Q,A,B,C,D,,"a, b",exp';
const r4 = parseCSV(CSV_LOWER);
assert('lowercased answers uppercased', r4[0].answers, ['A', 'B']);

// CRLF line endings (Windows export)
const CSV_CRLF = HDR.replace(/\n/g, '\r\n') + '1,Cat,Q,A,B,C,D,,A,exp';
assert('handles CRLF line endings', parseCSV(CSV_CRLF).length, 1);

// Google-style garbled/internal format (e.g. TSDTV prefix) should yield near-zero valid questions
const CSV_GARBLED = 'TSDTV:%.@.[[NULL,[[45736426,NULL,NULL,0.5,NULL,NULL,\\IPHXZE\\]\n' +
  '[45759550,NULL,FALSE,NULL,NULL,NULL,\\IPHXZE\\]\n' +
  ']]';
const garbledCount = parseCSV(CSV_GARBLED).length;
assert('garbled Google internal format → 0 or very few questions (not full bank)', garbledCount < 5, true);

// ── esc() ─────────────────────────────────────────────────────────────────────
console.log('\nesc()');
assert('escapes &',                  esc('A & B'),                         'A &amp; B');
assert('escapes <',                  esc('<script>'),                       '&lt;script&gt;');
assert('escapes >',                  esc('>alert'),                         '&gt;alert');
assert('escapes double-quote',       esc('"hello"'),                        '&quot;hello&quot;');
assert('passes safe string',         esc('Normal text.'),                   'Normal text.');
assert('empty string',               esc(''),                               '');
assert('XSS script tag neutralised', esc('<script>alert(1)</script>'),      '&lt;script&gt;alert(1)&lt;/script&gt;');
assert('XSS img onerror neutralised',esc('<img src=x onerror=alert(1)>'),   '&lt;img src=x onerror=alert(1)&gt;');
assert('multiple & in string',       esc('a & b & c'),                     'a &amp; b &amp; c');
assert('combined injection attempt', esc('<a href="x">link</a>'),           '&lt;a href=&quot;x&quot;&gt;link&lt;/a&gt;');

// ── shuffle ───────────────────────────────────────────────────────────────────
console.log('\nshuffle');
const arr = [1,2,3,4,5,6,7,8,9,10];
const s1  = shuffle([...arr]);
const s2  = shuffle([...arr]);
assert('preserves length',              s1.length, arr.length);
assert('preserves all elements',        [...s1].sort((a,b) => a-b).join(','), arr.join(','));
assert('produces different order',      s1.join(',') !== arr.join(',') || s2.join(',') !== arr.join(','), true);
assert('empty array',                   shuffle([]), []);
assert('single element',                shuffle([42]), [42]);
assert('two elements — both orders possible', (() => {
  let sawOriginal = false, sawSwapped = false;
  for (let i = 0; i < 20; i++) {
    const r = shuffle([1,2]).join(',');
    if (r === '1,2') sawOriginal = true;
    if (r === '2,1') sawSwapped  = true;
  }
  return sawOriginal && sawSwapped;
})(), true);
assert('does not mutate original (we pass copies)', arr.join(','), '1,2,3,4,5,6,7,8,9,10');

// ── selectQuestions ───────────────────────────────────────────────────────────
console.log('\nselectQuestions');

// Build a pool large enough to fill all category quotas
function makePool(size) {
  const cats = Object.keys(CATEGORY_WEIGHTS);
  return Array.from({ length: size }, (_, i) => ({
    num: String(i+1),
    category: cats[i % cats.length],
    question: `Question ${i+1}`,
    options: { A:'A', B:'B', C:'C', D:'D', E:null },
    answers: ['A'],
    explanation: '',
    isMulti: false,
  }));
}

const pool200  = makePool(200);
const selected = selectQuestions(pool200);
assert('returns exactly 60 questions',           selected.length, 60);
assert('no duplicates in session',               new Set(selected.map(q=>q.num)).size, 60);
assert('all selected are from pool',             selected.every(q => pool200.some(p => p.num === q.num)), true);

// Small pool — can't fill 60, should return what's available
const pool10   = makePool(10);
const sel10    = selectQuestions(pool10);
assert('small pool: returns ≤ 60',               sel10.length <= 60, true);
assert('small pool: no duplicates',              new Set(sel10.map(q=>q.num)).size, sel10.length);

// Unknown category questions still get included in remainder fill
const poolWithExtra = [
  ...makePool(200),
  { num:'999', category:'Unknown Category', question:'X', options:{A:'A',B:'B',C:'C',D:'D',E:null}, answers:['A'], explanation:'', isMulti:false },
];
const selWithExtra = selectQuestions(poolWithExtra);
assert('unknown-category questions eligible for fill', selWithExtra.length, 60);

// Category proportions should be approximately correct (±2 per category)
const catCounts = {};
for (const q of selected) catCounts[q.category] = (catCounts[q.category] || 0) + 1;
for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
  const expected = Math.round(weight * 60);
  const actual   = catCounts[cat] || 0;
  assertApprox(`category "${cat}" count ≈ ${expected}`, actual, expected, 2);
}

// ── SHEET_CSV_URL / fetchQuestions header guard ───────────────────────────────
console.log('\nSHEET_CSV_URL & header guard');

// The URL must be the gviz/tq endpoint, NOT the /edit or /export URL
assert('URL uses gviz/tq endpoint',      SHEET_CSV_URL.includes('/gviz/tq'), true);
assert('URL requests CSV output',         SHEET_CSV_URL.includes('tqx=out:csv'), true);
assert('URL is not the edit URL',         SHEET_CSV_URL.includes('/edit'), false);
assert('URL is not the export URL',       SHEET_CSV_URL.includes('/export'), false);
assert('URL targets gid=0 (first sheet)', SHEET_CSV_URL.includes('gid=0'), true);

// Inline the header guard logic for unit testing (mirrors fetchQuestions)
function isValidCsvHeader(csv) {
  const firstLine = csv.trimStart().split('\n')[0];
  return firstLine.includes('Question') || firstLine.includes('Sr. No.');
}
assert('valid CSV header accepted',        isValidCsvHeader('Sr. No.,Category,Question,Option A,...\n1,...'), true);
assert('valid header with "Question" col', isValidCsvHeader('"Question","Answer"\n...'), true);
assert('edit-URL HTML rejected',           isValidCsvHeader('<!DOCTYPE html><html>'), false);
assert('TSDTV garbled format rejected',    isValidCsvHeader('TSDTV:%.@.[[NULL,[[45736426...'), false);
assert('gid/pageUrl format rejected',      isValidCsvHeader('gid: 1788403771\npageUrl: ...'), false);
assert('empty response rejected',          isValidCsvHeader(''), false);
assert('header-only CSV accepted',         isValidCsvHeader('Sr. No.,Category,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer(s),Explanation'), true);

// ── Results ───────────────────────────────────────────────────────────────────
const total = pass + fail;
console.log('\n' + pass + '/' + total + ' unit tests passed' + (fail ? ' — ' + fail + ' FAILED' : ' — all green ✓'));
process.exit(fail > 0 ? 1 : 0);
