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
// Load the popup's scripts exactly as palette.html does, in its <script> order,
// so new command files are picked up without touching the tests.
const HTML = fs.readFileSync(path.join(ROOT, "popup/palette.html"), "utf8");
const SCRIPTS = [...HTML.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => {
  const file = path.join(ROOT, "popup", m[1]);
  return { file, src: fs.readFileSync(file, "utf8") };
});

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
    style: {},
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
async function loadPalette({ selected, palette, junkFolders = JUNK_FOLDERS, unified = UNIFIED, mailTabsUpdate, extraFolders = [], mailTab = { id: 1, windowId: 10, folderPaneVisible: true, messagePaneVisible: true, layout: "standard" } } = {}) {
  const inbox = folder("a1://INBOX", "Inbox", { specialUse: ["inbox"], accountId: "a1" });
  const projects = folder("a1://Projects", "Projects", { accountId: "a1" });
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
    folders: {
      // Only junk lookups are modelled: accountId -> Junk folder.
      query: async ({ accountId, specialUse }) =>
        specialUse?.includes("junk") && junkFolders[accountId] ? [junkFolders[accountId]] : [],
      ...(unified === null ? {} : {
        getUnifiedFolder: typeof unified === "function" ? unified : async (type) => unified[type] ?? null
      })
    },
    mailTabs: {
      // `mailTab: null` simulates opening the palette from a non-mail tab.
      query: async () => (mailTab ? [mailTab] : []),
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
    mode: fakeElement({ id: "mode", hidden: true })
  };
  const state = { closed: false };
  const documentElement = { style: {} };

  const context = vm.createContext({
    console: { ...console, log() {}, warn() {} }, // keep test output clean
    messenger,
    window: { close() { state.closed = true; } },
    setTimeout, clearTimeout,
    document: { documentElement, getElementById: (id) => els[id], createElement: () => fakeElement() }
  });
  for (const { file, src } of SCRIPTS) vm.runInContext(src, context, { filename: file });
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

const JUNK_FOLDERS = {
  a1: { id: "a1://Junk", name: "Junk", accountId: "a1", specialUse: ["junk"] },
  a2: { id: "a2://Spam", name: "Spam", accountId: "a2", specialUse: ["junk"] }
};

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
    p.key(exitKey);
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

test("folder pane command hides a visible folder pane", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("folder pane");
  assert.equal(p.labels()[0], "Hide Folder Pane");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { folderPaneVisible: false }]]);
});

test("folder pane command shows a hidden folder pane", async () => {
  const p = await loadPalette({ selected: [], mailTab: { id: 1, windowId: 10, folderPaneVisible: false } });
  p.type("toggle folder");
  assert.equal(p.labels()[0], "Show Folder Pane");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { folderPaneVisible: true }]]);
});

test("folder pane command is hidden outside a mail tab", async () => {
  const p = await loadPalette({ selected: [], mailTab: null });
  p.type("folder pane");
  assert.ok(!p.labels().some(l => l.endsWith("Folder Pane")));
});

test("message pane command hides a visible message pane", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("message pane");
  assert.equal(p.labels()[0], "Hide Message Pane");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { messagePaneVisible: false }]]);
});

test("message pane command shows a hidden message pane", async () => {
  const p = await loadPalette({
    selected: [],
    mailTab: { id: 1, windowId: 10, folderPaneVisible: true, messagePaneVisible: false, layout: "standard" }
  });
  p.type("preview");
  assert.equal(p.labels()[0], "Show Message Pane");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { messagePaneVisible: true }]]);
});

test("layout commands list all three layouts and mark the current one", async () => {
  const p = await loadPalette({
    selected: [],
    mailTab: { id: 1, windowId: 10, folderPaneVisible: true, messagePaneVisible: true, layout: "wide" }
  });
  p.type("layout");
  const rows = p.els.results.children.map(li => ({
    label: li.children[1].textContent,
    hint: li.children[2]?.textContent
  })).filter(r => r.label.startsWith("Layout:"));
  assert.deepEqual(rows.map(r => r.label).sort(), ["Layout: Classic View", "Layout: Vertical View", "Layout: Wide View"]);
  assert.equal(rows.find(r => r.label === "Layout: Wide View").hint, "current");
  assert.equal(rows.filter(r => r.hint === "current").length, 1);
});

test("choosing a layout updates the mail tab", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("vertical");
  assert.equal(p.labels()[0], "Layout: Vertical View");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { layout: "vertical" }]]);
});

test("pane and layout commands are hidden outside a mail tab", async () => {
  const p = await loadPalette({ selected: [], mailTab: null });
  p.type("");
  assert.ok(!p.labels().some(l => l.includes("Message Pane") || l.startsWith("Layout:")));
});

test("Mark as Junk flags the selection and moves it to the account's Junk folder", async () => {
  const p = await loadPalette();
  p.type("junk");
  assert.equal(p.labels()[0], "Mark as Junk");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [
    ["update", 101, { junk: true }],
    ["update", 102, { junk: true }],
    ["move", [101, 102], "a1://Junk"]
  ]);
});

test("Mark as Junk moves messages from different accounts to their own Junk folders", async () => {
  const p = await loadPalette({
    selected: [
      { id: 1, folder: { id: "a1://INBOX", accountId: "a1" } },
      { id: 2, folder: { id: "a2://INBOX", accountId: "a2" } },
      { id: 3, folder: { id: "a1://Lists", accountId: "a1" } }
    ]
  });
  p.type("mark as junk");
  p.key("Enter");
  await settle();
  const moves = p.calls.filter(c => c[0] === "move").sort((a, b) => a[2].localeCompare(b[2]));
  assert.deepEqual(moves, [
    ["move", [1, 3], "a1://Junk"],
    ["move", [2], "a2://Spam"]
  ]);
});

test("Mark as Junk doesn't move messages already in Junk", async () => {
  const p = await loadPalette({
    selected: [
      { id: 1, folder: { id: "a1://Junk", accountId: "a1" } },
      { id: 2, folder: { id: "a1://INBOX", accountId: "a1" } }
    ]
  });
  p.type("mark as junk");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls.filter(c => c[0] === "move"), [["move", [2], "a1://Junk"]]);
});

test("Mark as Junk still flags messages when the account has no Junk folder", async () => {
  const p = await loadPalette({ junkFolders: {} });
  p.type("mark as junk");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [
    ["update", 101, { junk: true }],
    ["update", 102, { junk: true }]
  ]);
});

test("Mark as Not Junk clears the junk flag", async () => {
  const p = await loadPalette();
  p.type("not junk");
  assert.equal(p.labels()[0], "Mark as Not Junk");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [
    ["update", 101, { junk: false }],
    ["update", 102, { junk: false }]
  ]);
});

test("junk commands need a selected message", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("junk");
  assert.ok(!p.labels().some(l => l.startsWith("Mark as")));
});
