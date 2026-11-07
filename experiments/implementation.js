// WebExtension Experiment API for Thunderbird command-palette actions
// that aren't exposed through the public MailExtension WebExtension surface.
//
// Loaded via manifest.json -> experiment_apis.palette. Runs in the privileged
// addon_parent process and exposes messenger.palette.* to the extension.
//
// References:
//   tbkeys: https://github.com/wshanks/tbkeys (canonical pattern for
//     wrapping Thunderbird's internal command system via goDoCommand)
//   ExtensionAPI base: resource://gre/modules/ExtensionCommon.sys.mjs
//
// Verified against Thunderbird 128 ESR APIs. May need adjustment for 153+.

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
// Errors thrown to the extension must be ExtensionErrors: for any other
// error, Thunderbird hides the message and the popup only sees "An unexpected
// error occurred".
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { ExtensionError } = ExtensionUtils;
var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);

// `Services` is auto-available as a global in privileged JSM/sys.mjs scope.

function getMainWindow() {
  // "mail:3pane" is the main window type. Deliberately no fallback to
  // getMostRecentWindow(null): that can return a compose or message window,
  // which lacks goDoCommand/msgWindow and fails in confusing ways.
  return Services.wm.getMostRecentWindow("mail:3pane");
}

function findAccountByExtId(accountId) {
  // The MailExtension `accountId` corresponds to nsIMsgAccount.key
  // (e.g. "account1", "account2"). Older docs sometimes claim it's the
  // server key; this lookup handles both.
  for (const acct of MailServices.accounts.accounts) {
    if (acct.key === accountId) return acct;
  }
  for (const acct of MailServices.accounts.accounts) {
    if (acct.incomingServer && acct.incomingServer.key === accountId) return acct;
  }
  return null;
}

// Internal commands the popup may dispatch via runCommand(). An allowlist, so
// the extension page can't invoke arbitrary chrome commands (and so ATN
// reviewers can see the full surface at a glance).
const ALLOWED_COMMANDS = new Set([
  "cmd_undo",
  "cmd_redo",
  "cmd_compactFolder",
  "cmd_expandAllThreads",
  "cmd_collapseAllThreads",
  "cmd_print",
  "cmd_viewPageSource"
]);

// Built-in spaces openSpace() may open (names from gSpacesToolbar.spaces).
const ALLOWED_SPACES = new Set(["mail", "addressbook", "calendar", "tasks", "chat", "settings"]);

// ---- Other add-ons' commands ------------------------------------------------
//
// Add-ons can't see each other's commands through the WebExtension API, so
// the palette lists them here: every shortcut command an add-on declares (the
// list in Manage Extension Shortcuts) and its toolbar / compose / message
// buttons. Running one goes through the same code paths as Thunderbird's own
// shortcut keys.

// Button kinds: manifest key → [implicit command name, kind, default label].
const ADDON_BUTTONS = [
  ["action", "_execute_action", "action", "Toolbar button"],
  ["browser_action", "_execute_browser_action", "action", "Toolbar button"],
  ["compose_action", "_execute_compose_action", "composeAction", "Compose toolbar button"],
  ["message_display_action", "_execute_message_display_action", "messageDisplayAction", "Message toolbar button"],
];
const BUTTON_KINDS = new Map(ADDON_BUTTONS.map(([key, command, kind]) => [command, { key, kind }]));

// Other running add-ons (not this one, not shut down).
function otherAddons(selfId) {
  return [...ExtensionParent.GlobalManager.extensionMap.values()]
    .filter(ext => ext.id !== selfId && !ext.hasShutdown);
}

async function addonCommands(ext) {
  const out = [];
  const declared = ext.shortcuts ? await ext.shortcuts.allCommands() : [];
  for (const { name, description, shortcut } of declared) {
    const button = BUTTON_KINDS.get(name);
    const buttonLabel = button && (ext.manifest[button.key]?.default_title ||
      ADDON_BUTTONS.find(([, command]) => command === name)[3]);
    out.push({
      extensionId: ext.id,
      extensionName: ext.name,
      command: name,
      label: description || buttonLabel || name,
      shortcut: shortcut || "",
      kind: button ? button.kind : "command",
    });
  }
  // Buttons without a declared _execute_* command can still be clicked.
  for (const [key, command, kind, fallback] of ADDON_BUTTONS) {
    if (!ext.manifest[key] || out.some(c => c.command === command)) continue;
    out.push({
      extensionId: ext.id,
      extensionName: ext.name,
      command,
      label: ext.manifest[key].default_title || fallback,
      shortcut: "",
      kind,
    });
  }
  return out;
}

// Run an add-on command or click its button, like its shortcut key would.
function triggerAddonCommand(ext, command) {
  const global = ExtensionParent.apiManager.global;
  const button = BUTTON_KINDS.get(command);
  if (!button) {
    ext.tabManager.addActiveTabPermission();
    ext.shortcuts.onCommand(command);
    return;
  }
  if (button.kind === "composeAction") {
    const composeWin = Services.wm.getMostRecentWindow("msgcompose");
    if (!composeWin) throw new Error("No compose window is open");
    global.composeActionFor(ext).triggerAction(composeWin);
    return;
  }
  const win = getMainWindow();
  if (!win) throw new Error("No Thunderbird main window available");
  const actionFor = button.kind === "messageDisplayAction" ? global.messageDisplayActionFor : global.browserActionFor;
  actionFor(ext).triggerAction(win);
}

// Delay before running another add-on's command: Thunderbird won't open an
// add-on popup while the palette's own popup is still open, and the palette
// closes right after the call returns.
const ADDON_COMMAND_DELAY_MS = 150;

// Windows that may host a controller for a mail command. Since TB 115 most
// 3-pane commands are handled inside the about:3pane / about:message
// documents of the current tab, not by the outer window.
function commandTargets(win) {
  const tabmail = win.document.getElementById("tabmail");
  const targets = [];
  const about3Pane = tabmail?.currentAbout3Pane;
  const aboutMessage = tabmail?.currentAboutMessage;
  if (aboutMessage) targets.push(aboutMessage);
  if (about3Pane) targets.push(about3Pane);
  targets.push(win);
  return targets;
}

// Dispatch `command` to the first window whose controller supports it.
// Unlike goDoCommand, this reports failure: unknown command (renamed in this
// Thunderbird version) vs known-but-disabled (e.g. nothing to undo).
function dispatchCommand(win, command) {
  let disabled = false;
  for (const target of commandTargets(win)) {
    const controller = target.document.commandDispatcher?.getControllerForCommand(command);
    if (!controller) continue;
    if (!controller.isCommandEnabled(command)) {
      disabled = true;
      continue;
    }
    controller.doCommand(command);
    return;
  }
  throw new ExtensionError(disabled
    ? `${command} is not available right now`
    : `${command} is not supported by this Thunderbird version`);
}

this.palette = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      palette: {
        async getNewMail(accountId) {
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");

          if (accountId) {
            const account = findAccountByExtId(accountId);
            if (!account) throw new ExtensionError(`Account not found: ${accountId}`);
            const server = account.incomingServer;
            if (!server) throw new ExtensionError(`Account has no incoming server: ${accountId}`);

            // RSS, Local Folders, etc. don't support getNewMessages — fall back to biff.
            try {
              server.getNewMessages(server.rootFolder, win.msgWindow || null, null);
            } catch (e) {
              try {
                server.performBiff(win.msgWindow || null);
              } catch (e2) {
                throw new ExtensionError(
                  `Server ${server.prettyName} does not support fetching new mail: ${e2.message}`
                );
              }
            }
            return;
          }

          // All accounts. cmd_getMsgsForAuthAccounts is Thunderbird's
          // built-in "Get Messages for all accounts" command (the one the
          // toolbar "Get Messages" dropdown's "Get All New Messages" item fires).
          win.goDoCommand("cmd_getMsgsForAuthAccounts");
        },

        async getUIFontSize() {
          // Explicit user choice (Settings → General → Font size for the UI,
          // or View → Font Size). 0 means "use the default".
          const pref = Services.prefs.getIntPref("mail.uifontsize", 0);
          if (pref > 0) return pref;

          // Default: whatever the main window actually renders at, which
          // already reflects the OS/system font size.
          const win = getMainWindow();
          if (!win) return 0;
          const px = parseFloat(win.getComputedStyle(win.document.documentElement).fontSize);
          return Number.isFinite(px) ? Math.round(px) : 0;
        },

        async runCommand(command) {
          if (!ALLOWED_COMMANDS.has(command)) throw new ExtensionError(`Command not allowed: ${command}`);
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");
          dispatchCommand(win, command);
        },

        async toggleTodayPane() {
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");
          // Fire the main window's own Today pane command (what View → Today
          // Pane runs). TodayPane.toggleVisibility() can't be called directly:
          // it needs the command's event to toggle the command's checked state.
          const command = win.document.getElementById("calendar_toggle_todaypane_command");
          if (!command) {
            throw new ExtensionError("Today pane is not available on this Thunderbird version");
          }
          command.doCommand();
        },

        async openSpace(name) {
          if (!ALLOWED_SPACES.has(name)) throw new ExtensionError(`Space not allowed: ${name}`);
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");
          const toolbar = win.gSpacesToolbar;
          const space = toolbar?.spaces?.find(sp => sp.name === name);
          if (!space || typeof toolbar.openSpace !== "function") {
            throw new ExtensionError(`Space "${name}" cannot be opened on this Thunderbird version`);
          }
          toolbar.openSpace(win.document.getElementById("tabmail"), space);
        },

        async openSettings() {
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");

          // Try the modern API first (TB 115+ exposes openPreferencesTab on
          // the 3pane window). Fall back through known older paths.
          if (typeof win.openPreferencesTab === "function") {
            win.openPreferencesTab();
            return;
          }
          if (typeof win.openContentTab === "function") {
            win.openContentTab("about:preferences");
            return;
          }
          // No goDoCommand fallback: it silently no-ops on unknown command
          // ids instead of throwing, so it would mask the failure.
          throw new ExtensionError("Settings cannot be opened on this Thunderbird version");
        },

        async openAccountSettings(accountId) {
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");

          let server = null;
          if (accountId) {
            const account = findAccountByExtId(accountId);
            if (account) server = account.incomingServer;
          }

          // MsgAccountManager(selectedPaneID, server) is the global function
          // the Tools menu uses to open the Account Settings dialog/tab.
          if (typeof win.MsgAccountManager === "function") {
            win.MsgAccountManager(null, server);
            return;
          }
          // Fallback: account settings opens as a tab in TB 115+ via this helper.
          if (typeof win.openAccountSettingsTab === "function") {
            win.openAccountSettingsTab({ server });
            return;
          }
          throw new ExtensionError("Account Settings cannot be opened on this Thunderbird version");
        },

        async openAddonsManager() {
          const win = getMainWindow();
          if (!win) throw new ExtensionError("No Thunderbird main window available");
          // What Tools → Add-ons and Themes runs: switches to an open Add-ons
          // tab, or opens one. Not awaited: it resolves once the page loads,
          // and the palette shouldn't wait for that.
          if (typeof win.openAddonsMgr !== "function") {
            throw new ExtensionError("Add-ons and Themes cannot be opened on this Thunderbird version");
          }
          win.openAddonsMgr();
        },

        async listAddonCommands() {
          const lists = await Promise.all(otherAddons(context.extension.id).map(addonCommands));
          return lists.flat();
        },

        async runAddonCommand(extensionId, command) {
          const ext = otherAddons(context.extension.id).find(e => e.id === extensionId);
          if (!ext) throw new ExtensionError(`Add-on not found or not running: ${extensionId}`);
          const known = await addonCommands(ext);
          if (!known.some(c => c.command === command)) {
            throw new ExtensionError(`Add-on ${extensionId} has no command "${command}"`);
          }
          // Run after the palette has closed (see ADDON_COMMAND_DELAY_MS).
          // Errors past this point can't reach the palette, so log them.
          getMainWindow()?.setTimeout(() => {
            try {
              triggerAddonCommand(ext, command);
            } catch (e) {
              console.error(`[palette] add-on command ${extensionId} ${command} failed`, e);
            }
          }, ADDON_COMMAND_DELAY_MS);
        }
      }
    };
  }
};
