// Per-action keyboard shortcuts.
//
// The main shortcut (_execute_action) opens the palette natively and needs no
// code here. The other manifest commands have no default key; users assign
// them in Add-ons → gear → Manage Extension Shortcuts (or via the palette's
// "Configure Keyboard Shortcuts"). Each one opens the palette popup and asks
// it to run a single action:
//
//   1. onCommand stores the requested action and opens the popup. openPopup()
//      is called synchronously in the listener, because it's a user-input
//      handler and async listeners have restrictions.
//   2. The popup, while initialising, sends "palette:takePending" and runs
//      what it gets back (see runPendingCommand in popup/palette.js).
//
// A pending action expires after a few seconds so a popup opened normally
// later never picks up a stale request.

// manifest command name -> palette command id, or a query prefix to prefill.
const SHORTCUT_ACTIONS = {
  "palette-repeat-last": "repeat-last",
  "palette-move-to": "move-to",
  "palette-tag-with": "tag-with",
  "palette-switch-tab": "switch-tab",
  "palette-write-to": "write-to",
  "palette-go-to-folder": "@",
  "palette-search": "?"
};
const PENDING_TTL_MS = 5000;

let pending = null;

messenger.commands.onCommand.addListener((command, tab) => {
  const action = SHORTCUT_ACTIONS[command];
  if (!action) return;
  pending = { action, at: Date.now() };
  const options = tab?.windowId !== undefined ? { windowId: tab.windowId } : undefined;
  messenger.action.openPopup(options)
    .then((opened) => {
      if (!opened) pending = null; // e.g. toolbar button removed
    })
    .catch((e) => {
      pending = null;
      console.error("[palette] could not open popup for shortcut", command, e);
    });
});

messenger.runtime.onMessage.addListener((message) => {
  if (message?.type !== "palette:takePending") return undefined;
  const p = pending;
  pending = null;
  return Promise.resolve(p && Date.now() - p.at < PENDING_TTL_MS ? p.action : null);
});
