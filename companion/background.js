// Command Palette Extras: relays the Command Palette's calls to this add-on's
// experiment (messenger.palette.*, companion/experiments/).
//
// The Command Palette itself is listed on addons.thunderbird.net, which
// doesn't accept add-ons with their own experiment APIs. The commands that
// need Thunderbird internals therefore live in this separate, self-hosted
// add-on. The palette's popup talks to it with runtime.sendMessage(EXTRAS_ID,
// …) (see connectExtras in popup/palette.js):
//
//   {type: "extras:hello"}                 → {version, functions: [names]}
//   {type: "extras:call", name, args}      → the function's result; a
//                                            rejection carries its message
//
// Only the Command Palette may call it, and only the functions listed here.

const PALETTE_ID = "command-palette@djmbritt.github.io";

/** @type {(keyof typeof messenger.palette)[]} */
const FUNCTIONS = [
  "getNewMail",
  "openSettings",
  "openAccountSettings",
  "getUIFontSize",
  "runCommand",
  "toggleTodayPane",
  "openSpace",
  "openAddonsManager",
  "listAboutPages",
  "openAboutPage",
  "listAddonCommands",
  "runAddonCommand"
];

/** @param {string} name */
const available = (name) => typeof (/** @type {any} */ (messenger.palette)?.[name]) === "function";

/**
 * @param {string} name
 * @param {unknown[]} args
 */
async function call(name, args) {
  if (!FUNCTIONS.includes(/** @type {any} */ (name)) || !available(name)) {
    throw new Error(`Command Palette Extras has no function "${name}"`);
  }
  if (name === "runAddonCommand" && args[0] === PALETTE_ID) {
    throw new Error("The Command Palette's own commands can't be run this way");
  }
  const result = await /** @type {any} */ (messenger.palette)[name](...args);
  if (name === "listAddonCommands") {
    // The palette lists other add-ons' commands, not its own.
    return result.filter((/** @type {{ extensionId: string }} */ c) => c.extensionId !== PALETTE_ID);
  }
  return result;
}

messenger.runtime.onMessageExternal.addListener((message, sender) => {
  if (sender.id !== PALETTE_ID) return undefined;
  if (message?.type === "extras:hello") {
    return Promise.resolve({
      version: messenger.runtime.getManifest().version,
      functions: FUNCTIONS.filter(available)
    });
  }
  if (message?.type === "extras:call") {
    return call(String(message.name), Array.isArray(message.args) ? message.args : []);
  }
  return undefined;
});
