// Smoke tests for popup/palette.js, run against a fake DOM and fake
// messenger.* APIs. Each test loads a fresh copy of the popup.
//
// Run with: node --test tests/
//
// These check the popup's logic (filtering, picker mode, confirm flow, which
// API calls are made). They can't catch Thunderbird API mismatches — verify
// those by loading the extension in Thunderbird.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const FUZZY_SRC = fs.readFileSync(path.join(ROOT, "lib/fuzzy.js"), "utf8");
const PALETTE_SRC = fs.readFileSync(path.join(ROOT, "popup/palette.js"), "utf8");

// Just enough of an HTMLElement for palette.js.
function fakeElement(init = {}) {
  const e = {
    id: "",
    className: "",
    children: [],
    listeners: {},
    attrs: {},
    hidden: false,
    value: "",
    placeholder: "",
    textContent: "",
    classList: {
      set: new Set(),
      toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); },
    querySelector() { return this.children.find(c => c.className === "row-label"); },
    focus() {},
    scrollIntoView() {},
    ...init
  };
  // Like the real DOM, innerHTML and textContent overwrite each other.
  let html = "";
  let text = init.textContent ?? "";
  Object.defineProperty(e, "innerHTML", {
    get() { return html; },
    set(v) { html = v; text = v.replace(/<[^>]+>/g, ""); if (v === "") e.children = []; }
  });
  Object.defineProperty(e, "textContent", {
    get() { return text; },
    set(v) { text = v; html = ""; }
  });
  return e;
}

function folder(id, name, extra = {}) {
  return { id, name, path: `/${name}`, subFolders: [], ...extra };
}

// Load a fresh palette with the given selection. Returns helpers to drive it.
async function loadPalette({ selected, palette, unified = UNIFIED, mailTabsUpdate, extraFolders = [] } = {}) {
  const inbox = folder("a1://INBOX", "Inbox", { specialUse: ["inbox"] });
  const projects = folder("a1://Projects", "Projects");
  const savedSearch = folder("a1://Saved", "Saved Search", { isVirtual: true });
  const messages = selected ?? [
    { id: 101, folder: inbox, flagged: false },
    { id: 102, folder: inbox, flagged: true }
  ];

  // Values created inside the vm context have that realm's prototypes, which
  // assert.deepStrictEqual treats as different. Copy them into plain data.
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const calls = [];
  const record = (name) => async (...args) => { calls.push(plain([name, ...args])); };
  const store = {};

  const messenger = {
    storage: { local: { get: async () => ({ ...store }), set: async (o) => { Object.assign(store, plain(o)); } } },
    accounts: {
      list: async () => [{
        id: "a1", name: "Work", type: "imap",
        rootFolder: folder("a1://", "", { isRoot: true, path: "/", subFolders: [inbox, projects, savedSearch, ...extraFolders] })
      }]
    },
    tabs: { query: async () => [{ id: 1, windowId: 10 }], update: async () => {} },
    windows: { getAll: async () => [{ id: 10, focused: true }] },
    // `unified`: type -> folder (missing = null), a function, or null for "API unavailable".
    folders: unified === null ? {} : {
      getUnifiedFolder: typeof unified === "function" ? unified : async (type) => unified[type] ?? null
    },
    mailTabs: {
      query: async () => [{ id: 1, windowId: 10 }],
      update: async (...args) => {
        calls.push(plain(["mailTabs.update", ...args]));
        if (mailTabsUpdate) await mailTabsUpdate(...args);
      },
      create: record("mailTabs.create"),
      getSelectedMessages: async () => ({ id: null, messages })
    },
    messages: {
      move: record("move"),
      copy: record("copy"),
      update: record("update"),
      delete: record("delete"),
      archive: record("archive")
    },
    palette // experiment API; undefined = experiment not loaded
  };

  const els = {
    query: fakeElement({ id: "query", placeholder: "Type a command or folder…" }),
    results: fakeElement({ id: "results" }),
    empty: fakeElement({ id: "empty", textContent: "No matching commands." }),
    mode: fakeElement({ id: "mode", hidden: true }),
    "esc-action": fakeElement({ id: "esc-action", textContent: "close" })
  };
  const state = { closed: false };
  const documentElement = { style: {} };

  const context = vm.createContext({
    console: { ...console, log() {}, warn() {} }, // keep test output clean
    messenger,
    window: { close() { state.closed = true; } },
    document: { documentElement, getElementById: (id) => els[id], createElement: () => fakeElement() }
  });
  vm.runInContext(FUZZY_SRC, context);
  vm.runInContext(PALETTE_SRC, context);
  await settle(); // let init() finish

  const key = (k) => els.query.listeners.keydown({ key: k, preventDefault() {} });
  const type = (v) => { els.query.value = v; els.query.listeners.input(); };
  const rowText = (li) => li.children[1].textContent;
  const labels = () => els.results.children.map(rowText);
  const selectedLabel = () => rowText(els.results.children.find(li => li.classList.contains("selected")));

  return { els, calls, store, state, documentElement, key, type, labels, selectedLabel };
}

const unifiedFolder = (type) => ({ id: `unified-${type}-id`, name: type, isUnified: true, specialUse: [type] });
const UNIFIED_INBOX = unifiedFolder("inbox");
const UNIFIED = { inbox: UNIFIED_INBOX, sent: unifiedFolder("sent"), trash: unifiedFolder("trash") };

const settle = () => new Promise(r => setTimeout(r, 10));

test("message commands are hidden when nothing is selected", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("move");
  assert.ok(!p.labels().includes("Move to Folder…"));
});

test("Move to Folder… opens a picker of valid destinations", async () => {
  const p = await loadPalette();
  p.type("move");
  assert.equal(p.labels()[0], "Move to Folder…");

  p.key("Enter");
  assert.equal(p.els.mode.hidden, false);
  assert.equal(p.els.mode.textContent, "Move 2 messages to…");
  // Source folder (Inbox) and the virtual folder are excluded.
  assert.deepEqual(p.labels(), ["Projects"]);
  assert.equal(p.state.closed, false);
});

test("picking a destination moves the selection and records MRU", async () => {
  const p = await loadPalette();
  p.type("move");
  p.key("Enter");
  p.type("proj");
  p.key("Enter");
  await settle();

  assert.deepEqual(p.calls, [["move", [101, 102], "a1://Projects"]]);
  assert.equal(p.state.closed, true);
  assert.deepEqual(p.store.mru, ["move-to:a1://Projects", "move-to"]);
});

test("Copy to Folder… includes the source folder", async () => {
  const p = await loadPalette();
  p.type("copy");
  p.key("Enter");
  assert.equal(p.els.mode.textContent, "Copy 2 messages to…");
  assert.deepEqual(p.labels(), ["Inbox", "Projects"]);

  p.type("inb");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["copy", [101, 102], "a1://INBOX"]]);
});

test("Move picker keeps the source folder when messages come from several folders", async () => {
  const p = await loadPalette({
    selected: [
      { id: 1, folder: { id: "a1://INBOX" } },
      { id: 2, folder: { id: "a1://Projects" } }
    ]
  });
  p.type("move");
  p.key("Enter");
  assert.deepEqual(p.labels(), ["Inbox", "Projects"]);
});

test("Esc and Backspace-on-empty leave the picker without closing", async () => {
  const p = await loadPalette();
  for (const exitKey of ["Escape", "Backspace"]) {
    p.type("move");
    p.key("Enter");
    assert.equal(p.els.mode.hidden, false);
    assert.equal(p.els["esc-action"].textContent, "back");
    p.key(exitKey);
    assert.equal(p.els["esc-action"].textContent, "close");
    assert.equal(p.els.mode.hidden, true, `${exitKey} should close the picker`);
    assert.equal(p.els.query.placeholder, "Type a command or folder…");
    assert.equal(p.state.closed, false);
  }
  p.key("Escape");
  assert.equal(p.state.closed, true, "Esc in the root list closes the popup");
});

test("Backspace with text in the picker query does not leave the picker", async () => {
  const p = await loadPalette();
  p.type("move");
  p.key("Enter");
  p.type("pr");
  p.key("Backspace");
  assert.equal(p.els.mode.hidden, false);
});

test("destructive commands need a second Enter", async () => {
  const p = await loadPalette();
  p.type("delete");
  assert.equal(p.selectedLabel(), "Delete (Move to Trash)");

  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, []);
  assert.equal(p.selectedLabel(), "Press Enter again to confirm: Delete (Move to Trash)");

  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["delete", [101, 102]]]);
  assert.equal(p.store.mru, undefined, "destructive commands are not recorded");
});

test("moving the selection disarms a destructive command", async () => {
  const p = await loadPalette();
  p.type("delete");
  p.key("Enter");
  p.key("ArrowDown");
  p.key("ArrowUp");
  assert.equal(p.selectedLabel(), "Delete (Move to Trash)");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [], "first Enter after disarming only re-arms");
});

test("Toggle Flag on a mixed selection flags all", async () => {
  const p = await loadPalette();
  p.type("flag");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [
    ["update", 101, { flagged: true }],
    ["update", 102, { flagged: true }]
  ]);
});

test("root font size follows Thunderbird's UI font size", async () => {
  const p = await loadPalette({ palette: { getNewMail() {}, getUIFontSize: async () => 18 } });
  assert.equal(p.documentElement.style.fontSize, "18px");
});

test("implausible UI font sizes are ignored", async () => {
  for (const bad of [0, 3, 200, NaN]) {
    const p = await loadPalette({ palette: { getNewMail() {}, getUIFontSize: async () => bad } });
    assert.equal(p.documentElement.style.fontSize, undefined, `size ${bad}`);
  }
});

test("without the experiment the CSS default font size is kept", async () => {
  const p = await loadPalette();
  assert.equal(p.documentElement.style.fontSize, undefined);
  p.type("move");
  assert.equal(p.labels()[0], "Move to Folder…", "palette still works");
});

test("Go to: Unified Inbox ranks first for 'unified inbox' and opens it", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("unified inbox");
  assert.equal(p.labels()[0], "Go to: Unified Inbox");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { displayedFolderId: "unified-inbox-id" }]]);
  assert.deepEqual(p.store.mru, ["goto-unified-inbox"]);
});

test("typing 'inbox' offers both the unified and per-account inbox", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("inbox");
  const top = p.labels().slice(0, 2).sort();
  assert.deepEqual(top, ["Go to: Inbox", "Go to: Unified Inbox"]);
});

test("Unified Inbox retries with folderMode 'unified' if the plain update is rejected", async () => {
  const p = await loadPalette({
    selected: [],
    mailTabsUpdate: async (_id, props) => {
      if (!props.folderMode) throw new Error("folder not shown in current mode");
    }
  });
  p.type("unified inbox");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [
    ["mailTabs.update", 1, { displayedFolderId: "unified-inbox-id" }],
    ["mailTabs.update", 1, { displayedFolderId: "unified-inbox-id", folderMode: "unified" }]
  ]);
});

test("no Unified Inbox command when the API is unavailable", async () => {
  const p = await loadPalette({ selected: [], unified: null });
  p.type("unified");
  assert.ok(!p.labels().includes("Go to: Unified Inbox"));
});

test("unified folders inside an account tree are not listed twice", async () => {
  const p = await loadPalette({ selected: [], extraFolders: [{ ...UNIFIED_INBOX, path: "/Inbox", subFolders: [] }] });
  p.type(""); // full, unfiltered list
  assert.equal(p.labels().filter(l => l === "Go to: Unified Inbox").length, 1);
  assert.equal(p.labels().filter(l => l === "Go to: Inbox").length, 1, "only the real account Inbox");
});

test("a Go to: Unified command is listed for each available unified folder", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("");
  assert.deepEqual(
    p.labels().filter(l => l.startsWith("Go to: Unified")),
    ["Go to: Unified Inbox", "Go to: Unified Sent", "Go to: Unified Trash"]
  );
});

test("Go to: Unified Sent opens the unified Sent folder", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("unified sent");
  assert.equal(p.labels()[0], "Go to: Unified Sent");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { displayedFolderId: "unified-sent-id" }]]);
  assert.deepEqual(p.store.mru, ["goto-unified-sent"]);
});

test("one failing unified type doesn't hide the others", async () => {
  const p = await loadPalette({
    selected: [],
    unified: async (type) => {
      if (type === "drafts") throw new Error("not supported");
      return UNIFIED[type] ?? null;
    }
  });
  p.type("");
  assert.equal(p.labels().filter(l => l.startsWith("Go to: Unified")).length, 3);
});
