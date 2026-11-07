// Run with: node --test tests/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const VCard = require("../lib/vcard.js");

test("reads FN and every EMAIL", () => {
  const v = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ann Example\r\nEMAIL;TYPE=work:ann@work.org\r\nEMAIL:ann@home.org\r\nEND:VCARD\r\n";
  assert.deepEqual(VCard.parse(v), { name: "Ann Example", emails: ["ann@work.org", "ann@home.org"] });
});

test("unfolds continuation lines", () => {
  const v = "BEGIN:VCARD\nFN:Bartholomew\n  Longname\nEMAIL:bart@exa\n mple.com\nEND:VCARD";
  assert.deepEqual(VCard.parse(v), { name: "Bartholomew Longname", emails: ["bart@example.com"] });
});

test("handles property groups and escapes", () => {
  const v = "BEGIN:VCARD\nFN:Smith\\, Jo\nitem1.EMAIL:jo@x.org\nEND:VCARD";
  assert.deepEqual(VCard.parse(v), { name: "Smith, Jo", emails: ["jo@x.org"] });
});

test("falls back to N when FN is missing", () => {
  const v = "BEGIN:VCARD\nN:Doe;Jane;;;\nEMAIL:jane@doe.net\nEND:VCARD";
  assert.equal(VCard.parse(v).name, "Jane Doe");
});

test("tolerates empty or missing input", () => {
  assert.deepEqual(VCard.parse(""), { name: "", emails: [] });
  assert.deepEqual(VCard.parse(undefined), { name: "", emails: [] });
});
