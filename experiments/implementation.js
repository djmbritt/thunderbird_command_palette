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
  throw new Error(disabled
    ? `${command} is not available right now`
    : `${command} is not supported by this Thunderbird version`);
}

this.palette = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      palette: {
        async getNewMail(accountId) {
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");

          if (accountId) {
            const account = findAccountByExtId(accountId);
            if (!account) throw new Error(`Account not found: ${accountId}`);
            const server = account.incomingServer;
            if (!server) throw new Error(`Account has no incoming server: ${accountId}`);

            // RSS, Local Folders, etc. don't support getNewMessages — fall back to biff.
            try {
              server.getNewMessages(server.rootFolder, win.msgWindow || null, null);
            } catch (e) {
              try {
                server.performBiff(win.msgWindow || null);
              } catch (e2) {
                throw new Error(
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
          if (!ALLOWED_COMMANDS.has(command)) throw new Error(`Command not allowed: ${command}`);
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");
          dispatchCommand(win, command);
        },

        async toggleTodayPane() {
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");
          // TodayPane is the calendar Today pane controller in the main window.
          if (typeof win.TodayPane?.toggleVisibility !== "function") {
            throw new Error("Today pane is not available on this Thunderbird version");
          }
          win.TodayPane.toggleVisibility();
        },

        async openSpace(name) {
          if (!ALLOWED_SPACES.has(name)) throw new Error(`Space not allowed: ${name}`);
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");
          const toolbar = win.gSpacesToolbar;
          const space = toolbar?.spaces?.find(sp => sp.name === name);
          if (!space || typeof toolbar.openSpace !== "function") {
            throw new Error(`Space "${name}" cannot be opened on this Thunderbird version`);
          }
          toolbar.openSpace(win.document.getElementById("tabmail"), space);
        },

        async openSettings() {
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");

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
          throw new Error("Settings cannot be opened on this Thunderbird version");
        },

        async openAccountSettings(accountId) {
          const win = getMainWindow();
          if (!win) throw new Error("No Thunderbird main window available");

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
          throw new Error("Account Settings cannot be opened on this Thunderbird version");
        }
      }
    };
  }
};
