// Test harness: loads the popup (palette.html's scripts, in order) into a vm
// context with a fake DOM and fake messenger.* APIs, and returns helpers to
// drive it with key events. Used by tests/*.test.js.
//
// loadPalette(options):
//   api        { namespace: { fn } } merged into the fake messenger, or
//              (record) => ({...}) to build stubs that record their calls
//   activeTab  tab returned by tabs.query (type "messageCompose" = compose)
//   initialStore  storage.local contents at start (e.g. { mru: [...] })
//   pending    action returned to the popup's "palette:takePending" request
//   selected, palette, unified, junkFolders, mailTab, mailTabsUpdate,
//   extraFolders — see defaults below.

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
    set(v) {
      html = v;
      text = v.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (v === "") e.children = [];
    }
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
async function loadPalette({ initialStore = {}, api = {}, activeTab = { id: 1, windowId: 10, type: "mail" }, pending = null, selected, palette, junkFolders = JUNK_FOLDERS, unified = UNIFIED, mailTabsUpdate, extraFolders = [], mailTab = { id: 1, windowId: 10, folderPaneVisible: true, messagePaneVisible: true, layout: "standard" } } = {}) {
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
  const store = { ...initialStore };

  const messenger = {
    storage: { local: { get: async () => ({ ...store }), set: async (o) => { Object.assign(store, plain(o)); } } },
    accounts: {
      list: async () => [{
        id: "a1", name: "Work", type: "imap",
        rootFolder: folder("a1://", "", { isRoot: true, path: "/", subFolders: [inbox, projects, savedSearch, ...extraFolders] })
      }]
    },
    tabs: { query: async () => [activeTab], update: async () => {} },
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
  if (pending) {
    messenger.runtime = { sendMessage: async (msg) => (msg.type === "palette:takePending" ? pending : null) };
  }
  // Per-test API additions/overrides, merged per namespace. Use rec("name")
  // for a stub that records its calls into `calls`.
  for (const [ns, fns] of Object.entries(typeof api === "function" ? api(record) : api)) {
    messenger[ns] = { ...(messenger[ns] || {}), ...fns };
  }

  const els = {
    query: fakeElement({ id: "query", placeholder: "Type a command or folder…" }),
    results: fakeElement({ id: "results" }),
    empty: fakeElement({ id: "empty", textContent: "No matching commands." }),
    mode: fakeElement({ id: "mode", hidden: true })
  };
  const state = { closed: false };
  const documentElement = { style: {} };

  const context = vm.createContext({
    performance,
    console: { ...console, log() {}, warn() {} }, // keep test output clean
    messenger,
    window: { close() { state.closed = true; } },
    setTimeout, clearTimeout,
    document: { documentElement, getElementById: (id) => els[id], createElement: () => fakeElement() }
  });
  // Like a browser, expose the running <script> as document.currentScript
  // (registerCommands names command sources after it).
  for (const { file, src } of SCRIPTS) {
    context.document.currentScript = { src: `moz-extension://test/${path.relative(ROOT, file)}` };
    vm.runInContext(src, context, { filename: file });
  }
  context.document.currentScript = null;
  await settle(); // let init() finish

  const key = (k) => els.query.listeners.keydown({ key: k, preventDefault() {} });
  const type = (v) => { els.query.value = v; els.query.listeners.input(); };
  const rowText = (li) => li.children[1].textContent;
  const labels = () => els.results.children.map(rowText);
  const selectedLabel = () => rowText(els.results.children.find(li => li.classList.contains("selected")));

  const hints = () => els.results.children.map(li => li.children.find(c => c.className === "row-hint")?.textContent);
  const badges = () => els.results.children.map(li => li.children.find(c => c.className === "row-badge")?.textContent || undefined);
  return { context, els, calls, store, state, documentElement, key, type, labels, hints, badges, selectedLabel };
}

const unifiedFolder = (type) => ({ id: `unified-${type}-id`, name: type, isUnified: true, specialUse: [type] });
const UNIFIED_INBOX = unifiedFolder("inbox");
const UNIFIED = { inbox: UNIFIED_INBOX, sent: unifiedFolder("sent"), trash: unifiedFolder("trash") };

const JUNK_FOLDERS = {
  a1: { id: "a1://Junk", name: "Junk", accountId: "a1", specialUse: ["junk"] },
  a2: { id: "a2://Spam", name: "Spam", accountId: "a2", specialUse: ["junk"] }
};

const settle = () => new Promise(r => setTimeout(r, 10));


module.exports = { loadPalette, settle, folder, UNIFIED, UNIFIED_INBOX, JUNK_FOLDERS };
