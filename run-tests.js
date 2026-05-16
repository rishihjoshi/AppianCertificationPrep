'use strict';

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
      if (inQuote && csv[i + 1] === '"') { cur += '""'; i++; } // escaped quote — preserve both
      else { inQuote = !inQuote; cur += ch; }                   // toggle and keep the quote
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
  if (!ok) console.log('       expected: ' + JSON.stringify(expected) + '  got: ' + JSON.stringify(actual));
  ok ? pass++ : fail++;
}

// ── scoreAnswer unit tests ────────────────────────────────────────────────────
console.log('\nscoreAnswer');
assert('single correct',                     scoreAnswer(['B'], ['B']),           { points: 2, outcome: 'correct'   });
assert('single wrong',                       scoreAnswer(['A'], ['B']),           { points: 0, outcome: 'incorrect' });
assert('multi: all correct',                 scoreAnswer(['A','C'], ['A','C']),   { points: 2, outcome: 'correct'   });
assert('multi: partial K=1 of N=2',          scoreAnswer(['A'], ['A','C']),       { points: 1, outcome: 'partial'   });
assert('multi: partial K=2 of N=3',          scoreAnswer(['A','B'], ['A','B','C']),{ points: 1, outcome: 'partial'  });
assert('multi: any wrong selected = 0',      scoreAnswer(['A','D'], ['A','C']),   { points: 0, outcome: 'incorrect' });
assert('skipped / timed out',                scoreAnswer([], ['B']),              { points: 0, outcome: 'incorrect' });
assert('null selected',                      scoreAnswer(null, ['B']),            { points: 0, outcome: 'incorrect' });
assert('over-selected single (2 for 1)',     scoreAnswer(['A','B'], ['B']),       { points: 0, outcome: 'incorrect' });
assert('multi: no overlap = incorrect',      scoreAnswer(['D'], ['A','B','C']),   { points: 0, outcome: 'incorrect' });
assert('multi: partial K=0 of N=2 (wrong)', scoreAnswer(['D','E'], ['A','B']),   { points: 0, outcome: 'incorrect' });

// ── parseCSV unit tests ──────────────────────────────────────────────────────
console.log('\nparseCSV');
// Google Sheets exports multi-answer cells as quoted fields: "A, B"
const CSV1 = 'Sr. No.,Category,Question,Option A,Option B,Option C,Option D,Option E,Correct Answer(s),Explanation\n' +
             '1,Cat A,What is X?,Yes,No,Maybe,,, A ,Because A is right.\n' +
             '2,Cat B,Multi Q?,True,False,Both,,,\"A, B\",Combined answer.';
const r1 = parseCSV(CSV1);
assert('parses 2 data rows',            r1.length, 2);
assert('trims answer leading spaces',   r1[0].answers, ['A']);
assert('multi-answer splits correctly', r1[1].answers, ['A', 'B']);
assert('isMulti flag true',             r1[1].isMulti, true);
assert('isMulti flag false',            r1[0].isMulti, false);
assert('option E null when empty',      r1[0].options.E, null);
assert('category trimmed',              r1[0].category, 'Cat A');
assert('question text preserved',       r1[0].question, 'What is X?');

// Question text itself may contain commas — Google Sheets quotes those fields
const CSV_QUOTED = 'Nr,Category,Question,Opt A,Opt B,Opt C,Opt D,Opt E,Answer,Explanation\n' +
                   '1,CatQ,\"Q, complicated?\",A,B,C,D,,C,exp';
const r2 = parseCSV(CSV_QUOTED);
assert('handles quoted field with comma',  r2[0].question, 'Q, complicated?');
assert('answer correct from quoted row',   r2[0].answers, ['C']);

const CSV_SKIP = 'Nr,Cat,Q,A,B,C,D,E,Ans,Exp\n' +
                 '1,Cat,Valid question,A,B,C,D,,A,Exp\n' +
                 ',,,,,,,,,\n' +
                 '3,Cat,Another valid,X,Y,Z,W,,B,Exp2';
const r3 = parseCSV(CSV_SKIP);
assert('skips blank/malformed rows', r3.length, 2);

// ── esc() unit tests ─────────────────────────────────────────────────────────
console.log('\nesc()');
assert('escapes &',              esc('A & B'),     'A &amp; B');
assert('escapes <',              esc('<script>'),   '&lt;script&gt;');
assert('escapes >',              esc('>alert'),     '&gt;alert');
assert('escapes double-quote',   esc('"hello"'),    '&quot;hello&quot;');
assert('passes safe string',     esc('Normal text.'), 'Normal text.');
assert('empty string',           esc(''), '');
assert('XSS vector neutralised', esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

// ── shuffle unit tests ───────────────────────────────────────────────────────
console.log('\nshuffle');
const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const s1  = shuffle([...arr]);
const s2  = shuffle([...arr]);
assert('preserves length',    s1.length, arr.length);
assert('preserves elements',  [...s1].sort((a, b) => a - b).join(','), arr.join(','));
assert('produces different order (most runs)', s1.join(',') !== arr.join(',') || s2.join(',') !== arr.join(','), true);
assert('empty array',         shuffle([]), []);
assert('single element',      shuffle([42]), [42]);

// ── trim unit tests ──────────────────────────────────────────────────────────
console.log('\ntrim');
assert('trims both ends',   trim('  hello  '), 'hello');
assert('trims tabs',        trim('\thello\t'), 'hello');
assert('empty string',      trim(''), '');
assert('null input',        trim(null), '');
assert('undefined input',   trim(undefined), '');
assert('no whitespace',     trim('clean'), 'clean');

// ── Results ──────────────────────────────────────────────────────────────────
console.log('\n' + pass + '/' + (pass + fail) + ' unit tests passed' + (fail ? ' — ' + fail + ' FAILED' : ' — all green'));
process.exit(fail > 0 ? 1 : 0);
