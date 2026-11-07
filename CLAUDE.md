# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A VSCode-style command palette extension for Thunderbird. Press `Ctrl+Shift+P` / `Cmd+Shift+P` to open a popup that fuzzy-searches actions (compose, reply, archive, switch folder, etc.) and runs the selected one.

## Stack

- **Thunderbird MailExtension**, **Manifest V3**, **`messenger.*` namespace** (canonical alias for `browser.*` in Thunderbird).
- `strict_min_version: "128.0"` — first ESR with stable MV3 support.
- No build step. No bundler. Pure HTML/CSS/JS. CSP forbids remote scripts and inline handlers, so anything external must be vendored under `lib/`.

## Architecture

The palette is an **`action` popup** (toolbar-button dropdown). The shortcut is bound to the reserved `_execute_action` command in `manifest.json`, so Thunderbird opens the popup itself — there is no `commands.onCommand` listener. Action popups close natively on outside click, so there is no blur handler. The popup is fixed at 600×400 in `palette.css` so it doesn't resize as the result list changes.

> History: earlier versions (≤0.3) opened `popup/palette.html` via `windows.create({type: "popup"})` from `background.js`, with parent-clamped positioning. That was replaced by the action popup, and the background script was removed. Add a `background` key back to `manifest.json` if you need event listeners.

Flow:
1. User presses the shortcut → Thunderbird opens `popup/palette.html` as the action popup.
2. On load, `palette.js` (in parallel) loads MRU history, lists accounts with folders, and captures the mail context.
3. Static actions + experiment actions + "Go to: <folder>" entries are scored against the input via `lib/fuzzy.js`.
4. Enter / click → run the action, then `window.close()`. Esc → close without running.

### Mail context capture

`captureContext()` scopes everything to the window that hosts the popup (`currentWindow: true`) — without it, `mailTabs.query({active: true})` returns the active mail tab of **every** window.

- In a 3-pane mail tab: `mailTabs.getSelectedMessages`.
- In a message tab / standalone message window: falls back to `messageDisplay.getDisplayedMessages`.
- Both return paginated `MessageList`s; `collectMessages()` follows `messages.continueList` so large selections are handled fully.
- `ctx.windowId` is recorded so `switchToFolder` navigates the originating window rather than an arbitrary one.

Actions with `requires: "message"` are hidden when no message is selected/displayed.

### MRU ordering

Successful command ids are stored in `storage.local` under `mru` (most recent first, capped at 50).
- Empty query: list is ordered by MRU rank, then default order.
- Non-empty query: MRU adds a small tie-breaker boost (≤0.5) that never beats a clearly better fuzzy match.

### Rendering

`render()` rebuilds the list only when the filtered set changes (`refilter`). Selection changes (arrows, hover) go through `select(i)`, which repaints just the old and new rows via `paintRow`. Hover selection uses `mousemove`, not `mouseenter`, so rows scrolling under a stationary pointer during keyboard navigation don't steal the selection. The input is an ARIA combobox: `aria-activedescendant` points at the selected `opt-<i>` row.

### Styling

**Font size follows Thunderbird.** Every text size, padding and the popup's width/height are in `rem`. On init, `applyUIFontSize()` sets `<html>` font-size from `messenger.palette.getUIFontSize()` (accepted range 8–40px), before the first render so the popup doesn't jump. Without the experiment the CSS fallback `html { font-size: 15px }` applies. Design base is 15px = 1rem, so a 12px design value is `0.8rem`. Keep borders, radii and accent bars in px. Popup size is `min(40rem, 800px)` × `min(26.67rem, 600px)`. Gecko caps popup size near 800×600.

All colours are CSS variables on `:root`, with a `@media (prefers-color-scheme: dark)` override block — extension pages follow the Thunderbird/system theme. Add new colours to **both** blocks. Use `scrollbar-width`/`scrollbar-color` (Gecko), not `::-webkit-scrollbar`. The footer's Esc label (`#esc-action`) reads "close" in the root list and "back" in a picker.

### Picker mode (Move / Copy to Folder…)

A command with a `picker` function opens a sub-list instead of running. `picker()` returns `{ title, empty, items }`; `items` are ordinary commands (with `id`, `label`, `run`, …). While a picker is open:
- `#mode` shows the title banner (e.g. "Move 3 messages to…"), and filtering runs over `picker.items` instead of `commands`;
- Esc, or Backspace on an empty query, returns to the root list (Esc in the root list closes the popup);
- running an item records MRU for both the item (e.g. `move-to:<folderId>`) and the parent command, so recent destinations sort first.

Move/Copy destinations come from `folderEntries` (built once by `collectFolders`, shared with "Go to:"). Virtual, unified and tag folders are excluded since they can't hold real messages; Move also excludes the folder every selected message already lives in.

### Destructive actions

Commands with `destructive: true` (Delete, Empty Trash):
- require two activations in a row — the first Enter/click arms the row (red, "Press Enter again to confirm: …"); changing the selection or query disarms it;
- are **never** recorded in MRU and get no MRU rank/boost, so a reflexive Ctrl+Shift+P → Enter can't fire them.

Mark any new irreversible action `destructive: true`.

## Files

```
manifest.json              MV3 manifest. Binds the shortcut to _execute_action, declares permissions and the experiment API.
popup/palette.html         Picker banner, search field (inline SVG icon), result list, key-hint footer.
popup/palette.css          Thunderbird-native theme: light default + prefers-color-scheme dark, all colours as :root variables; fixed popup size; .confirm style for armed destructive rows.
popup/palette.js           Context capture, action registry, fuzzy filter, MRU, render loop.
lib/fuzzy.js               Subsequence scorer (best of greedy passes from each start) with word-boundary/consecutive/prefix bonuses + highlight(). Loads in both the popup (window.Fuzzy) and Node (module.exports).
tests/fuzzy.test.js        node:test suite for lib/fuzzy.js.
tests/palette.test.js      Smoke tests: loads popup/palette.js in a vm with a fake DOM + fake messenger.* and drives it by key events.
experiments/schema.json    Declares the `messenger.palette.*` API surface.
experiments/implementation.js  Privileged code. Wraps Thunderbird internals (goDoCommand, MailServices) for actions MV3 can't reach.
package.sh                 Builds ../command-palette-<version>.xpi.
```

## Folder rendering

Folders are added as `Go to: <name>` with the breadcrumb (`<account> · <parent path>`) in the dim hint. Account roots and unified folders are skipped (roots aren't navigable; unified folders are handled separately, see below). Fuzzy matching scores against label + hint + extra keywords (account name, full path, special-use tags), but highlights only render on the visible label so they stay visually aligned. Folder commands also set `nameStart` (where the name begins in the label); the name is scored on its own too, so typing `inbox` gets the prefix bonus on `Inbox` instead of competing with the `Go to: ` prefix.

**Unified folders.** `buildUnifiedCommands()` adds `Go to: Unified <Inbox|Drafts|Sent|Archives|Templates|Junk|Trash>` (the `UNIFIED_TYPES` list) via `messenger.folders.getUnifiedFolder(type)` (TB 127+, needs only `accountsRead`). Types are fetched in parallel. A type that returns nothing or throws is skipped without hiding the others. Unified folders have no `accountId` and aren't in account trees. Their ids are only valid for the session, so command ids are the fixed `goto-unified-<type>` (for MRU). Each runs `switchToFolder(folder, { retryProps: { folderMode: "unified" } })`. If the plain `displayedFolderId` update is rejected, for example because the folder pane isn't in unified mode, it retries with `folderMode: "unified"`, which switches the folder pane to the unified view.

`switchToFolder` picks the originating normal window (falling back to the focused / first normal window), activates its mail tab, then calls `mailTabs.update({displayedFolderId})`. If that rejects, it opens the folder in a new mail tab. MV3 validates the update schema strictly — only `displayedFolderId` is passed.

## Experiment API (`messenger.palette.*`)

`experiments/implementation.js` runs in the privileged `addon_parent` process with access to Thunderbird internals. Current surface:

```
messenger.palette.getNewMail(accountId?)          // omit accountId for all accounts
messenger.palette.openSettings()                  // opens about:preferences in a tab
messenger.palette.openAccountSettings(accountId?)
messenger.palette.getUIFontSize()               // px; 0 if unknown
```

Implementation strategy:
- **Main window**: only `Services.wm.getMostRecentWindow("mail:3pane")`. No fallback to `getMostRecentWindow(null)` — that can return a compose/message window lacking `goDoCommand`/`msgWindow`.
- **All-accounts get new mail** uses `win.goDoCommand("cmd_getMsgsForAuthAccounts")` — same command as the toolbar's "Get All New Messages".
- **Per-account get new mail** maps the MailExtension `accountId` (= `nsIMsgAccount.key`) via `MailServices.accounts.accounts`, then calls `server.getNewMessages(rootFolder, msgWindow, null)`, falling back to `server.performBiff`. The popup does not list per-account entries for Local Folders (`type === "none"`).
- **UI font size** returns the `mail.uifontsize` pref if > 0 (the user's explicit Thunderbird font-size choice), else the main window's computed root font size (the default, which follows the OS).
- **Open Settings** tries `win.openPreferencesTab()`, then `openContentTab("about:preferences")`, then throws.
- **Open Account Settings** tries `win.MsgAccountManager(null, server)`, then `openAccountSettingsTab({server})`, then throws.

The popup feature-detects `messenger.palette` (and `getUIFontSize` separately) and skips these commands if the experiment fails to load. See `HAS_EXPERIMENT` in `popup/palette.js`.

### Caveats for the experiment

- Experiments require either Mozilla signing or temporary loading; ATN review will scrutinize the privileged code closely.
- `Services` is auto-available as a global in privileged scope — no import needed.
- Internal function names drift across Thunderbird versions (95 → 115 → 128 → 140). If a fallback path fires, verify against the current ESR's `mail/base/content/mailWindow*.js`.
- **Don't use `goDoCommand` as an error-handling fallback**: it silently no-ops on unknown command ids instead of throwing.
- Don't catch errors silently — let them propagate so `executeAndClose` in the popup logs them. The popup closes either way.

## Adding an action

Append to `STATIC_ACTIONS` in `popup/palette.js`:

```js
{
  id: "stable-id",                  // required in practice: MRU key (falls back to label, which breaks on rename)
  label: "User-facing label",       // visible + fuzzy-matched + highlighted
  icon: "✎",                        // single-char glyph in the row
  hint: "optional right-side hint", // visible (dim) + fuzzy-matched (no highlight)
  keywords: "hidden search terms",  // fuzzy-matched only, never displayed
  requires: "message",              // optional gate; hidden when no message selected/displayed
  destructive: true,                // optional; two-step confirm + excluded from MRU
  picker: () => ({ title, empty, items }), // optional; opens a sub-list instead of `run` (see Picker mode)
  run: async () => { /* messenger.* calls; use ctx.selectedMessages */ }
}
```

The `run` function is called with no args. The popup closes after it resolves (or throws — errors are logged). Check that any new API call is covered by `permissions` in `manifest.json` (e.g. `messages.delete` needs `messagesDelete`; `messages.move`/`copy` need `messagesMove`); request only what's used.

For actions that need Thunderbird internals, add a function to `experiments/schema.json` + `experiments/implementation.js` and gate the command on `HAS_EXPERIMENT` in `buildExperimentCommands`.

## Dev loop

Tests: `node --test tests/` (no dependencies). When adding a command, extend the fake `messenger` in `tests/palette.test.js` with any new API it calls. Values recorded from inside the vm are JSON-copied before asserting, because cross-realm objects fail `deepStrictEqual`.

1. Open Thunderbird → **Tools → Add-ons and Themes** (`Ctrl+Shift+A`).
2. Click the gear icon → **Debug Add-ons**.
3. **Load Temporary Add-on…** → pick `manifest.json`.
4. After code changes: hit **Reload** on this extension's row. No restart. If permissions changed, re-enable / re-grant.
5. **Inspect** opens DevTools for the extension. To inspect the popup without it closing, use the Browser Toolbox → "Disable popup auto-hide".

## Known limitations

- **The shortcut is per-Thunderbird-window**, not OS-global. Won't fire when Thunderbird is in the background.
- **The popup is anchored to the toolbar action button**, not centered like VSCode's palette. A centered, embedded overlay would need a privileged XUL overlay through an Experiment.
- **Experiment API surface is small.** `getNewMail`, `openSettings`, `openAccountSettings`, `getUIFontSize`. Most other toolbar-style actions can be added as `goDoCommand("cmd_*")` on the main window.
- **Font size is read when the popup opens.** Changing Thunderbird's font size takes effect the next time the palette opens, not while it's open.
- **Tests use fakes.** `tests/palette.test.js` checks popup logic (filtering, picker mode, confirm flow, which `messenger.*` calls are made) against stubbed APIs. It can't catch Thunderbird API signature or permission mismatches, or anything in `experiments/` — verify those in Thunderbird.

## Packaging

Run `./package.sh`. It reads the version from `manifest.json` and writes `../command-palette-<version>.xpi` (outside the project so builds never nest), excluding `.git*`, `.claude/`, `CLAUDE.md`, `package.sh`, `tests/`, `node_modules/`, and stray `.xpi`/`build`/`dist` files. Add any new dev-only files to its `-x` list.

For ATN submission: code must not be minified or obfuscated. The extension id in `browser_specific_settings.gecko.id` is immutable once published.

## API reference quick links

- [Supported manifest keys](https://developer.thunderbird.net/add-ons/mailextensions/supported-manifest-keys)
- [`accounts`](https://webextension-api.thunderbird.net/en/mv3/accounts.html), [`folders`](https://webextension-api.thunderbird.net/en/mv3/folders.html), [`messages`](https://webextension-api.thunderbird.net/en/mv3/messages.html), [`mailTabs`](https://webextension-api.thunderbird.net/en/mv3/mailTabs.html), [`messageDisplay`](https://webextension-api.thunderbird.net/en/mv3/messageDisplay.html), [`compose`](https://webextension-api.thunderbird.net/en/mv3/compose.html), [`commands`](https://webextension-api.thunderbird.net/en/mv3/commands.html), [`windows`](https://webextension-api.thunderbird.net/en/latest/windows.html), [`addressBooks`](https://webextension-api.thunderbird.net/en/mv3/addressBooks.html)
- Reference projects: [quickmove-extension](https://github.com/kewisch/quickmove-extension) (popup-based fuzzy folder picker, closest existing analog), [tbkeys](https://github.com/wshanks/tbkeys) (Experiment-API pattern for actions MV3 doesn't expose).

## Icons

Not yet added. Drop PNGs into `icons/` and reference them via the `icons` key and `action.default_icon` in `manifest.json`.
