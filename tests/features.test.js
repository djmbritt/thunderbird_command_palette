// Tests for the command groups added on top of the core palette: view
// (filters, sort, grouping), folder actions, tags, navigation, compose,
// search, experiment commands, prefixes, and shortcut-launched commands.
//
// Run with: node --test tests/

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadPalette, settle } = require("./harness.js");

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const only = (calls, name) => calls.filter(c => c[0] === name);

// ---- View: quick filters, sort, grouping -----------------------------------

test("Filter: Unread sets only the unread quick filter", async () => {
  const p = await loadPalette({ selected: [], api: (rec) => ({ mailTabs: { setQuickFilter: rec("setQuickFilter") } }) });
  p.type("filter unread");
  assert.equal(p.labels()[0], "Filter: Unread");
  p.key("Enter");
  await settle();
  // Only the filter to turn on: `false` would set the inverted filter.
  assert.deepEqual(p.calls, [["setQuickFilter", 1, { unread: true, show: true }]]);
});

test("Filter: Clear passes no filters (setQuickFilter clears everything first)", async () => {
  const p = await loadPalette({ selected: [], api: (rec) => ({ mailTabs: { setQuickFilter: rec("setQuickFilter") } }) });
  p.type("filter clear");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["setQuickFilter", 1, {}]]);
});

test("Sort by marks the current column and keeps the direction", async () => {
  const mailTab = { tabId: 1, windowId: 10, sortType: "date", sortOrder: "descending" };
  const p = await loadPalette({ selected: [], mailTab });
  p.type("sort by");
  const i = p.labels().indexOf("Sort by Date");
  assert.equal(p.hints()[i], "current · descending");

  p.type("sort by subject");
  assert.equal(p.labels()[0], "Sort by Subject");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { sortType: "subject", sortOrder: "descending" }]]);
});

test("Reverse Sort Order flips the direction of the current column", async () => {
  const p = await loadPalette({ selected: [], mailTab: { tabId: 1, windowId: 10, sortType: "subject", sortOrder: "ascending" } });
  p.type("reverse sort");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { sortType: "subject", sortOrder: "descending" }]]);
});

test("View: Threaded sets groupType and the current one is marked", async () => {
  const p = await loadPalette({ selected: [], mailTab: { tabId: 1, windowId: 10, groupType: "ungrouped" } });
  p.type("view:");
  const i = p.labels().indexOf("View: Unthreaded");
  assert.equal(p.hints()[i], "current");
  p.type("threaded");
  assert.equal(p.labels()[0], "View: Threaded");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { groupType: "groupedByThread" }]]);
});

// ---- Folder actions ---------------------------------------------------------

const displayed = { id: "a1://INBOX", name: "Inbox", isFavorite: false };

test("Mark Folder as Read acts on the displayed folder", async () => {
  const p = await loadPalette({
    selected: [],
    mailTab: { tabId: 1, windowId: 10, displayedFolder: displayed },
    api: (rec) => ({ folders: { markAsRead: rec("markAsRead") } })
  });
  p.type("mark folder");
  assert.equal(p.labels()[0], "Mark Folder as Read");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["markAsRead", "a1://INBOX"]]);
});

test("favorite toggle label follows the folder's state", async () => {
  const p = await loadPalette({
    selected: [],
    mailTab: { tabId: 1, windowId: 10, displayedFolder: { ...displayed, isFavorite: true } },
    api: (rec) => ({ folders: { update: rec("folders.update") } })
  });
  p.type("favorite");
  assert.equal(p.labels()[0], "Remove Folder from Favorites");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["folders.update", "a1://INBOX", { isFavorite: false }]]);
});

test("folder actions are hidden when no folder is displayed", async () => {
  const p = await loadPalette({ selected: [], mailTab: { tabId: 1, windowId: 10 } });
  p.type("mark folder");
  assert.ok(!p.labels().includes("Mark Folder as Read"));
});

// ---- Messages: open in tab/window, notifications ---------------------------

test("Open Message in New Tab opens the first selected message", async () => {
  const p = await loadPalette({ api: (rec) => ({ messageDisplay: { open: rec("open") } }) });
  p.type("new tab");
  assert.equal(p.labels()[0], "Open Message in New Tab");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["open", { messageId: 101, location: "tab" }]]);
});

test("moving messages shows a notification", async () => {
  const p = await loadPalette({ api: (rec) => ({ notifications: { create: rec("notify") } }) });
  p.type("move");
  p.key("Enter");
  p.type("proj");
  p.key("Enter");
  await settle();
  assert.deepEqual(only(p.calls, "notify"), [["notify",
    { type: "basic", title: "Command Palette", message: "Moved 2 messages to Projects" }]]);
});

// ---- Tags -------------------------------------------------------------------

const TAGS = [
  { key: "$label1", tag: "Important", color: "#FF0000", ordinal: "" },
  { key: "$label2", tag: "Work", color: "#FF9900", ordinal: "" }
];

function tagApi(rec) {
  return {
    messages: { tags: { list: async () => TAGS.map(t => ({ ...t })) } },
    folders: { getTagFolder: async (key) => ({ id: `tag-folder:${key}`, isTag: true }) }
  };
}

test("Tag with… lists tags in their colours and adds a tag to the selection", async () => {
  const p = await loadPalette({
    selected: [{ id: 1, tags: ["$label2"] }, { id: 2, tags: [] }],
    api: tagApi
  });
  p.type("tag with");
  p.key("Enter");
  await settle(); // async picker
  assert.equal(p.els.mode.textContent, "Tag 2 messages…");
  assert.deepEqual(p.labels(), ["Important", "Work"]);
  assert.equal(p.els.results.children[0].children[0].style.color, "#FF0000");
  assert.equal(p.hints()[1], "on 1 of 2");

  p.type("work");
  p.key("Enter");
  await settle();
  assert.deepEqual(only(p.calls, "update"), [
    ["update", 1, { tags: ["$label2"] }],
    ["update", 2, { tags: ["$label2"] }]
  ]);
});

test("Tag with… removes a tag that every selected message has", async () => {
  const p = await loadPalette({
    selected: [{ id: 1, tags: ["$label1", "$label2"] }, { id: 2, tags: ["$label1"] }],
    api: tagApi
  });
  p.type("tag with");
  p.key("Enter");
  await settle();
  assert.equal(p.hints()[0], "✓ applied · Enter removes");
  p.key("Enter"); // Important
  await settle();
  assert.deepEqual(only(p.calls, "update"), [
    ["update", 1, { tags: ["$label2"] }],
    ["update", 2, { tags: [] }]
  ]);
});

test("Go to Tag opens the tag folder; # lists only tags", async () => {
  const p = await loadPalette({ selected: [], api: tagApi });
  p.type("#");
  assert.deepEqual(p.labels(), ["Go to Tag: Important", "Go to Tag: Work"]);
  p.type("#wo");
  p.key("Enter");
  await settle();
  assert.deepEqual(only(p.calls, "mailTabs.update"), [["mailTabs.update", 1, { displayedFolderId: "tag-folder:$label2" }]]);
});

// ---- Prefixes ---------------------------------------------------------------

test("@ lists only folders and > excludes them", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("@");
  assert.ok(p.labels().length > 0);
  assert.ok(p.labels().every(l => l.startsWith("Go to:")), p.labels().join(", "));
  p.type(">inbox");
  assert.ok(!p.labels().some(l => l.startsWith("Go to:")));
});

// ---- Navigation -------------------------------------------------------------

test("Switch to Tab… activates the tab and focuses its window", async () => {
  const tabs = [
    { id: 1, windowId: 10, type: "mail", title: "Inbox", active: true },
    { id: 7, windowId: 11, type: "messageCompose", title: "Write: Hello" }
  ];
  const p = await loadPalette({
    selected: [],
    api: (rec) => ({
      tabs: { query: async (q) => (q && q.active ? [tabs[0]] : tabs), update: rec("tabs.update") },
      windows: { getAll: async () => [{ id: 10 }], update: rec("windows.update") }
    })
  });
  p.type("switch tab");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.labels(), ["Inbox", "Write: Hello"]);
  assert.equal(p.hints()[0], "Mail · current");
  p.type("hello");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["tabs.update", 7, { active: true }], ["windows.update", 11, { focused: true }]]);
  assert.equal(p.store.mru, undefined, "tab items are not recorded");
});

test("Write to… lists contacts from vCards and composes to the chosen one", async () => {
  const vcard = (fn, ...emails) =>
    `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${fn}\r\n${emails.map(e => `EMAIL:${e}`).join("\r\n")}\r\nEND:VCARD\r\n`;
  const p = await loadPalette({
    selected: [],
    api: (rec) => ({
      addressBooks: {
        list: async () => [{ id: "ab1" }, { id: "ldap", remote: true }],
        contacts: {
          list: async (bookId) => (bookId === "ab1" ? [
            { id: "c1", vCard: vcard("Zoe Zed", "zoe@z.org") },
            { id: "c2", vCard: vcard("Smith\\, Ann", "ann@work.org", "ann@home.org") },
            { id: "c3", vCard: vcard("No Email") }
          ] : Promise.reject(new Error("remote books can't be listed")))
        }
      },
      compose: { beginNew: rec("beginNew") }
    })
  });
  p.type("write to");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.labels(), ["Smith, Ann", "Smith, Ann", "Zoe Zed"]);
  p.type("home");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["beginNew", { to: ['"Smith, Ann" <ann@home.org>'] }]]);
});

// ---- Compose window ---------------------------------------------------------

function composeOptions(details, extraApi = () => ({})) {
  return {
    selected: [],
    mailTab: null,
    activeTab: { id: 5, windowId: 20, type: "messageCompose" },
    api: (rec) => ({
      compose: {
        getComposeDetails: async () => details,
        setComposeDetails: rec("setComposeDetails"),
        saveMessage: rec("saveMessage"),
        sendMessage: rec("sendMessage")
      },
      ...extraApi(rec)
    })
  };
}

test("compose commands appear only in a compose window", async () => {
  const mail = await loadPalette({ selected: [] });
  mail.type("save as template");
  assert.ok(!mail.labels().includes("Save as Template"));

  const p = await loadPalette(composeOptions({ identityId: "id1" }));
  p.type("save as template");
  assert.equal(p.labels()[0], "Save as Template");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["saveMessage", 5, { mode: "template" }]]);
});

test("Send Later needs a second Enter and isn't recorded", async () => {
  const p = await loadPalette(composeOptions({}));
  p.type("send later");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, []);
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["sendMessage", 5, { mode: "sendLater" }]]);
  assert.equal(p.store.mru, undefined);
});

test("Send from… marks the current identity and switches to another", async () => {
  const p = await loadPalette(composeOptions({ identityId: "id1" }, () => ({
    identities: { list: async () => [
      { id: "id1", name: "Ann", email: "ann@work.org", label: "Work" },
      { id: "id2", name: "Ann", email: "ann@home.org", label: "" }
    ] }
  })));
  p.type("send from");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.labels(), ["Ann <ann@home.org>", "Ann <ann@work.org>"]);
  assert.equal(p.hints()[1], "Work · current");
  p.type("home");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["setComposeDetails", 5, { identityId: "id2" }]]);
});

test("return receipt toggle reflects and flips the current setting", async () => {
  const p = await loadPalette(composeOptions({ returnReceipt: true }));
  p.type("return receipt");
  assert.equal(p.labels()[0], "Don't Request Return Receipt");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["setComposeDetails", 5, { returnReceipt: false }]]);
});

test("Set Priority… marks the current priority", async () => {
  const p = await loadPalette(composeOptions({ priority: "high" }));
  p.type("priority");
  assert.equal(p.hints()[p.labels().indexOf("Set Priority…")], "now High");
  p.type("set priority");
  p.key("Enter");
  assert.equal(p.hints()[p.labels().indexOf("High")], "current");
  p.type("lowest");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["setComposeDetails", 5, { priority: "lowest" }]]);
});

// ---- Message search ---------------------------------------------------------

test("?query searches subject and sender, newest first, and opens a result", async () => {
  const msg = (id, subject, author, date) => ({ id, subject, author, date, read: true });
  const queries = [];
  const p = await loadPalette({
    selected: [],
    api: (rec) => ({
      messages: {
        query: async (q) => {
          queries.push(q);
          return q.subject
            ? { id: "list-s", messages: [msg(1, "Invoice March", "Bob <b@x>", "2026-03-01"), msg(2, "Invoice April", "Bob <b@x>", "2026-04-01")] }
            : { id: null, messages: [msg(2, "Invoice April", "Bob <b@x>", "2026-04-01"), msg(3, "Lunch", "Invoicing Team <i@x>", "2026-05-01")] };
        },
        abortList: rec("abortList")
      },
      messageDisplay: { open: rec("open") }
    })
  });
  p.type("?i");
  assert.equal(p.els.empty.textContent, "Search messages: type a subject or sender…");

  p.type("?invoic");
  assert.equal(p.els.empty.textContent, "Searching…");
  await wait(320);
  // Subject matching is case-sensitive in Thunderbird, so the capitalised
  // form is searched too; the author match is case-insensitive already.
  assert.deepEqual(queries.map(q => q.subject ? `subject:${q.subject}` : `author:${q.author}`),
    ["subject:invoic", "subject:Invoic", "author:invoic"]);
  assert.deepEqual(p.labels(), ["Lunch", "Invoice April", "Invoice March"]);
  assert.equal(p.hints()[0].startsWith("Invoicing Team · "), true);
  assert.deepEqual(only(p.calls, "abortList"), [["abortList", "list-s"], ["abortList", "list-s"]]);

  p.key("Enter");
  await settle();
  assert.deepEqual(only(p.calls, "open"), [["open", { messageId: 3, location: "tab" }]]);
  assert.equal(p.store.mru, undefined, "search results are not recorded");
});

test("a stale search result doesn't overwrite a newer query", async () => {
  let release;
  const slow = new Promise(r => { release = r; });
  const p = await loadPalette({
    selected: [],
    api: { messages: { query: async (q) => { if (q.subject === "old" || q.author === "old") await slow; return { id: null, messages: [] }; } } }
  });
  p.type("?old");
  await wait(300);    // first search is in flight
  p.type("compose");  // user leaves search mode
  release();
  await settle();
  assert.equal(p.labels()[0], "Compose: New Message");
});

// ---- Experiment-backed commands --------------------------------------------

function experiment(rec) {
  return {
    getNewMail() {},
    runCommand: rec("runCommand"),
    toggleTodayPane: rec("toggleTodayPane"),
    openSpace: rec("openSpace")
  };
}

test("Undo dispatches cmd_undo through the experiment", async () => {
  const calls = [];
  const rec = (name) => async (...a) => { calls.push([name, ...a]); };
  const p = await loadPalette({ selected: [], palette: experiment(rec) });
  p.type("undo");
  assert.equal(p.labels()[0], "Undo");
  p.key("Enter");
  await settle();
  assert.deepEqual(calls, [["runCommand", "cmd_undo"]]);
});

test("Open Calendar and Toggle Today Pane use the experiment", async () => {
  const calls = [];
  const rec = (name) => async (...a) => { calls.push([name, ...a]); };
  let p = await loadPalette({ selected: [], palette: experiment(rec) });
  p.type("open calendar");
  p.key("Enter");
  await settle();
  p = await loadPalette({ selected: [], palette: experiment(rec) });
  p.type("today pane");
  p.key("Enter");
  await settle();
  assert.deepEqual(calls, [["openSpace", "calendar"], ["toggleTodayPane"]]);
});

test("experiment commands are absent without the experiment", async () => {
  const p = await loadPalette({ selected: [] });
  p.type("undo");
  assert.ok(!p.labels().includes("Undo"));
  p.type("calendar");
  assert.ok(!p.labels().includes("Open Calendar"));
});

test("message-only internal commands need a selection", async () => {
  const calls = [];
  const rec = (name) => async (...a) => { calls.push([name, ...a]); };
  const none = await loadPalette({ selected: [], palette: experiment(rec) });
  none.type("view message source");
  assert.ok(!none.labels().includes("View Message Source"));
  const p = await loadPalette({ palette: experiment(rec) });
  p.type("view message source");
  assert.equal(p.labels()[0], "View Message Source");
});

test("Configure Keyboard Shortcuts appears only when the API exists", async () => {
  const without = await loadPalette({ selected: [] });
  without.type("keyboard shortcuts");
  assert.ok(!without.labels().includes("Configure Keyboard Shortcuts"));
  const p = await loadPalette({ selected: [], api: (rec) => ({ commands: { openShortcutSettings: rec("openShortcutSettings") } }) });
  p.type("keyboard shortcuts");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [["openShortcutSettings"]]);
});

// ---- Shortcut-launched commands ---------------------------------------------

test("a move-to shortcut opens the Move picker directly", async () => {
  const p = await loadPalette({ pending: "move-to" });
  assert.equal(p.els.mode.textContent, "Move 2 messages to…");
  assert.deepEqual(p.labels(), ["Projects"]);
});

test("the go-to-folder shortcut prefills @", async () => {
  const p = await loadPalette({ selected: [], pending: "@" });
  assert.equal(p.els.query.value, "@");
  assert.ok(p.labels().every(l => l.startsWith("Go to:")));
});

test("repeat-last runs the most recent available command", async () => {
  const p = await loadPalette({
    selected: [],
    pending: "repeat-last",
    // mark-read needs a message (none selected) so it's skipped.
    initialStore: { mru: ["mark-read", "layout-wide", "reply"] }
  });
  await settle();
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { layout: "wide" }]]);
  assert.equal(p.state.closed, true);
});

test("repeat-last never fires a destructive command", async () => {
  const p = await loadPalette({ pending: "repeat-last", initialStore: { mru: ["delete", "mark-read"] } });
  await settle();
  assert.deepEqual(p.calls, [["update", 101, { read: true }], ["update", 102, { read: true }]]);
});

// ---- Startup timing instrumentation -----------------------------------------

// Poll until `fn()` is truthy (saving a run takes a few async hops).
async function until(fn, ms = 1000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await wait(5);
  }
}

const TIMING_ON = { debugStartupTiming: "1" };

test("each open saves a startup timing run with named steps and counts", async () => {
  const p = await loadPalette({ selected: [], initialLocalStorage: TIMING_ON });
  await until(() => p.store.startupTimings?.[0]?.steps.firstPaint);
  const [run] = p.store.startupTimings;
  for (const step of ["setup: accounts.list(true)", "setup: captureContext", "buildCommands (immediate)",
    "source: folders.js#3", "first refilter + render", "firstPaint", "deferred sources (after paint)",
    "source: folders.js#2", "source: tags.js#1"]) {
    assert.ok(run.steps[step], `missing step ${step}: ${Object.keys(run.steps).join(", ")}`);
  }
  assert.equal(run.counts.folders, 3);
  assert.equal(run.counts.selectedMessages, 0);
  assert.ok(run.counts.commands > 0);
});

test("Debug: Copy Startup Timings copies a readable summary", async () => {
  let copied = null;
  const p = await loadPalette({ selected: [], initialLocalStorage: TIMING_ON });
  await until(() => p.store.startupTimings?.[0]?.steps.firstPaint);
  p.context.navigator = { clipboard: { writeText: async (t) => { copied = t; } } };
  p.type("copy startup timings");
  p.key("Enter");
  await until(() => copied);
  assert.match(copied, /^startup .*: first paint at \d+ ms/);
  assert.match(copied, /setup: accounts\.list\(true\)/);
  assert.match(copied, /counts: .*folders=3/);
});

// ---- Startup ordering: paint first, enrich later ------------------------------

test("only the first rows are built before the first paint; the rest follow", async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `a1://F${i}`, name: `Folder ${i}`, path: `/F${i}`, subFolders: [] }));
  const p = await loadPalette({ selected: [], extraFolders: many, initialLocalStorage: TIMING_ON });
  await until(() => p.store.startupTimings?.[0]?.steps.firstPaint);
  const run = p.store.startupTimings[0];
  assert.equal(run.counts.rowsInFirstChunk, 30);
  assert.ok(run.counts.rowsTotal > 30);
  await until(() => p.els.results.children.length > 30);
});

test("unified folders and tags arrive after first paint and keep their place in the list", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const p = await loadPalette({
    selected: [],
    unified: async (type) => { await gate; return type === "inbox" ? { id: "u-inbox", isUnified: true } : null; }
  });
  p.type("unified inbox");
  assert.ok(!p.labels().includes("Go to: Unified Inbox"), "not there before the deferred source resolves");
  release();
  await until(() => p.labels().includes("Go to: Unified Inbox"));
  assert.equal(p.labels()[0], "Go to: Unified Inbox", "merged into the current query's results");
});

test("an Enter pressed before deferred commands arrive runs the true top MRU entry", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const p = await loadPalette({
    selected: [],
    initialStore: { mru: ["goto-unified-inbox", "layout-wide"] },
    unified: async (type) => { await gate; return type === "inbox" ? { id: "u-inbox", isUnified: true } : null; }
  });
  assert.equal(p.labels()[0], "Layout: Wide View", "deferred MRU entry not loaded yet");
  p.key("Enter");
  await settle();
  assert.deepEqual(p.calls, [], "Enter waits for the deferred commands");
  release();
  await until(() => p.state.closed);
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { displayedFolderId: "u-inbox" }]]);
});

test("a row the user picked stays selected when deferred commands arrive", async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const p = await loadPalette({
    selected: [],
    initialStore: { mru: ["goto-unified-inbox", "layout-wide", "layout-vertical"] },
    unified: async (type) => { await gate; return type === "inbox" ? { id: "u-inbox", isUnified: true } : null; }
  });
  p.key("ArrowDown"); // explicit choice: Layout: Vertical View
  assert.equal(p.selectedLabel(), "Layout: Vertical View");
  release();
  await until(() => p.labels()[0] === "Go to: Unified Inbox");
  assert.equal(p.selectedLabel(), "Layout: Vertical View");
});

test("a queued Enter is cancelled by typing, and gives up waiting after a second", async () => {
  const hang = new Promise(() => {}); // deferred source never resolves
  const typed = await loadPalette({ selected: [], unified: async () => hang });
  typed.key("Enter");
  typed.type("layout wide");
  await wait(1100);
  assert.deepEqual(typed.calls, [], "typing cancelled the queued Enter");

  const p = await loadPalette({ selected: [], initialStore: { mru: ["layout-wide"] }, unified: async () => hang });
  p.key("Enter");
  await until(() => p.state.closed, 2000);
  assert.deepEqual(p.calls, [["mailTabs.update", 1, { layout: "wide" }]]);
});

test("startup timing is off by default: nothing logged or saved, no copy command", async () => {
  const p = await loadPalette({ selected: [] });
  await wait(50);
  assert.equal(p.store.startupTimings, undefined);
  p.type("startup timing");
  assert.deepEqual(p.labels(), ["Debug: Turn On Startup Timing"]);
});

test("the toggle turns timing on, and turning it off clears saved runs", async () => {
  const on = await loadPalette({ selected: [] });
  on.type("turn on startup timing");
  on.key("Enter");
  await until(() => on.state.closed);
  assert.equal(on.local.get("debugStartupTiming"), "1");

  const off = await loadPalette({
    selected: [],
    initialLocalStorage: TIMING_ON,
    initialStore: { startupTimings: [{ at: "old", steps: {}, counts: {} }] }
  });
  off.type("turn off startup timing");
  assert.equal(off.labels()[0], "Debug: Turn Off Startup Timing");
  off.key("Enter");
  await until(() => off.state.closed);
  assert.equal(off.local.get("debugStartupTiming"), undefined);
  assert.equal(off.store.startupTimings, undefined);
});

// ---- Other add-ons' commands -------------------------------------------------

const ADDON_COMMANDS = [
  { extensionId: "editor@x", extensionName: "External Editor", command: "open-editor", label: "Edit in external editor", shortcut: "Ctrl+E", kind: "command" },
  { extensionId: "editor@x", extensionName: "External Editor", command: "_execute_action", label: "Editor settings", shortcut: "", kind: "action" },
  { extensionId: "quote@x", extensionName: "Quoter", command: "_execute_compose_action", label: "Insert quote", shortcut: "", kind: "composeAction" },
  { extensionId: "rate@x", extensionName: "Rater", command: "_execute_message_display_action", label: "Rate message", shortcut: "", kind: "messageDisplayAction" }
];

function addonExperiment(rec) {
  return { ...experiment(rec), listAddonCommands: async () => ADDON_COMMANDS, runAddonCommand: rec("runAddonCommand") };
}

test("other add-ons' commands are listed as '<Add-on>: <command>' and run through the experiment", async () => {
  const calls = [];
  const rec = (name) => async (...a) => { calls.push([name, ...a]); };
  const p = await loadPalette({ palette: addonExperiment(rec) });
  p.type("edit in external");
  assert.equal(p.labels()[0], "External Editor: Edit in external editor");
  assert.equal(p.hints()[0], "Ctrl+E");
  p.key("Enter");
  await settle();
  assert.deepEqual(calls, [["runAddonCommand", "editor@x", "open-editor"]]);
  assert.deepEqual(p.store.mru, ["addon:editor@x:open-editor"]);
});

test("add-on buttons follow their context: compose buttons need a compose window, message buttons a message", async () => {
  const rec = () => async () => {};
  let p = await loadPalette({ palette: addonExperiment(rec) });
  assert.ok(p.labels().includes("External Editor: Editor settings"), "toolbar buttons are always listed");
  assert.ok(p.labels().includes("Rater: Rate message"), "message button with a selection");
  assert.ok(!p.labels().includes("Quoter: Insert quote"), "no compose button outside a compose window");
  p = await loadPalette({ selected: [], palette: addonExperiment(rec) });
  assert.ok(!p.labels().includes("Rater: Rate message"), "no message button without a message");
});

test("no add-on commands without the experiment function", async () => {
  const p = await loadPalette({ palette: experiment(() => async () => {}) });
  p.type("external editor");
  assert.ok(!p.labels().some(l => l.startsWith("External Editor:")));
});
