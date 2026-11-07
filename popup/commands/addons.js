// Commands of other add-ons: every keyboard-shortcut command they declare (the
// list in Manage Extension Shortcuts) and their toolbar, compose and message
// buttons, listed as "<Add-on>: <command>". Add-ons can't see each other's
// commands through the WebExtension API, so this goes through the experiment
// (messenger.palette.listAddonCommands / runAddonCommand).
//
// Loaded after popup/palette.js (core); see the Command registry there.

/** @type {Record<AddonCommand["kind"], Command["requires"]>} */
const ADDON_KIND_REQUIRES = {
  command: undefined,
  action: undefined,
  composeAction: "compose",
  messageDisplayAction: "message"
};

registerCommands(async () => {
  if (typeof messenger.palette?.listAddonCommands !== "function") return [];
  /** @type {AddonCommand[]} */
  const entries = await messenger.palette.listAddonCommands();
  return entries.map(e => ({
    id: `addon:${e.extensionId}:${e.command}`,
    label: `${e.extensionName}: ${e.label}`,
    hint: e.shortcut || undefined,
    icon: "🧩",
    keywords: `add-on addon extension ${e.extensionName} ${e.kind === "command" ? "" : "button"}`,
    requires: ADDON_KIND_REQUIRES[e.kind],
    run: () => messenger.palette.runAddonCommand(e.extensionId, e.command)
  }));
}, { deferred: true }); // an experiment round trip; not needed for the first paint
