// Run with: node --test tests/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Fuzzy = require("../lib/fuzzy.js");

const score = (q, t) => Fuzzy.score(q, t).score;

test("non-matches score 0", () => {
  assert.equal(score("xyz", "Archive"), 0);
  assert.equal(score("archivee", "Archive"), 0);
});

test("matching is case-insensitive", () => {
  assert.ok(score("ARCH", "archive") > 0);
});

test("prefix beats mid-word match", () => {
  assert.ok(score("arc", "Archive") > score("arc", "Search"));
});

test("shorter target wins an otherwise equal match", () => {
  assert.ok(score("inbox", "Inbox") > score("inbox", "Inbox Archive Folder"));
});

test("picks the best alignment, not the first", () => {
  // Greedy-first would match "ar" inside "Mark"; word starts "as Read" is better.
  assert.deepEqual(Fuzzy.score("ar", "Mark as Read").positions, [5, 8]);
});

test("word-boundary initials match", () => {
  const { positions } = Fuzzy.score("ra", "Reply All");
  assert.deepEqual(positions, [0, 6]);
});

test("highlight wraps runs and escapes HTML", () => {
  assert.equal(
    Fuzzy.highlight("a<b>c", [0, 1]),
    '<span class="row-match">a&lt;</span>b&gt;c'
  );
  assert.equal(Fuzzy.highlight("R&D", []), "R&amp;D");
});
