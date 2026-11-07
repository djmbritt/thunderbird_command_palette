# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A VSCode-style command palette extension for Thunderbird. Press `Ctrl+Shift+P` / `Cmd+Shift+P` to open a popup that fuzzy-searches actions (compose, reply, archive, switch folder, etc.) and runs the selected one.

## Stack

- **Thunderbird MailExtension**, **Manifest V3**, **`messenger.*` namespace** (canonical alias for `browser.*` in Thunderbird).
- `strict_min_version: "128.0"` — first ESR with stable MV3 support.
- No build step. No bundler. Pure HTML/CSS/JS. CSP forbids remote scripts and inline handlers, so anything external must be vendored under `lib/`.
- Type-checked with TypeScript (`checkJs`, `noEmit`) via JSDoc annotations; TypeScript is a dev-only dependency and nothing is compiled. See **Type checking**.

## Architecture

The palette is an **`action` popup** (toolbar-button dropdown). The main shortcut is bound to the reserved `_execute_action` command in `manifest.json`, so Thunderbird opens the popup itself. `background.js` only handles the optional per-action shortcuts (see **Per-action shortcuts**). Action popups close natively on outside click, so there is no blur handler. The popup is fixed at 600×400 in `palette.css` so it doesn't resize as the result list changes.

> History: earlier versions (≤0.3) opened `popup/palette.html` via `windows.create({type: "popup"})` from `background.js`, with parent-clamped positioning. That was replaced by the action popup.

Flow:
1. User presses the shortcut → Thunderbird opens `popup/palette.html` as the action popup.
2. `palette.html` loads `lib/*.js`, then the core `popup/palette.js`, then each `popup/commands/*.js` file (each calls `registerCommands`), then `popup/main.js`, which calls `init()`.
3. `init()` (in parallel) loads MRU history, lists accounts with folders, captures context, applies the UI font size, and asks the background for a pending shortcut action. It builds the commands from the **immediate** sources, renders the first rows, and waits for the first paint. Only then does it run the **deferred** sources (unified folders, tags). See **Startup order**.
4. Each keystroke re-scores commands via `lib/fuzzy.js` (or runs a message search for `?`).
5. Enter / click → run the action, then `window.close()`. Esc → close without running.

### Command registry

Command groups live in `popup/commands/*.js` and call `registerCommands(source, { deferred? })` at load time. `source({ accounts })` returns, or resolves to, an array of commands. Sources run in registration order, which is the `<script>` order in `palette.html` and also the tie-break order for equal scores (compose → messages → tags → view → thunderbird → navigation → folders). A source that throws is logged and skipped. Mark a source `{ deferred: true }` if it needs slow API round trips and isn't required for the first screen. Its commands are merged in at its registration position after the first paint.

### Startup order

Measured startup (see **Measuring startup**): first paint went from ~400 ms to ~140 ms typical. Most of the original time was spent *after* our code finished, waiting for Thunderbird to show the panel. The biggest single cause was the root font size changing after load (CSS default 15 px → the user's 14 px), which resized the rem-sized popup after Thunderbird had measured it (fixed by `early.js`, see **Styling**). Our own work is ~30–60 ms per open. `init()` is ordered for time-to-visible:
1. Parallel setup calls (MRU, accounts, context, font size, pending shortcut).
2. Immediate sources → filter → `render({ firstChunk: true })` builds only the first `FIRST_CHUNK_ROWS` (30) rows. The rest are appended right after the paint, and a newer render cancels that append (`renderToken`). `select()` calls `ensureRendered()` so arrowing past the first chunk works.
3. Wait for the first paint (`afterNextPaint`: rAF, then a timeout).
4. Deferred sources → `applyDeferredCommands`, which keeps the query, keeps a row the user explicitly chose (`selectionTouched`), and otherwise re-selects the new top.

**Unread counts were removed** (they used one `folders.getFolderInfo` per folder, competed with startup calls, and re-rendered before the first paint). If they come back, load them after the first paint and update rows in place rather than re-rendering.

**Early Enter.** An Enter pressed before deferred commands arrive, with no explicit selection, is queued (`queueEnter`) and run after the merge. A reflexive Ctrl+Shift+P → Enter therefore runs the true top MRU entry even when that's a deferred command such as Go to: Unified Inbox. Typing or moving the selection cancels the queued Enter. It gives up waiting after 1 s (`QUEUED_ENTER_MAX_WAIT_MS`). Shortcut-launched actions also run after the merge, so they can target deferred commands (`tag-with`). Shared helpers stay in the core: `ctx`, `requireMailTab`, `updateSelected`, `selectionText`, `firstSelectedId`, `switchToFolder`, `destinationItems`, `specialIcon`, `folderEntries`, `notify`, `mailbox`.

### Mail context capture

`captureContext()` scopes everything to the window that hosts the popup (`currentWindow: true`) — without it, `mailTabs.query({active: true})` returns the active mail tab of **every** window.

- In a 3-pane mail tab: `mailTabs.getSelectedMessages`.
- In a message tab / standalone message window: falls back to `messageDisplay.getDisplayedMessages`.
- Both return paginated `MessageList`s; `collectMessages()` follows `messages.continueList` so large selections are handled fully.
- `ctx.windowId` is recorded so `switchToFolder` navigates the originating window rather than an arbitrary one.
- In a compose tab (`tab.type === "messageCompose"`): `ctx.composeTab` and `ctx.composeDetails` (from `compose.getComposeDetails`).
- `ctx.mailTab` carries the tab's current state (`displayedFolder`, `sortType`, `sortOrder`, `groupType`, `layout`, pane visibility), which drives "current" hints and toggle labels.

`requires` gates (see `isAvailable`): `"message"` hides a command when no message is selected/displayed, `"mailTab"` when the palette wasn't opened from a 3-pane mail tab, and `"compose"` outside a compose window. A `label` or `hint` may be a getter (`get label() {…}`) to reflect state captured in `ctx`, e.g. "Hide/Show Folder Pane", or the `current` hint on the active `Layout: …` command (the `LAYOUTS` table maps mailTabs `layout` values standard/wide/vertical to Thunderbird's menu names). Don't copy commands with object spread, which would freeze the getter.

### MRU ordering

Successful command ids are stored in `storage.local` under `mru` (most recent first, capped at 50).
- Empty query: list is ordered by MRU rank, then default order.
- Non-empty query: MRU adds a small tie-breaker boost (≤0.5) that never beats a clearly better fuzzy match.

### Rendering

`render()` rebuilds the list only when the filtered set changes (`refilter`) or when deferred commands are merged. Selection changes (arrows, hover) go through `select(i)`, which repaints just the old and new rows via `paintRow`. Hover selection uses `mousemove`, not `mouseenter`, so rows scrolling under a stationary pointer during keyboard navigation don't steal the selection. The input is an ARIA combobox: `aria-activedescendant` points at the selected `opt-<i>` row. Optional row decoration: `iconColor` (e.g. tag colour).

### Query prefixes and message search

In the root list (not in pickers), a leading character switches mode (`parseQuery`):
- `>`: commands only (no `kind`);
- `@`: folders (`kind: "folder"`: Go to folder and unified folders);
- `#`: tags (`kind: "tag"`: Go to Tag);
- `?`: message search.

Search is provided by `popup/commands/search.js` via `registerMessageSearch(fn)`. The core debounces it (250 ms), needs 2+ characters, and drops results whose query has moved on (`searchSeq`). `search.js` runs `messages.query` for subject and for author (first page only, then `abortList`), merges them newest-first, caps at 50, and opens the chosen message in a tab.

### Styling

**Font size follows Thunderbird.** Every text size, padding and the popup's width/height are in `rem`. Because the popup's size depends on the root font size, it must be right at the *first* layout; a later change resizes the popup after Thunderbird has measured it.
- `popup/early.js` runs in `<head>`, before the body is laid out. It applies the size cached in `localStorage.uiFontSize` from the previous open (synchronous, accepted range 8–40px).
- `applyUIFontSize()` then asks `messenger.palette.getUIFontSize()` and only touches the page and the cache if the size has changed. Timings record `fontSizeCachedPx`, `fontSizeActualPx`, and `fontSizeChangedAfterLoad`.
- Without the experiment, or on the very first open, the CSS fallback `html { font-size: 15px }` applies. Design base is 15px = 1rem, so a 12px design value is `0.8rem`. Keep borders, radii and accent bars in px. Popup size is `min(40rem, 800px)` × `min(26.67rem, 600px)`. Gecko caps popup size near 800×600.

All colours are CSS variables on `:root`, with a `@media (prefers-color-scheme: dark)` override block — extension pages follow the Thunderbird/system theme. Add new colours to **both** blocks. Use `scrollbar-width`/`scrollbar-color` (Gecko), not `::-webkit-scrollbar`.

### Picker mode (Move / Copy, Tag with, Switch to Tab, Write to, Send from, Priority)

A command with a `picker` function opens a sub-list instead of running. `picker()` returns `{ title, items, placeholder?, empty? }` or a Promise of it. Async pickers show "Loading…" first, and a late result is dropped if the picker was closed or replaced (`pickerToken`). `items` are ordinary commands (with `id`, `label`, `run`, …). While a picker is open:
- `#mode` shows the title banner (e.g. "Move 3 messages to…"), and filtering runs over `picker.items` instead of `commands`;
- Esc, or Backspace on an empty query, returns to the root list (Esc in the root list closes the popup);
- running an item records MRU for both the item (e.g. `move-to:<folderId>`) and the parent command, so recent destinations sort first. Items with `noHistory: true` (tabs, search results) are never recorded; their ids don't survive a restart and would push useful entries out.

Move/Copy destinations come from `folderEntries` (built once by `collectFolders`, shared with "Go to:"). Virtual, unified and tag folders are excluded since they can't hold real messages; Move also excludes the folder every selected message already lives in.

### Destructive actions

Commands with `destructive: true` (Delete, Empty Trash, Send Later):
- require two activations in a row — the first Enter/click arms the row (red, "Press Enter again to confirm: …"); changing the selection or query disarms it;
- are **never** recorded in MRU and get no MRU rank/boost, so a reflexive Ctrl+Shift+P → Enter can't fire them;
- are skipped by the "repeat last" shortcut.

Mark any new irreversible action `destructive: true`.

## Files

```
manifest.json                  MV3 manifest: shortcuts (_execute_action + per-action commands), permissions, experiment API.
background.js                  Per-action shortcuts: opens the popup and hands it the requested action.
popup/palette.html             Picker banner, search field, result list; <script> order defines load and tie-break order.
popup/palette.css              Thunderbird-native theme (light + dark), rem-based sizing, .confirm style.
popup/early.js                 Runs in <head>: applies the cached UI font size before first layout.
popup/palette.js               Core: ctx capture, MRU, helpers, command registry, matching + prefixes, search hook, render, pickers, pending shortcut actions.
popup/main.js                  Calls init(); must be the last script.
popup/timing.js                Startup timing instrumentation (see Measuring startup); loaded before palette.js.
popup/commands/compose.js      Compose window: Send Later, Save as Draft/Template, Send from…, Set Priority…, receipt toggles.
popup/commands/messages.js     Compose new, reply, forward, open in tab/window, mark read/unread/star/junk, archive, Move/Copy to…, delete.
popup/commands/tags.js         Tag with…, Remove All Tags, Go to Tag: X.
popup/commands/view.js         Quick filters, Sort by…, Reverse Sort, View: Threaded/Unthreaded/Grouped, panes, layouts.
popup/commands/thunderbird.js  Experiment-backed: Undo/Redo, Compact, Expand/Collapse Threads, Print, View Source, Today Pane, Get Mail, Settings; Configure Keyboard Shortcuts; Address Book.
popup/commands/navigation.js   Switch to Tab…, Write to… (contacts), Open Calendar/Tasks/Chat.
popup/commands/folders.js      Mark Folder as Read, Favorites toggle, Empty Trash, Go to: Unified …, Go to: <folder>.
popup/commands/search.js       "?" message search provider.
lib/fuzzy.js                   Subsequence scorer + highlight(). Loads in the popup (window.Fuzzy) and Node (module.exports).
lib/vcard.js                   Minimal vCard reader (FN/N + EMAIL) for contacts. Popup (window.VCard) and Node.
tests/harness.js               Loads the popup scripts (palette.html order) into a vm with a fake DOM + fake messenger.*; loadPalette() options documented at the top.
tests/palette.test.js          Core behaviour: pickers, confirm flow, MRU, folders, unified, panes, junk.
tests/features.test.js         Command groups: view, folder actions, tags, prefixes, navigation, compose, search, experiment, shortcuts.
tests/fuzzy.test.js, tests/vcard.test.js  Unit tests for lib/.
types/api-since.json           GENERATED: Thunderbird version that added each namespace/function/event/property; used by check-since.
types/messenger.d.ts           GENERATED messenger.* types (Thunderbird MV3 ESR schemas + experiments/schema.json). Don't edit; run `npm run types:update`.
types/palette.d.ts             Our own shapes for JSDoc: Command, PickerSpec, ActivePicker, PaletteContext, FolderEntry, CommandSourceEntry, …
types/globals.d.ts             Declares the lib/ globals (Fuzzy, VCard) for the type checker.
tools/gen-types.mjs            Schema JSON → .d.ts (and api-since.json) generator; tools/update-types.sh downloads the schemas and runs it.
tools/check-since.mjs          Fails on APIs newer than strict_min_version that aren't feature-detected (npm run check:since).
tsconfig.json                  Type-checks the popup scripts (one shared global scope); tsconfig.background.json checks background.js.
package.json                   Dev scripts only: test, typecheck, check:since, check, types:update.
experiments/schema.json        Declares the messenger.palette.* API surface.
experiments/implementation.js  Privileged code wrapping Thunderbird internals.
icons/icon.svg                 Extension and toolbar icon.
package.sh                     Builds ../command-palette-<version>.xpi.
```

### Per-action shortcuts

Besides `_execute_action` (Ctrl+Shift+P), the manifest declares `palette-*` commands with **no default key**, so they never clash with Thunderbird shortcuts. Users assign them under Add-ons → gear → Manage Extension Shortcuts, or via "Configure Keyboard Shortcuts" (`commands.openShortcutSettings`, TB 137+). `background.js`:
1. maps the command to an action (`SHORTCUT_ACTIONS`): a command id such as `move-to`, `tag-with`, `switch-tab` or `write-to`; `repeat-last`; or a prefix to prefill (`@`, `?`);
2. stores it as `pending` and calls `action.openPopup()` synchronously in the listener, which is a user-input handler;
3. answers the popup's `palette:takePending` message once. Requests expire after 5 s.

The popup's `runPendingCommand` prefills a prefix, or finds the command among the currently available ones and runs it (or opens its picker). `repeat-last` picks the newest MRU entry that's available here and isn't destructive.

### Ranking

`filterCommands` takes the best of several scores per command:
1. fuzzy score of the full label;
2. fuzzy score of just the folder name (`nameStart`);
3. fuzzy score of `label + hint + keywords` (positions clipped to the label);
4. **whole-word prefix hits**. If the query is a prefix of a single word, that word is scored as if it stood alone, at full weight for label words and `KEYWORD_WEIGHT` (0.9) for hint/keyword words. Without this, long labels and keyword-only matches lose to scattered letter matches because of the length penalty. For example, "delete" would rank "Go to: Unified Trash" (keyword "deleted") over "Delete (Move to Trash)".

Plus the MRU tie-breaker. Equal scores keep registration order (see **Command registry**).

## Folder rendering

Folders are added as `Go to: <name>` (`kind: "folder"`) with the breadcrumb (`<account> · <parent path>`) in the dim hint. Account roots and unified folders are skipped (roots aren't navigable; unified folders are handled separately, see below). Fuzzy matching scores against label + hint + extra keywords (account name, full path, special-use tags), but highlights only render on the visible label so they stay visually aligned. Folder commands also set `nameStart` (where the name begins in the label); the name is scored on its own too, so typing `inbox` gets the prefix bonus on `Inbox` instead of competing with the `Go to: ` prefix.

**Unified folders.** `buildUnifiedCommands()` adds `Go to: Unified <Inbox|Drafts|Sent|Archives|Templates|Junk|Trash>` (the `UNIFIED_TYPES` list) via `messenger.folders.getUnifiedFolder(type)` (TB 127+, needs only `accountsRead`). Types are fetched in parallel. A type that returns nothing or throws is skipped without hiding the others. Unified folders have no `accountId` and aren't in account trees. Their ids are only valid for the session, so command ids are the fixed `goto-unified-<type>` (for MRU). Each runs `switchToFolder(folder, { retryProps: { folderMode: "unified" } })`. If the plain `displayedFolderId` update is rejected, for example because the folder pane isn't in unified mode, it retries with `folderMode: "unified"`, which switches the folder pane to the unified view.

**Current-folder actions.** "Mark Folder as Read" (`folders.markAsRead`) and "Add/Remove Folder from Favorites" (`folders.update({isFavorite})`) act on `ctx.mailTab.displayedFolder`, and are hidden when there isn't one. Both need `accountsFolders`.

**Tag folders.** "Go to Tag: X" (`kind: "tag"`) resolves `folders.getTagFolder(key)` when run, then `switchToFolder(…, { retryProps: { folderMode: "tags" } })`.

`switchToFolder` picks the originating normal window (falling back to the focused / first normal window), activates its mail tab, then calls `mailTabs.update(tabId, {displayedFolderId})`. If that rejects, it focuses the window and opens the folder with `mailTabs.create`, which has no `windowId` property. MV3 validates these schemas strictly and rejects unknown keys, so only `displayedFolderId` (plus `retryProps`) is passed. MV3 mail tabs carry their id as `tabId`; `id` is the MV2 name.

## Experiment API (`messenger.palette.*`)

`experiments/implementation.js` runs in the privileged `addon_parent` process with access to Thunderbird internals. Current surface:

```
messenger.palette.getNewMail(accountId?)          // omit accountId for all accounts
messenger.palette.openSettings()                  // opens about:preferences in a tab
messenger.palette.openAccountSettings(accountId?)
messenger.palette.getUIFontSize()                 // px; 0 if unknown
messenger.palette.runCommand(command)             // allowlisted cmd_* (see ALLOWED_COMMANDS)
messenger.palette.toggleTodayPane()
messenger.palette.openSpace(name)                 // built-in space: calendar, tasks, chat, …
```

Implementation strategy:
- **Main window**: only `Services.wm.getMostRecentWindow("mail:3pane")`. No fallback to `getMostRecentWindow(null)` — that can return a compose/message window lacking `goDoCommand`/`msgWindow`.
- **runCommand** only accepts ids in `ALLOWED_COMMANDS` (undo, redo, compact, expand/collapse threads, print, view source). `dispatchCommand` looks for a controller in `tabmail.currentAboutMessage`, then `currentAbout3Pane`, then the outer window, because since TB 115 most mail commands live in the inner about:3pane / about:message documents. It throws distinct errors for "not supported by this version" and "not available right now" (e.g. nothing to undo), unlike `goDoCommand`, which fails silently.
- **openSpace** uses `gSpacesToolbar.spaces` / `openSpace(tabmail, space)`. The public `spaces.open()` only opens spaces the extension created. Names are allowlisted.
- **toggleTodayPane** calls `TodayPane.toggleVisibility()`.
- **All-accounts get new mail** uses `win.goDoCommand("cmd_getMsgsForAuthAccounts")` — same command as the toolbar's "Get All New Messages".
- **Per-account get new mail** maps the MailExtension `accountId` (= `nsIMsgAccount.key`) via `MailServices.accounts.accounts`, then calls `server.getNewMessages(rootFolder, msgWindow, null)`, falling back to `server.performBiff`. The popup does not list per-account entries for Local Folders (`type === "none"`).
- **UI font size** returns the `mail.uifontsize` pref if > 0 (the user's explicit Thunderbird font-size choice), else the main window's computed root font size (the default, which follows the OS).
- **Open Settings** tries `win.openPreferencesTab()`, then `openContentTab("about:preferences")`, then throws.
- **Open Account Settings** tries `win.MsgAccountManager(null, server)`, then `openAccountSettingsTab({server})`, then throws.

The popup feature-detects each function (`typeof messenger.palette?.fn === "function"`) and omits commands whose function is missing, so an older or failed experiment just hides those commands.

### Caveats for the experiment

- Experiments require either Mozilla signing or temporary loading; ATN review will scrutinize the privileged code closely.
- `Services` is auto-available as a global in privileged scope — no import needed.
- Internal function names drift across Thunderbird versions (95 → 115 → 128 → 140). If a fallback path fires, verify against the current ESR's `mail/base/content/mailWindow*.js`.
- **Don't use `goDoCommand` as an error-handling fallback**: it silently no-ops on unknown command ids instead of throwing. Use `dispatchCommand` and add new ids to `ALLOWED_COMMANDS` (and the schema description).
- The internal names used here (`gSpacesToolbar`, `TodayPane`, `tabmail.currentAbout3Pane`, the `cmd_*` ids) are not public API. Verify them in Thunderbird after each ESR upgrade.
- Don't catch errors silently — let them propagate so `executeAndClose` in the popup logs them. The popup closes either way.

## Adding an action

Add it to the relevant `popup/commands/*.js` file's `registerCommands(...)` list, or create a new file, register it, and add a `<script>` tag before `main.js` in `palette.html`:

```js
{
  id: "stable-id",                  // required in practice: MRU key (falls back to label, which breaks on rename)
  label: "User-facing label",       // visible + fuzzy-matched + highlighted; may be a getter
  icon: "✎",                        // single-char glyph in the row
  iconColor: "#FF0000",             // optional icon colour (e.g. tag colour)
  hint: "optional right-side hint", // visible (dim) + fuzzy-matched (no highlight); may be a getter
  keywords: "hidden search terms",  // fuzzy-matched only, never displayed
  kind: "folder",                   // optional: "folder" / "tag" for the @ / # prefixes
  requires: "message",              // optional gate: "message" | "mailTab" | "compose"
  destructive: true,                // optional; two-step confirm + excluded from MRU and repeat-last
  noHistory: true,                  // optional; never recorded in MRU (ephemeral items)
  picker: () => ({ title, items, placeholder, empty }), // optional, may be async; opens a sub-list instead of `run`
  run: async () => { /* messenger.* calls; use ctx */ }
}
```

The `run` function is called with no args. The popup closes after it resolves (or throws — errors are logged). Use `notify(message)` when the result isn't visible where the user is looking (e.g. messages moved away). Check that any new API call is covered by `permissions` in `manifest.json`; request only what's used. Current permissions and why:

| Permission | Used for |
|---|---|
| `accountsRead` | accounts, folders, identities, `displayedFolderId` |
| `accountsFolders` | `folders.markAsRead`, `folders.update` (favorites) |
| `messagesRead` | selection, `messages.query` search, `messageDisplay.open` |
| `messagesUpdate` | read/star/junk/tags via `messages.update` |
| `messagesMove` | move/copy/archive, junk move |
| `messagesDelete` | delete, Empty Trash |
| `messagesTagsList` | `messages.tags.list` |
| `compose`, `compose.send`, `compose.save` | compose details, Send Later, Save as Draft/Template |
| `addressBooks` | Open Address Book, `addressBooks.contacts.query` |
| `tabs` | tab titles for Switch to Tab… |
| `storage` | MRU |
| `notifications` | confirmations after move/copy/junk |

For actions that need Thunderbird internals, add a function to `experiments/schema.json` + `experiments/implementation.js` (or an id to `ALLOWED_COMMANDS` for a `cmd_*`), and feature-detect it in the popup.

## Type checking

`npm install` once, then `npm run typecheck` (or `npm run check` for types + tests). The shipped code stays plain JavaScript: TypeScript only reads it (`allowJs`, `checkJs`, `noEmit`), so there is still no build step.

- **API types are generated, not hand-written.** `types/messenger.d.ts` comes from Thunderbird's official annotated MV3 schemas (`thunderbird/webext-annotated-schemas`, branch `esr-mv3`) plus our `experiments/schema.json`. `npm run types:update` regenerates it; the header records the schema commit and Thunderbird version. Don't use `@types/thunderbird-webext-browser`: it describes the MV2 API (e.g. `MailTab.id` instead of `tabId`, no `getUnifiedFolder`).
- **Minimum version.** The schemas are for the current ESR, newer than our `strict_min_version` 128, so the type check alone accepts APIs that don't exist on 128. Every namespace, function and property carries `@since Thunderbird X` (shown on hover). Anything newer than 128 must be feature-detected (`typeof messenger.ns?.fn === "function"`), like `commands.openShortcutSettings` (140). `npm run check:since` (`tools/check-since.mjs`, part of `npm run check`, no install needed) enforces this: it finds `messenger.*` uses in `background.js`, `popup/` and `lib/`, looks them up in `types/api-since.json` (written by the generator), and fails on any newer than `strict_min_version` without a `typeof messenger.…` check in the same file. Mark a deliberate exception with a `since-ok` comment on the line. It can't see new *options* on old functions (the schemas only date namespaces, functions, events and properties), and it skips comments and `messenger.palette.*`.
- **Our own shapes** live in `types/palette.d.ts` and are used from JSDoc: `/** @type {Command[]} */`, `/** @returns {PickerSpec} */`. Command-building helpers declare `@returns {Command[]}` (and `.map(/** @returns {Command} */ (x) => ({…}))` for mapped tables) so literals like `requires: "mailTab"` are checked against the allowed values. Tables of API enum values get a `@type` using the API type, e.g. `messenger.mailTabs.MailTab["sortType"]`.
- **`strict` is on**, so every function parameter needs a JSDoc type (`/** @param {string} text */`) and possibly-missing values must be handled. Many API fields are optional in the schema (`tab.id`, `tab.windowId`, `identity.email`), so guard them rather than assume. Commands gated with `requires` get their context through `requireMailTab()` (core) or `composeTabId()` (compose.js), which throw if it's missing, instead of `ctx.mailTab.…`. For DOM lookups that always succeed, cast: `/** @type {HTMLElement} */ (document.getElementById("…"))`.
- **Not checked:** `experiments/implementation.js` (privileged code; Thunderbird internals have no types) and `tests/`.
- The generator maps the schema loosely: optional parameters in the middle become overloads (`mailTabs.update(tabId?, props)`), reserved-word members work (`messages.delete`), and unknown shapes become `any`.

## Dev loop

Tests: `node --test tests/` (no dependencies). New commands are picked up automatically, because the harness reads `palette.html`. Stub any new API per test with `loadPalette({ api: (rec) => ({ ns: { fn: rec("name") } }) })`, which records calls into `p.calls`. Values recorded from inside the vm are JSON-copied before asserting, because cross-realm objects fail `deepStrictEqual`.

1. Open Thunderbird → **Tools → Add-ons and Themes** (`Ctrl+Shift+A`).
2. Click the gear icon → **Debug Add-ons**.
3. **Load Temporary Add-on…** → pick `manifest.json`.
4. After code changes: hit **Reload** on this extension's row. No restart. If permissions changed, re-enable / re-grant.
5. **Inspect** opens DevTools for the extension. To inspect the popup without it closing, use the Browser Toolbox → "Disable popup auto-hide".

## Measuring startup

`popup/timing.js` (loaded before the core) records how long each startup step takes on every open. It also records page and panel landmarks to separate Thunderbird's time from ours:
- `page: DOM interactive` / `DOMContentLoaded done` / `load event done` (Navigation Timing);
- `event: first focus` / `resize` / `visibilitychange` / `first animation frame` (when the panel is shown and starts drawing).

Steps recorded: the parallel setup calls, each command source (named `<file>#<n>` after the script that registered it), the first render, first paint, and the deferred sources, which finish after the palette is shown. Each step stores `{start, end}` in ms since the popup document started loading, so overlapping steps are visible. It also stores counts: accounts, folders, selected messages, extra selection pages, commands, rows (total and first chunk), font size (cached, actual, changed after load), and `resizeEvents` (more than one means the popup changed size after Thunderbird first measured it).

**Reporting is off by default.** Recording is just in-memory timestamps, but logging and saving only happen when enabled:
- **Debug: Turn On Startup Timing** sets `localStorage.debugStartupTiming = "1"`. It's synchronous, so checking it costs no API round trip. **Debug: Turn Off Startup Timing** removes it and clears saved runs.
- While on: after the first paint, a summary is logged to the popup console as `[palette timing]`, and the run is saved to `storage.local.startupTimings` (last 10 runs). Deferred sources are added to the run when they finish.
- While on: **Debug: Copy Startup Timings** copies all saved runs to the clipboard, or logs them if clipboard access is refused.
- "Action failed" logs name the command id.

## Known limitations

- **The shortcut is per-Thunderbird-window**, not OS-global. Won't fire when Thunderbird is in the background.
- **The popup is anchored to the toolbar action button**, not centered like VSCode's palette. A centered, embedded overlay would need a privileged XUL overlay through an Experiment.
- **Experiment-backed commands depend on Thunderbird internals** (see the caveats above) and are the most likely to break on a new ESR.
- **Per-action shortcuts need the toolbar button.** `action.openPopup()` returns false if the button was removed from the toolbar.
- **Write to… lists local address books only.** Remote (LDAP) books need a search string, and the picker loads contacts up front. Capped at 3000 addresses.
- **Search covers subject and sender only, first 50 per field.** Body/full-text search is slow on large mailboxes.
- **Undo can't undo actions done via the API** if Thunderbird doesn't record them in its undo stack. Verify per action.
- **Font size is read when the popup opens.** Changing Thunderbird's font size takes effect the next time the palette opens, not while it's open.
- **Tests use fakes.** `tests/*.test.js` check popup logic (filtering, picker mode, confirm flow, which `messenger.*` calls are made) against stubbed APIs. The type check catches API signature mismatches against the schemas, but neither catches permission problems or anything in `experiments/` — verify those in Thunderbird. Keep the fakes in MV3 shape (e.g. mail tabs have `tabId`).

## Packaging

Run `./package.sh`. It reads the version from `manifest.json` and writes `../command-palette-<version>.xpi` (outside the project so builds never nest), excluding `.git*`, `.claude/`, `CLAUDE.md`, `package.sh`, `tests/`, `tools/`, `types/`, `package*.json`, `tsconfig*.json`, `node_modules/`, and stray `.xpi`/`build`/`dist` files. Add any new dev-only files to its `-x` list.

For ATN submission: code must not be minified or obfuscated. The extension id in `browser_specific_settings.gecko.id` is immutable once published.

## API reference quick links

- [Supported manifest keys](https://developer.thunderbird.net/add-ons/mailextensions/supported-manifest-keys)
- [`accounts`](https://webextension-api.thunderbird.net/en/mv3/accounts.html), [`folders`](https://webextension-api.thunderbird.net/en/mv3/folders.html), [`messages`](https://webextension-api.thunderbird.net/en/mv3/messages.html), [`mailTabs`](https://webextension-api.thunderbird.net/en/mv3/mailTabs.html), [`messageDisplay`](https://webextension-api.thunderbird.net/en/mv3/messageDisplay.html), [`compose`](https://webextension-api.thunderbird.net/en/mv3/compose.html), [`commands`](https://webextension-api.thunderbird.net/en/mv3/commands.html), [`windows`](https://webextension-api.thunderbird.net/en/latest/windows.html), [`addressBooks`](https://webextension-api.thunderbird.net/en/mv3/addressBooks.html), [`addressBooks.contacts`](https://webextension-api.thunderbird.net/en/mv3/addressBooks.contacts.html), [`messages.tags`](https://webextension-api.thunderbird.net/en/mv3/messages.tags.html), [`identities`](https://webextension-api.thunderbird.net/en/mv3/identities.html), [`tabs`](https://webextension-api.thunderbird.net/en/mv3/tabs.html), [`action`](https://webextension-api.thunderbird.net/en/mv3/action.html), [`notifications`](https://webextension-api.thunderbird.net/en/mv3/notifications.html), [`spaces`](https://webextension-api.thunderbird.net/en/mv3/spaces.html)
- Reference projects: [quickmove-extension](https://github.com/kewisch/quickmove-extension) (popup-based fuzzy folder picker, closest existing analog), [tbkeys](https://github.com/wshanks/tbkeys) (Experiment-API pattern for actions MV3 doesn't expose).

## Icons

`icons/icon.svg` is a single SVG (prompt chevron and cursor on a rounded Thunderbird-blue tile), used for every size in both `icons` (add-ons manager, ATN) and `action.default_icon` (toolbar button). It uses solid colours rather than `context-fill`, so it reads on light and dark toolbars without `theme_icons`. Check it at 16px after any change, since that's the toolbar size.
