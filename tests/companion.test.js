// Tests for the Command Palette Extras companion's relay
// (companion/background.js): only the palette may call it, only the listed
// experiment functions are reachable, and the palette's own commands are
// neither listed nor run as "other add-ons' commands".
//
// Run with: node --test tests/

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PALETTE_ID = "command-palette@djmbritt.github.io";
const SRC = fs.readFileSync(path.join(__dirname, "..", "companion", "background.js"), "utf8");

/** Load background.js with a fake experiment; returns send(message, senderId). */
function loadCompanion(palette) {
  let listener;
  const messenger = {
    palette,
    runtime: {
      getManifest: () => ({ version: "9.9.9" }),
      onMessageExternal: { addListener: (fn) => { listener = fn; } }
    }
  };
  vm.runInContext(SRC, vm.createContext({ messenger }));
  return (message, senderId = PALETTE_ID) => listener(message, { id: senderId });
}

const plain = (v) => JSON.parse(JSON.stringify(v));

test("hello lists the experiment functions that exist", async () => {
  const send = loadCompanion({ getNewMail() {}, runCommand() {}, notInTheList() {} });
  assert.deepEqual(plain(await send({ type: "extras:hello" })), { version: "9.9.9", functions: ["getNewMail", "runCommand"] });
});

test("messages from other add-ons are ignored", () => {
  const send = loadCompanion({ getNewMail() {} });
  assert.equal(send({ type: "extras:hello" }, "someone-else@example.com"), undefined);
  assert.equal(send({ type: "extras:call", name: "getNewMail", args: [] }, "someone-else@example.com"), undefined);
});

test("call forwards the arguments and returns the result", async () => {
  const calls = [];
  const send = loadCompanion({ getNewMail: async (...a) => { calls.push(a); return "ok"; } });
  assert.equal(await send({ type: "extras:call", name: "getNewMail", args: ["account1"] }), "ok");
  assert.deepEqual(calls, [["account1"]]);
});

test("unlisted or missing functions are refused", async () => {
  const send = loadCompanion({ getNewMail() {}, notInTheList() {} });
  await assert.rejects(send({ type: "extras:call", name: "notInTheList", args: [] }), /no function "notInTheList"/);
  await assert.rejects(send({ type: "extras:call", name: "runCommand", args: [] }), /no function "runCommand"/);
});

test("experiment errors reach the palette with their message", async () => {
  const send = loadCompanion({ runCommand: async () => { throw new Error("cmd_undo is not available right now"); } });
  await assert.rejects(send({ type: "extras:call", name: "runCommand", args: ["cmd_undo"] }), /not available right now/);
});

test("the palette's own commands are not listed or run as other add-ons' commands", async () => {
  const ran = [];
  const send = loadCompanion({
    listAddonCommands: async () => [{ extensionId: PALETTE_ID, command: "palette-search" }, { extensionId: "other@x", command: "go" }],
    runAddonCommand: async (...a) => { ran.push(a); }
  });
  assert.deepEqual(plain(await send({ type: "extras:call", name: "listAddonCommands", args: [] })), [{ extensionId: "other@x", command: "go" }]);
  await assert.rejects(send({ type: "extras:call", name: "runAddonCommand", args: [PALETTE_ID, "palette-search"] }));
  await send({ type: "extras:call", name: "runAddonCommand", args: ["other@x", "go"] });
  assert.deepEqual(ran, [["other@x", "go"]]);
});
