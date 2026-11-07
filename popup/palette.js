// Command Palette popup logic.
//
// Runs as the `action` popup (opened by the `_execute_action` shortcut).
//
// Lifecycle:
//   1. On load: capture the mail context of the window hosting the popup
//      (active mail tab + selected or displayed messages), load MRU history.
//   2. Build the command list: static actions + a "Go to folder" entry per folder
//      across all accounts + per-account "Get New Mail" entries (when the
//      Experiment API is available).
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
let ctx = { mailTab: null, selectedMessages: [] };

// MRU (most-recently-used) state. Persisted in storage.local as an ordered
// array of command ids — index 0 is most recent. Capped at MRU_CAP entries.
const MRU_CAP = 50;
let mruList = [];
let mruRank = new Map(); // id -> position (0 = most recent)

async function loadMru() {
  try {
    const r = await messenger.storage.local.get(["mru"]);
    mruList = Array.isArray(r.mru) ? r.mru : [];
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
    out.push(...page.messages);
  }
  return out;
}

// Capture the mail context of the window the palette was opened from.
// `currentWindow` scopes the query to the window hosting the action popup —
// without it, `active: true` matches the active mail tab of EVERY window.
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

async function captureContext() {
  try {
    const [activeTab] = await messenger.tabs.query({ active: true, currentWindow: true });
    const windowId = activeTab?.windowId ?? null;
    const [mailTab] = await messenger.mailTabs.query({ active: true, currentWindow: true });

    let selectedMessages = [];
    if (mailTab) {
      try {
        selectedMessages = await collectMessages(
          await messenger.mailTabs.getSelectedMessages(mailTab.id)
        );
      } catch (e) {
        console.warn("[palette] getSelectedMessages failed", e);
      }
    } else if (activeTab) {
      // Message tab or standalone message window: use the displayed message.
      try {
        selectedMessages = await collectMessages(
          await messenger.messageDisplay.getDisplayedMessages(activeTab.id)
        );
      } catch {
        // Not a message-displaying tab (compose, content tab, …).
      }
    }
    ctx = { mailTab: mailTab || null, windowId, selectedMessages };
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
    if (success && !cmd.destructive) {
      // Persist MRU before closing — popup teardown can race with pending
      // storage writes if not awaited.
      if (picker) await recordUsage(picker.parent.id);
      await recordUsage(cmd.id || cmd.label);
    }
    window.close();
  }
}

function updateSelected(props) {
  return Promise.all(ctx.selectedMessages.map(m => messenger.messages.update(m.id, props)));
}

const STATIC_ACTIONS = [
  {
    id: "compose-new",
    label: "Compose: New Message",
    hint: "Ctrl+N",
    icon: "✎",
    run: () => messenger.compose.beginNew()
  },
  {
    id: "reply",
    label: "Reply",
    icon: "↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToSender")
  },
  {
    id: "reply-all",
    label: "Reply All",
    icon: "↩↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToAll")
  },
  {
    id: "reply-list",
    label: "Reply to List",
    icon: "↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToList")
  },
  {
    id: "forward-inline",
    label: "Forward (Inline)",
    icon: "→",
    requires: "message",
    run: () => messenger.compose.beginForward(firstSelectedId(), "forwardInline")
  },
  {
    id: "forward-attach",
    label: "Forward as Attachment",
    icon: "→",
    requires: "message",
    run: () => messenger.compose.beginForward(firstSelectedId(), "forwardAsAttachment")
  },
  {
    id: "mark-read",
    label: "Mark as Read",
    icon: "●",
    requires: "message",
    run: () => updateSelected({ read: true })
  },
  {
    id: "mark-unread",
    label: "Mark as Unread",
    icon: "○",
    requires: "message",
    run: () => updateSelected({ read: false })
  },
  {
    id: "toggle-flag",
    label: "Toggle Star / Flag",
    icon: "★",
    requires: "message",
    // Mixed selection: flag all if any are unflagged, else unflag all
    // (per-message flipping would leave a mixed selection still mixed).
    run: () => updateSelected({ flagged: ctx.selectedMessages.some(m => !m.flagged) })
  },
  {
    id: "archive",
    label: "Archive",
    icon: "▣",
    requires: "message",
    run: () => messenger.messages.archive(ctx.selectedMessages.map(m => m.id))
  },
  {
    id: "move-to",
    label: "Move to Folder…",
    icon: "⇥",
    keywords: "file",
    requires: "message",
    picker: () => ({
      title: `Move ${selectionText()} to…`,
      empty: "No matching folders.",
      items: destinationItems("move", (ids, f) => messenger.messages.move(ids, f), { excludeSource: true })
    })
  },
  {
    id: "copy-to",
    label: "Copy to Folder…",
    icon: "⧉",
    keywords: "duplicate",
    requires: "message",
    picker: () => ({
      title: `Copy ${selectionText()} to…`,
      empty: "No matching folders.",
      items: destinationItems("copy", (ids, f) => messenger.messages.copy(ids, f), { excludeSource: false })
    })
  },
  {
    id: "delete",
    label: "Delete (Move to Trash)",
    icon: "✕",
    requires: "message",
    destructive: true,
    run: () => messenger.messages.delete(ctx.selectedMessages.map(m => m.id))
  },
  {
    id: "empty-trash-all",
    label: "Empty Trash (All Accounts)",
    hint: "permanent",
    icon: "✕",
    destructive: true,
    run: emptyTrashAllAccounts
  },
  {
    id: "open-address-book",
    label: "Open Address Book",
    icon: "☰",
    run: () => messenger.addressBooks.openUI()
  },
  {
    id: "toggle-folder-pane",
    // Label reflects the current state (captured when the palette opened).
    get label() {
      return ctx.mailTab?.folderPaneVisible === false ? "Show Folder Pane" : "Hide Folder Pane";
    },
    icon: "◧",
    keywords: "toggle folder pane sidebar layout view",
    requires: "mailTab",
    run: () => messenger.mailTabs.update(ctx.mailTab.id, {
      folderPaneVisible: ctx.mailTab.folderPaneVisible === false
    })
  }
];

async function emptyTrashAllAccounts() {
  const accounts = await messenger.accounts.list(false);
  for (const a of accounts) {
    const [trash] = await messenger.folders.query({ accountId: a.id, specialUse: ["trash"] });
    if (!trash) continue;
    let page = await messenger.messages.list(trash.id);
    while (true) {
      if (page.messages.length === 0) break;
      const ids = page.messages.map(m => m.id);
      await messenger.messages.delete(ids, { deletePermanently: true });
      if (!page.id) break;
      page = await messenger.messages.continueList(page.id);
    }
  }
}

function buildExperimentCommands(accounts) {
  if (!HAS_EXPERIMENT) return [];
  const out = [];

  out.push({
    id: "getnewmail:all",
    label: "Get New Mail (All Accounts)",
    icon: "⟳",
    run: () => messenger.palette.getNewMail()
  });

  for (const a of accounts) {
    // Local Folders ("none") has no incoming server to fetch from.
    if (a.type === "none") continue;
    out.push({
      id: `getnewmail:${a.id}`,
      label: `Get New Mail: ${a.name}`,
      icon: "⟳",
      keywords: a.id,
      run: () => messenger.palette.getNewMail(a.id)
    });
  }

  out.push({
    id: "open-settings",
    label: "Open Thunderbird Settings",
    icon: "⚙",
    run: () => messenger.palette.openSettings()
  });

  out.push({
    id: "open-account-settings",
    label: "Open Account Settings",
    icon: "⚙",
    run: () => messenger.palette.openAccountSettings()
  });

  return out;
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

function buildFolderCommands(entries) {
  return entries.map(e => ({
    id: `goto-folder:${e.folder.id}`,
    label: `Go to: ${e.displayName}`,
    // Index where the folder name starts in `label`. The name is scored on
    // its own too, so typing "inbox" gets the prefix bonus on "Inbox".
    nameStart: "Go to: ".length,
    hint: e.breadcrumb,
    icon: e.icon,
    keywords: e.keywords,
    run: () => switchToFolder(e.folder)
  }));
}

// "Go to: Unified <folder>" commands. folders.getUnifiedFolder (TB 127+)
// returns the cross-account aggregate for a special-use type; these have no
// accountId and aren't part of any account's folder tree. Types are the ones
// getUnifiedFolder documents, in the order they're listed in the palette.
const UNIFIED_TYPES = [
  { type: "inbox", name: "Inbox", keywords: "all inboxes combined" },
  { type: "drafts", name: "Drafts", keywords: "" },
  { type: "sent", name: "Sent", keywords: "outgoing" },
  { type: "archives", name: "Archives", keywords: "archive" },
  { type: "templates", name: "Templates", keywords: "" },
  { type: "junk", name: "Junk", keywords: "spam" },
  { type: "trash", name: "Trash", keywords: "deleted bin" }
];

async function buildUnifiedCommands() {
  if (typeof messenger.folders?.getUnifiedFolder !== "function") return [];
  const results = await Promise.all(UNIFIED_TYPES.map(async (u) => {
    try {
      return { ...u, folder: await messenger.folders.getUnifiedFolder(u.type) };
    } catch (e) {
      // One unavailable type shouldn't hide the others.
      console.warn(`[palette] getUnifiedFolder(${u.type}) failed`, e);
      return { ...u, folder: null };
    }
  }));
  return results
    .filter(r => r.folder)
    .map(({ type, name, keywords, folder }) => ({
      // Stable id for MRU: unified folder ids are only valid per-session.
      id: `goto-unified-${type}`,
      label: `Go to: Unified ${name}`,
      nameStart: "Go to: ".length,
      hint: "All accounts",
      icon: specialIcon([type]),
      keywords: `unified all accounts smart ${type} ${keywords}`,
      run: () => switchToFolder(folder, { retryProps: { folderMode: "unified" } })
    }));
}

function selectionText() {
  const n = ctx.selectedMessages.length;
  return n === 1 ? "1 message" : `${n} messages`;
}

// Destination items for the Move/Copy pickers. Virtual (saved search),
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
      run: () => transfer(ctx.selectedMessages.map(m => m.id), e.folder.id)
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

function filterCommands(query) {
  const haveMessage = ctx.selectedMessages.length > 0;
  const isEmpty = !query;
  const scored = [];

  for (const cmd of (picker ? picker.items : commands)) {
    if (cmd.requires === "message" && !haveMessage) continue;
    if (cmd.requires === "mailTab" && !ctx.mailTab) continue;
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

    const hintAndKeywords = [cmd.hint, cmd.keywords].filter(Boolean).join(" ");
    if (hintAndKeywords) {
      const altResult = Fuzzy.score(query, `${cmd.label} ${hintAndKeywords}`);
      if (altResult.score > bestScore) {
        bestScore = altResult.score;
        // Keep only the positions that fall within the visible label.
        positions = altResult.positions.filter(p => p < cmd.label.length);
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
let picker = null; // { title, empty, items, parent }
const ROOT_PLACEHOLDER = queryEl.placeholder;
const ROOT_EMPTY = emptyEl.textContent;

function openPicker(cmd) {
  picker = { ...cmd.picker(), parent: cmd };
  modeEl.textContent = picker.title;
  modeEl.hidden = false;
  queryEl.placeholder = "Type a folder name…";
  emptyEl.textContent = picker.empty || ROOT_EMPTY;
  queryEl.value = "";
  refilter();
}

function closePicker() {
  picker = null;
  modeEl.hidden = true;
  queryEl.placeholder = ROOT_PLACEHOLDER;
  emptyEl.textContent = ROOT_EMPTY;
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

function refilter() {
  filtered = filterCommands(queryEl.value.trim());
  selectedIndex = 0;
  armedCmd = null;
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

async function init() {
  // Load MRU and accounts in parallel — neither depends on the other.
  const [, accounts, , , unifiedCommands] = await Promise.all([
    loadMru(),
    messenger.accounts.list(true),
    captureContext(),
    applyUIFontSize(), // before first render, so the popup doesn't jump in size
    buildUnifiedCommands()
  ]);
  folderEntries = collectFolders(accounts);
  const folderCommands = buildFolderCommands(folderEntries);
  const experimentCommands = buildExperimentCommands(accounts);
  commands = [...STATIC_ACTIONS, ...experimentCommands, ...unifiedCommands, ...folderCommands];
  refilter();
  queryEl.focus();
}

init();
