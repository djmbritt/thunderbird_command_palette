// Command Palette popup — core.
//
// Runs as the `action` popup (opened by the `_execute_action` shortcut).
// This file holds shared state, context capture, helpers, matching, rendering
// and picker mode. Commands live in popup/commands/*.js and register via
// registerCommands(); popup/main.js starts everything with init().
//
// Lifecycle:
//   1. On load: capture the mail context of the window hosting the popup
//      (active mail tab + selected or displayed messages), load MRU history.
//   2. Build the command list from every registered command source.
//   3. Render filtered/scored list on each keystroke.
//   4. Enter executes the highlighted item (destructive ones need a second
//      Enter to confirm), then closes the popup.
//   5. Esc closes without executing; outside click closes natively.

const queryEl = document.getElementById("query");
const resultsEl = document.getElementById("results");
const emptyEl = document.getElementById("empty");
const modeEl = document.getElementById("mode");

let commands = [];
let filtered = [];
let selectedIndex = 0;
// Captured once when the palette opens (see captureContext):
//   mailTab          active 3-pane mail tab of the originating window, or null
//   windowId         originating window
//   selectedMessages selected (mail tab) or displayed (message tab) messages
//   composeTab       active compose tab, or null
//   composeDetails   compose.getComposeDetails() of composeTab, or null
let ctx = { mailTab: null, windowId: null, selectedMessages: [], composeTab: null, composeDetails: null };

// MRU (most-recently-used) state. Persisted in storage.local as an ordered
// array of command ids — index 0 is most recent. Capped at MRU_CAP entries.
const MRU_CAP = 50;
let mruList = [];
let mruRank = new Map(); // id -> position (0 = most recent)

// Diagnostic switches, set from a devtools console, e.g.
//   messenger.storage.local.set({ debug: { skipUnreadCounts: true } })
// Read together with the MRU list so they cost no extra round trip.
let debugSettings = {};

async function loadMru() {
  try {
    const r = await messenger.storage.local.get(["mru", "debug"]);
    mruList = Array.isArray(r.mru) ? r.mru : [];
    debugSettings = r.debug && typeof r.debug === "object" ? r.debug : {};
  } catch (e) {
    console.warn("[palette] mru load failed", e);
    mruList = [];
  }
  rebuildMruRank();
}

function rebuildMruRank() {
  mruRank = new Map();
  mruList.forEach((id, i) => mruRank.set(id, i));
}

async function recordUsage(id) {
  if (!id) return;
  mruList = [id, ...mruList.filter(x => x !== id)].slice(0, MRU_CAP);
  rebuildMruRank();
  try {
    await messenger.storage.local.set({ mru: mruList });
  } catch (e) {
    console.warn("[palette] mru save failed", e);
  }
}

// MRU boost for non-empty queries: small tie-breaker only, never overrides
// a clearly-better fuzzy match. Top-of-MRU gets ~0.5; decays linearly to 0
// by rank 20. Tuned against fuzzy scores which typically range 1–20.
function mruBoost(id) {
  if (!id) return 0;
  const rank = mruRank.get(id);
  if (rank === undefined) return 0;
  return Math.max(0, 0.5 * (1 - rank / 20));
}

// True when manifest's experiment_apis.palette successfully loaded.
// If false, palette.* calls would throw — feature-detect and gate commands.
const HAS_EXPERIMENT = typeof messenger.palette?.getNewMail === "function";

// Flatten a paginated MessageList (or a plain array, which some APIs/versions
// return) into a single array of MessageHeaders.
async function collectMessages(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  const out = [...(list.messages || [])];
  let page = list;
  while (page.id) {
    page = await messenger.messages.continueList(page.id);
    Timing.count("selectionExtraPages");
    out.push(...page.messages);
  }
  return out;
}

// Scale the palette with Thunderbird's UI font size. All text sizes in
// palette.css are rem, so setting the root font size scales everything.
// Without the experiment, the CSS fallback (15px) applies.
async function applyUIFontSize() {
  if (typeof messenger.palette?.getUIFontSize !== "function") return;
  try {
    const px = await messenger.palette.getUIFontSize();
    // Ignore missing/implausible values rather than render something unusable.
    if (px >= 8 && px <= 40) document.documentElement.style.fontSize = `${px}px`;
  } catch (e) {
    console.warn("[palette] getUIFontSize failed", e);
  }
}

// Capture the mail context of the window the palette was opened from.
// `currentWindow` scopes the query to the window hosting the action popup —
// without it, `active: true` matches the active mail tab of EVERY window.
async function captureContext() {
  try {
    const [activeTab] = await Timing.time("context: tabs.query",
      messenger.tabs.query({ active: true, currentWindow: true }));
    const windowId = activeTab?.windowId ?? null;
    const [mailTab] = await Timing.time("context: mailTabs.query",
      messenger.mailTabs.query({ active: true, currentWindow: true }));

    let selectedMessages = [];
    if (mailTab) {
      try {
        selectedMessages = await Timing.time("context: selected messages", async () =>
          collectMessages(await messenger.mailTabs.getSelectedMessages(mailTab.id)));
      } catch (e) {
        console.warn("[palette] getSelectedMessages failed", e);
      }
    } else if (activeTab) {
      // Message tab or standalone message window: use the displayed message.
      try {
        selectedMessages = await Timing.time("context: displayed messages", async () =>
          collectMessages(await messenger.messageDisplay.getDisplayedMessages(activeTab.id)));
      } catch {
        // Not a message-displaying tab (compose, content tab, …).
      }
    }
    let composeTab = null;
    let composeDetails = null;
    if (activeTab?.type === "messageCompose") {
      composeTab = activeTab;
      try {
        composeDetails = await Timing.time("context: compose details",
          messenger.compose.getComposeDetails(activeTab.id));
      } catch (e) {
        console.warn("[palette] getComposeDetails failed", e);
      }
    }
    ctx = { mailTab: mailTab || null, windowId, selectedMessages, composeTab, composeDetails };
    Timing.set("selectedMessages", selectedMessages.length);
  } catch (e) {
    console.warn("[palette] captureContext failed", e);
  }
}

function firstSelectedId() {
  return ctx.selectedMessages[0]?.id ?? null;
}

async function executeAndClose(cmd) {
  let success = false;
  try {
    await cmd.run();
    success = true;
  } catch (e) {
    console.error("Action failed:", e);
  } finally {
    // Destructive commands are never recorded, so they can't float to the
    // top of the empty-query list and be fired by a reflexive Enter.
    // `noHistory` items (open tabs, search results) are ephemeral and would
    // only push useful entries out of the capped MRU list.
    if (success && !cmd.destructive && !cmd.noHistory) {
      // Persist MRU before closing — popup teardown can race with pending
      // storage writes if not awaited.
      if (picker && !picker.parent.noHistory) await recordUsage(picker.parent.id);
      await recordUsage(cmd.id || cmd.label);
    }
    window.close();
  }
}

function updateSelected(props) {
  return Promise.all(ctx.selectedMessages.map(m => messenger.messages.update(m.id, props)));
}

// Desktop notification confirming an action whose result isn't visible where
// the user is looking (e.g. messages moved away). Never throws: a failed
// notification must not turn a successful action into a logged failure.
async function notify(message) {
  if (typeof messenger.notifications?.create !== "function") return;
  try {
    await messenger.notifications.create({ type: "basic", title: "Command Palette", message });
  } catch (e) {
    console.warn("[palette] notification failed", e);
  }
}

// Mailbox-format address for compose fields: "Name" <email>. The name is
// always quoted so commas and other specials in it are safe.
function mailbox(name, email) {
  if (!name) return email;
  return `"${name.replace(/["\\]/g, "\\$&")}" <${email}>`;
}

// Flat list of navigable folders across all accounts, built once in init().
// Shared by "Go to:" commands and the Move/Copy destination pickers.
let folderEntries = [];

function collectFolders(accounts) {
  const out = [];

  function walk(folder, accountName, parentPath) {
    // Skip the account root — it's not navigable in the 3-pane and the API
    // marks it explicitly with isRoot. (Older builds may not set isRoot;
    // fall back to a path === "/" check.)
    const isRoot = folder.isRoot === true || folder.path === "/" || folder.path === "";
    // Unified folders are covered by buildUnifiedCommands(); skip them here in
    // case a Thunderbird version includes them in an account tree.
    if (!isRoot && !folder.isUnified) {
      out.push({
        folder,
        displayName: folder.name,
        breadcrumb: parentPath ? `${accountName} · ${parentPath}` : accountName,
        icon: specialIcon(folder.specialUse),
        // Match against account + path + special-use tags.
        keywords: `${accountName} ${folder.path || ""} ${(folder.specialUse || []).join(" ")}`
      });
    }
    const childParentPath = isRoot
      ? ""
      : (parentPath ? `${parentPath}/${folder.name}` : folder.name);
    for (const sub of folder.subFolders || []) walk(sub, accountName, childParentPath);
  }

  for (const a of accounts) {
    if (a.rootFolder) walk(a.rootFolder, a.name, "");
  }
  return out;
}

function selectionText() {
  const n = ctx.selectedMessages.length;
  return n === 1 ? "1 message" : `${n} messages`;
}

// Destination items for the Move/Copy pickers. `transfer(ids, entry)` gets the
// folder entry (entry.folder.id, entry.displayName). Virtual (saved search),
// unified and tag folders can't hold real messages, so they're excluded.
// For moves, the folder all selected messages already live in is excluded too.
function destinationItems(verb, transfer, { excludeSource }) {
  const sources = new Set(ctx.selectedMessages.map(m => m.folder?.id).filter(Boolean));
  const soleSource = excludeSource && sources.size === 1 ? [...sources][0] : null;
  return folderEntries
    .filter(e => !e.folder.isVirtual && !e.folder.isUnified && !e.folder.isTag)
    .filter(e => e.folder.id !== soleSource)
    .map(e => ({
      id: `${verb}-to:${e.folder.id}`,
      label: e.displayName,
      hint: e.breadcrumb,
      icon: e.icon,
      keywords: e.keywords,
      run: () => transfer(ctx.selectedMessages.map(m => m.id), e)
    }));
}

function specialIcon(specialUse) {
  if (!specialUse || specialUse.length === 0) return "▸";
  if (specialUse.includes("inbox")) return "📥";
  if (specialUse.includes("sent")) return "📤";
  if (specialUse.includes("drafts")) return "✎";
  if (specialUse.includes("trash")) return "🗑";
  if (specialUse.includes("junk")) return "⚠";
  if (specialUse.includes("archives")) return "▣";
  if (specialUse.includes("templates")) return "▤";
  if (specialUse.includes("outbox")) return "📤";
  return "▸";
}

// `retryProps` are extra MailTabProperties to retry with if the plain
// update is rejected, e.g. { folderMode: "unified" } for unified folders
// when the folder pane isn't showing the unified view.
async function switchToFolder(folder, { retryProps } = {}) {
  if (!folder.id) throw new Error("Folder has no id");
  // MV3 validates MailTabProperties strictly; pass only known keys
  // (displayedFolderId, folderMode, …). Folder IDs are opaque strings.
  const updateProps = { displayedFolderId: folder.id };

  // Prefer the window the palette was opened from; fall back to any normal
  // (3-pane) window if it was opened from e.g. a compose window.
  const normalWindows = await messenger.windows.getAll({ windowTypes: ["normal"] });
  if (normalWindows.length === 0) throw new Error("No normal Thunderbird window is open");
  const targetWindow =
    normalWindows.find(w => w.id === ctx.windowId) ||
    normalWindows.find(w => w.focused) ||
    normalWindows[0];

  const mailTabs = await messenger.mailTabs.query({ windowId: targetWindow.id });
  const mailTab =
    (ctx.mailTab && mailTabs.find(t => t.id === ctx.mailTab.id)) ||
    mailTabs.find(t => t.active) ||
    mailTabs[0] ||
    null;

  if (!mailTab) {
    await messenger.mailTabs.create({ ...updateProps, windowId: targetWindow.id });
    return;
  }

  // Activate the tab first: some TB versions reject mailTabs.update on a
  // mail tab that isn't the active tab in its window.
  try {
    await messenger.tabs.update(mailTab.id, { active: true });
  } catch (e) {
    console.warn("[palette] tabs.update active failed", e);
  }

  try {
    await messenger.mailTabs.update(mailTab.id, updateProps);
    return;
  } catch (e) {
    if (!retryProps) {
      console.warn("[palette] mailTabs.update failed, opening new mail tab", e);
      await messenger.mailTabs.create({ ...updateProps, windowId: mailTab.windowId });
      return;
    }
    console.warn("[palette] mailTabs.update failed, retrying with", retryProps, e);
  }

  try {
    await messenger.mailTabs.update(mailTab.id, { ...updateProps, ...retryProps });
  } catch (e) {
    // Last resort: open the folder in a new mail tab in the same window.
    console.warn("[palette] mailTabs.update failed, opening new mail tab", e);
    await messenger.mailTabs.create({ ...updateProps, windowId: mailTab.windowId });
  }
}

// Discount for matches that only hit a hidden keyword or the hint.
const KEYWORD_WEIGHT = 0.9;

// Query prefixes (root list only), VSCode-style:
//   >text  commands only (no folders or tags)
//   @text  folders only        (cmd.kind === "folder")
//   #text  tags only           (cmd.kind === "tag")
//   ?text  search messages     (see registerMessageSearch)
const PREFIX_MODES = { ">": "commands", "@": "folders", "#": "tags", "?": "search" };

function parseQuery(raw) {
  const mode = !picker && raw ? PREFIX_MODES[raw[0]] : undefined;
  return mode ? { mode, text: raw.slice(1).trim() } : { mode: null, text: raw };
}

function matchesMode(cmd, mode) {
  if (mode === "commands") return !cmd.kind;
  if (mode === "folders") return cmd.kind === "folder";
  if (mode === "tags") return cmd.kind === "tag";
  return true;
}

// Whether a command's `requires` gate is satisfied by the captured context.
function isAvailable(cmd) {
  if (cmd.requires === "message") return ctx.selectedMessages.length > 0;
  if (cmd.requires === "mailTab") return !!ctx.mailTab;
  if (cmd.requires === "compose") return !!ctx.composeTab;
  return true;
}

function filterCommands(query, mode = null) {
  const isEmpty = !query;
  const scored = [];

  for (const cmd of (picker ? picker.items : commands)) {
    if (!isAvailable(cmd)) continue;
    if (!matchesMode(cmd, mode)) continue;
    const cmdId = cmd.id || cmd.label;

    if (isEmpty) {
      // No query: sort by MRU rank first, then by default order (Array.sort
      // is stable, so equal scores keep insertion order).
      const rank = cmd.destructive ? undefined : mruRank.get(cmdId);
      const score = rank !== undefined ? 1000 - rank : 0;
      scored.push({ cmd, score, positions: [] });
      continue;
    }

    // Score against label first; if extra keywords exist, score those too and
    // take the max. Positions for highlight are only taken from the label
    // score so highlighting stays visually aligned with what the user sees.
    const labelResult = Fuzzy.score(query, cmd.label);
    let bestScore = labelResult.score;
    let positions = labelResult.positions;

    if (cmd.nameStart) {
      const nameResult = Fuzzy.score(query, cmd.label.slice(cmd.nameStart));
      if (nameResult.score > bestScore) {
        bestScore = nameResult.score;
        positions = nameResult.positions.map(p => p + cmd.nameStart);
      }
    }

    // Whole-word prefix hits in the label ("delete" → "Delete (Move to
    // Trash)") are scored as if the word stood alone, so long labels aren't
    // penalised for their length when the user typed one of their words.
    const lowerQuery = query.toLowerCase();
    for (const m of cmd.label.toLowerCase().matchAll(/[^\s:()·/]+/g)) {
      if (!m[0].startsWith(lowerQuery)) continue;
      const wordScore = Fuzzy.score(query, m[0]).score;
      if (wordScore > bestScore) {
        bestScore = wordScore;
        positions = Array.from({ length: lowerQuery.length }, (_, k) => m.index + k);
      }
    }

    const hintAndKeywords = [cmd.hint, cmd.keywords].filter(Boolean).join(" ");
    if (hintAndKeywords) {
      const altResult = Fuzzy.score(query, `${cmd.label} ${hintAndKeywords}`);
      if (altResult.score > bestScore) {
        bestScore = altResult.score;
        // Keep only the positions that fall within the visible label.
        positions = altResult.positions.filter(p => p < cmd.label.length);
      }

      // Whole-word hits on a hint/keyword ("preview" → "preview" keyword)
      // would otherwise be drowned by the length penalty on the combined
      // string above, losing to scattered letter matches in other commands.
      // Score the word on its own, discounted so label matches win ties.
      for (const word of hintAndKeywords.toLowerCase().split(/\s+/)) {
        if (!word.startsWith(lowerQuery)) continue;
        const wordScore = Fuzzy.score(query, word).score * KEYWORD_WEIGHT;
        if (wordScore > bestScore) {
          bestScore = wordScore;
          positions = []; // the match isn't in the visible label
        }
      }
    }

    if (bestScore > 0) {
      // MRU is a small tie-breaker only — never lets a stale match win over
      // a clearly-better fuzzy match.
      const boost = cmd.destructive ? 0 : mruBoost(cmdId);
      scored.push({ cmd, score: bestScore + boost, positions });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 200);
}

let rowEls = [];

// Rebuild the whole list. Only called when the filtered set changes.
function render() {
  resultsEl.innerHTML = "";
  rowEls = [];
  emptyEl.hidden = filtered.length > 0;

  filtered.forEach((entry, i) => {
    const li = document.createElement("li");
    li.id = `opt-${i}`;
    li.setAttribute("role", "option");

    const icon = document.createElement("span");
    icon.className = "row-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = entry.cmd.icon || "•";
    if (entry.cmd.iconColor) icon.style.color = entry.cmd.iconColor;

    const label = document.createElement("span");
    label.className = "row-label";

    li.appendChild(icon);
    li.appendChild(label);

    if (entry.cmd.hint) {
      const hint = document.createElement("span");
      hint.className = "row-hint";
      hint.textContent = entry.cmd.hint;
      li.appendChild(hint);
    }

    // Small pill on the far right, e.g. unread count. May be a getter that
    // fills in later (counts load after the first render).
    if (entry.cmd.badge) {
      const badge = document.createElement("span");
      badge.className = "row-badge";
      badge.textContent = entry.cmd.badge;
      li.appendChild(badge);
    }

    // mousemove (not mouseenter) so rows scrolling under a stationary
    // pointer during keyboard navigation don't steal the selection.
    li.addEventListener("mousemove", () => {
      if (selectedIndex !== i) select(i, { scroll: false });
    });
    li.addEventListener("click", () => {
      if (selectedIndex !== i) select(i, { scroll: false });
      execSelected();
    });

    rowEls.push(li);
    paintRow(i);
    resultsEl.appendChild(li);
  });

  updateActiveDescendant();
  scrollSelectedIntoView();
}

// Refresh one row's selection/armed state and label.
function paintRow(i) {
  const li = rowEls[i];
  const entry = filtered[i];
  if (!li || !entry) return;
  const selected = i === selectedIndex;
  const armed = entry.cmd === armedCmd;
  li.classList.toggle("selected", selected);
  li.classList.toggle("confirm", armed);
  li.setAttribute("aria-selected", String(selected));
  const label = li.querySelector(".row-label");
  if (armed) {
    label.textContent = `Press Enter again to confirm: ${entry.cmd.label}`;
  } else {
    label.innerHTML = Fuzzy.highlight(entry.cmd.label, entry.positions);
  }
}

function select(i, { scroll = true } = {}) {
  const prev = selectedIndex;
  selectedIndex = i;
  disarm();
  paintRow(prev);
  paintRow(i);
  updateActiveDescendant();
  if (scroll) scrollSelectedIntoView();
}

function updateActiveDescendant() {
  if (rowEls[selectedIndex]) {
    queryEl.setAttribute("aria-activedescendant", rowEls[selectedIndex].id);
  } else {
    queryEl.removeAttribute("aria-activedescendant");
  }
}

function scrollSelectedIntoView() {
  const el = rowEls[selectedIndex];
  if (el) el.scrollIntoView({ block: "nearest" });
}

// Destructive commands need two activations in a row (Enter/click twice).
// Any selection or query change disarms.
let armedCmd = null;

function disarm() {
  if (!armedCmd) return;
  const i = filtered.findIndex(e => e.cmd === armedCmd);
  armedCmd = null;
  if (i !== -1) paintRow(i);
}

// Picker mode: a command with `picker` swaps the list for a sub-list (e.g.
// Move to Folder… → destination folders) instead of running. Esc or
// Backspace on an empty query returns to the root list.
//
// `cmd.picker()` returns { title, items, placeholder?, empty? } or a Promise of
// it (contacts, tags, tabs…). Sync pickers open immediately; async ones show
// a "Loading…" state first. A late result is dropped if the picker was closed
// or replaced in the meantime.
let picker = null; // { title, empty, placeholder, items, parent }
let pickerToken = 0;
const ROOT_PLACEHOLDER = queryEl.placeholder;
const ROOT_EMPTY = emptyEl.textContent;

function showPicker(spec, cmd) {
  picker = { ...spec, parent: cmd };
  modeEl.textContent = picker.title;
  modeEl.hidden = false;
  queryEl.placeholder = picker.placeholder || "Type to filter…";
  queryEl.value = "";
  refilter();
}

function openPicker(cmd) {
  const token = ++pickerToken;
  let result;
  try {
    result = cmd.picker();
  } catch (e) {
    console.error("[palette] picker failed", e);
    result = { title: cmd.label, empty: "Couldn't load items.", items: [] };
  }
  if (typeof result?.then !== "function") {
    showPicker(result, cmd);
    return;
  }
  showPicker({ title: cmd.label, empty: "Loading…", items: [] }, cmd);
  result
    .catch((e) => {
      console.error("[palette] picker failed", e);
      return { title: cmd.label, empty: "Couldn't load items.", items: [] };
    })
    .then((spec) => {
      if (token === pickerToken && picker?.parent === cmd) showPicker(spec, cmd);
    });
}

function closePicker() {
  pickerToken++;
  picker = null;
  modeEl.hidden = true;
  queryEl.placeholder = ROOT_PLACEHOLDER;
  queryEl.value = "";
  refilter();
}

function execSelected() {
  const entry = filtered[selectedIndex];
  if (!entry) return;
  if (entry.cmd.picker) {
    openPicker(entry.cmd);
    return;
  }
  if (entry.cmd.destructive && armedCmd !== entry.cmd) {
    armedCmd = entry.cmd;
    paintRow(selectedIndex);
    return;
  }
  executeAndClose(entry.cmd);
}

// Message search (the "?" prefix) is provided by popup/commands/search.js via
// registerMessageSearch(fn); fn(text) resolves to an array of commands.
// Searches are debounced, and a result is dropped if the query moved on.
let messageSearch = null;
let searchTimer = null;
let searchSeq = 0;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;

function registerMessageSearch(fn) {
  messageSearch = fn;
}

function setEmptyText(text) {
  emptyEl.textContent = text;
}

function startSearch(text) {
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  filtered = [];
  if (!messageSearch) {
    setEmptyText("Message search is unavailable.");
  } else if (text.length < SEARCH_MIN_CHARS) {
    setEmptyText("Search messages: type a subject or sender…");
  } else {
    setEmptyText("Searching…");
    searchTimer = setTimeout(async () => {
      let results = [];
      try {
        results = await messageSearch(text);
      } catch (e) {
        console.error("[palette] message search failed", e);
      }
      if (seq !== searchSeq) return; // query changed meanwhile
      filtered = results.map(cmd => ({ cmd, score: 0, positions: [] }));
      selectedIndex = 0;
      setEmptyText("No matching messages.");
      render();
    }, SEARCH_DEBOUNCE_MS);
  }
}

function refilter() {
  const { mode, text } = parseQuery(queryEl.value.trim());
  selectedIndex = 0;
  armedCmd = null;
  if (mode === "search") {
    startSearch(text);
  } else {
    searchSeq++; // cancel any in-flight search
    clearTimeout(searchTimer);
    setEmptyText(picker ? (picker.empty || "No matches.") : ROOT_EMPTY);
    filtered = filterCommands(text, mode);
  }
  render();
}

queryEl.addEventListener("input", refilter);

queryEl.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (filtered.length > 0) {
      select((selectedIndex + 1) % filtered.length);
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (filtered.length > 0) {
      select((selectedIndex - 1 + filtered.length) % filtered.length);
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    execSelected();
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (picker) closePicker();
    else window.close();
  } else if (e.key === "Backspace" && picker && queryEl.value === "") {
    e.preventDefault();
    closePicker();
  }
});

// Action popups native-close on outside click; no manual blur handler needed.

// ---- Command registry -------------------------------------------------------
//
// Command files in popup/commands/ call registerCommands(source) at load time.
// `source({ accounts })` returns (or resolves to) an array of commands. Sources
// run in registration order (= <script> order in palette.html), which is also
// the tie-break order for equal match scores. A failing source is logged and
// skipped so one broken group can't empty the palette.
const commandSources = [];

function registerCommands(source) {
  // Name the source after the registering script (for startup timings):
  // "folders.js#2" = the second source registered by commands/folders.js.
  const file = (document.currentScript?.src || "").split("/").pop() || "source";
  const n = commandSources.filter(s => s.file === file).length + 1;
  commandSources.push({ source, file, name: `${file}#${n}` });
}

async function buildCommands(env) {
  const lists = await Promise.all(commandSources.map(async ({ source, name }) => {
    try {
      return (await Timing.time(`source: ${name}`, () => source(env))) || [];
    } catch (e) {
      console.warn("[palette] command source failed", name, e);
      return [];
    }
  }));
  return lists.flat();
}

// ---- Shortcut-launched commands ---------------------------------------------
//
// background.js opens the popup for per-action shortcuts (manifest
// `commands`) and holds the requested action until the popup asks for it.
async function takePendingCommand() {
  if (typeof messenger.runtime?.sendMessage !== "function") return null;
  try {
    return (await messenger.runtime.sendMessage({ type: "palette:takePending" })) || null;
  } catch {
    return null; // no background listener (e.g. opened normally)
  }
}

// `pending` is a query prefix ("@", "?") to prefill, "repeat-last" to run the
// most recent MRU command that's available here;
// anything else is a command id to run (or open, for pickers). Destructive
// commands are skipped for repeat: a shortcut must never fire them unseen.
function runPendingCommand(pending) {
  // A bare prefix ("@", "?") opens the palette in that mode.
  if (PREFIX_MODES[pending]) {
    queryEl.value = pending;
    refilter();
    return true;
  }
  const available = filterCommands("", null); // MRU-ordered, gates applied
  let index = -1;
  if (pending === "repeat-last") {
    index = available.findIndex(e => mruRank.has(e.cmd.id || e.cmd.label) && !e.cmd.destructive);
  } else {
    index = available.findIndex(e => e.cmd.id === pending);
  }
  if (index === -1) return false;
  filtered = available;
  selectedIndex = index;
  render();
  execSelected();
  return true;
}

// Called from popup/main.js once every command file has registered.
async function init() {
  Timing.mark("init start");
  const [, accounts, , , pending] = await Timing.time("init: parallel setup", Promise.all([
    Timing.time("setup: mru + debug settings", loadMru()),
    Timing.time("setup: accounts.list(true)", messenger.accounts.list(true)),
    Timing.time("setup: captureContext", captureContext()),
    Timing.time("setup: UI font size", applyUIFontSize()), // before first render, so the popup doesn't jump
    Timing.time("setup: takePendingCommand", takePendingCommand())
  ]));
  folderEntries = Timing.timeSync("collectFolders", () => collectFolders(accounts));
  Timing.set("accounts", accounts.length);
  Timing.set("folders", folderEntries.length);
  commands = await Timing.time("buildCommands (all sources)", buildCommands({ accounts }));
  Timing.set("commands", commands.length);
  Timing.timeSync("first refilter + render", () => refilter());
  Timing.set("rowsRendered", filtered.length);
  queryEl.focus();
  if (pending) runPendingCommand(pending);
  await Timing.time("wait for first paint", afterNextPaint());
  Timing.mark("firstPaint");
  await Timing.reportFirstPaint();
}
