// Minimal subsequence fuzzy matcher with positional bonuses.
// Returns { score, positions } where positions is the matched-char indices in target.
// Higher score = better. Score 0 means no match.
//
// Bonuses:
//   +1 base per matched char
//   +2 if match is at a word boundary in target (after / . _ - : space)
//   +1 if match is consecutive with previous match
//   +3 if match is at index 0 (prefix match)
// Length penalty: divides by (target.length * 0.1 + 1) so shorter targets win ties.
//
// A single greedy left-to-right pass can lock onto a weak alignment (e.g. "ar"
// in "Mark as Read" grabs the "ar" inside "Mark" rather than "as Read"). So we
// run the greedy pass from every position where the first query char occurs
// and keep the best-scoring alignment. O(target² ) worst case, which is fine
// for labels of a few dozen chars.

const BOUNDARY = new Set([" ", "\t", "/", ".", "_", "-", ":", "·"]);

/**
 * @param {string} q lower-case query
 * @param {string} t lower-case target
 * @param {number} start index in t of the first query character
 * @returns {{ raw: number, positions: number[] } | null}
 */
function greedyFrom(q, t, start) {
  let qi = 0;
  let raw = 0;
  let lastMatch = -2;
  const positions = [];
  for (let ti = start; ti < t.length && qi < q.length; ti++) {
    if (q[qi] !== t[ti]) continue;
    positions.push(ti);
    raw += 1;
    if (ti === 0) raw += 3;
    else if (BOUNDARY.has(t[ti - 1])) raw += 2;
    if (ti === lastMatch + 1) raw += 1;
    lastMatch = ti;
    qi++;
  }
  return qi === q.length ? { raw, positions } : null;
}

/**
 * @param {string} query
 * @param {string} target
 * @returns {{ score: number, positions: number[] }}
 */
function fuzzyScore(query, target) {
  if (!query) return { score: 0.0001, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let best = null;
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const r = greedyFrom(q, t, start);
    if (!r) break; // a later start can't succeed if this one ran out of chars
    if (!best || r.raw > best.raw) best = r;
  }

  if (!best) return { score: 0, positions: [] };
  return { score: best.raw / (t.length * 0.1 + 1), positions: best.positions };
}

// Split a label into runs of matched and unmatched characters, for
// highlighting. The caller builds DOM nodes from them (text stays text: no
// HTML is ever generated, so nothing needs escaping).
/**
 * @param {string} label
 * @param {number[]} [positions] matched character indices
 * @returns {{ text: string, match: boolean }[]}
 */
function segments(label, positions) {
  const set = new Set(positions || []);
  /** @type {{ text: string, match: boolean }[]} */
  const out = [];
  for (let i = 0; i < label.length; i++) {
    const match = set.has(i);
    const last = out[out.length - 1];
    if (last && last.match === match) last.text += label[i];
    else out.push({ text: label[i], match });
  }
  return out;
}

const Fuzzy = { score: fuzzyScore, segments };
if (typeof window !== "undefined") window.Fuzzy = Fuzzy;
if (typeof module !== "undefined") module.exports = Fuzzy; // node --test
