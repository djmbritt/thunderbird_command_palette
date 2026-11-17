// Thunderbird-level commands: address book, and actions that need Thunderbird
// internals, which come from the Command Palette Extras companion add-on
// (`extras`, see the core). Those sources are deferred: they wait for the
// companion's answer. Without the companion, one "Get Command Palette
// Extras…" entry stands in for them.
//
// Loaded after popup/palette.js (core); see the Command registry there.

/**
 * @param {messenger.accounts.MailAccount[]} accounts
 * @returns {Command[]}
 */
function buildExtrasCommands(accounts) {
  const { getNewMail, openSettings, openAccountSettings, openAddonsManager } = extras;
  /** @type {Command[]} */
  const out = [];
  if (typeof getNewMail !== "function") return out;

  out.push({
    id: "getnewmail:all",
    label: "Get New Mail (All Accounts)",
    icon: "⟳",
    run: () => getNewMail()
  });

  for (const a of accounts) {
    // Local Folders ("none") has no incoming server to fetch from.
    if (a.type === "none") continue;
    out.push({
      id: `getnewmail:${a.id}`,
      label: `Get New Mail: ${a.name}`,
      icon: "⟳",
      keywords: a.id,
      run: () => getNewMail(a.id)
    });
  }

  if (typeof openSettings === "function") {
    out.push({
      id: "open-settings",
      label: "Open Thunderbird Settings",
      icon: "⚙",
      run: () => openSettings()
    });
  }

  if (typeof openAccountSettings === "function") {
    out.push({
      id: "open-account-settings",
      label: "Open Account Settings",
      icon: "⚙",
      run: () => openAccountSettings()
    });
  }

  if (typeof openAddonsManager === "function") {
    out.push({
      id: "open-addons-manager",
      label: "Open Add-ons and Themes",
      icon: "🧩",
      keywords: "addons extensions plugins themes manager install",
      run: () => openAddonsManager()
    });
  }

  return out;
}

// Internal Thunderbird commands dispatched through the companion's
// allowlisted runCommand(). Errors such as "nothing to undo" propagate and
// are logged by executeAndClose.
/** @type {{ command: string, id: string, label: string, icon: string, keywords: string, requires?: Command["requires"] }[]} */
const INTERNAL_COMMANDS = [
  { command: "cmd_undo", id: "undo", label: "Undo", icon: "↶", keywords: "revert back" },
  { command: "cmd_redo", id: "redo", label: "Redo", icon: "↷", keywords: "again" },
  { command: "cmd_compactFolder", id: "compact-folders", label: "Compact Folders", icon: "⇲", keywords: "cleanup space disk", requires: "mailTab" },
  { command: "cmd_expandAllThreads", id: "expand-threads", label: "Expand All Threads", icon: "⊞", keywords: "open threads conversations", requires: "mailTab" },
  { command: "cmd_collapseAllThreads", id: "collapse-threads", label: "Collapse All Threads", icon: "⊟", keywords: "close threads conversations", requires: "mailTab" },
  { command: "cmd_print", id: "print", label: "Print…", icon: "⎙", keywords: "print pdf", requires: "message" },
  { command: "cmd_viewPageSource", id: "view-source", label: "View Message Source", icon: "¶", keywords: "source raw headers", requires: "message" }
];

/** @returns {Command[]} */
function buildInternalCommands() {
  const { runCommand, toggleTodayPane } = extras;
  return [
    ...(typeof runCommand === "function" ? INTERNAL_COMMANDS.map(c => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      keywords: c.keywords,
      requires: c.requires,
      run: () => runCommand(c.command)
    })) : []),
    ...(typeof toggleTodayPane === "function" ? [{
      id: "toggle-today-pane",
      label: "Toggle Today Pane",
      icon: "📅",
      keywords: "today pane calendar agenda sidebar",
      run: () => toggleTodayPane()
    }] : [])
  ];
}

// Shown instead of the companion's commands when it isn't installed, so that
// searching for one of them ("undo", "get mail", …) explains where it is.
/** @returns {Command} */
function getExtrasCommand() {
  return {
    id: "get-extras",
    label: "Get Command Palette Extras…",
    hint: "Undo, Get New Mail, Print, …",
    icon: "🧩",
    keywords: "more commands companion add-on install undo redo get new mail fetch print view source " +
      "compact expand collapse threads today pane calendar tasks chat settings account about config addons",
    noHistory: true,
    run: () => messenger.windows.openDefaultBrowser(EXTRAS_URL)
  };
}

// Diagnostic: copy the saved startup timings (see popup/timing.js) to the
// clipboard so they can be pasted into a bug report.
async function copyStartupTimings() {
  const { startupTimings = [] } = await messenger.storage.local.get("startupTimings");
  const text = startupTimings.length
    ? startupTimings.map((/** @type {TimingRun} */ run) => Timing.summary(run)).join("\n\n")
    : "No startup timings recorded yet.";
  console.log(`[palette timing] saved runs:\n${text}`);
  try {
    await navigator.clipboard.writeText(text);
    await notify(`Copied ${startupTimings.length} startup timing run(s) to the clipboard`);
  } catch (e) {
    // Clipboard access can be refused outside a user gesture; the console
    // copy above is the fallback.
    console.warn("[palette timing] clipboard write failed", e);
    await notify("Couldn't copy to the clipboard. The timings were logged to the console.");
  }
}

// Turning timing off also clears saved runs, so stale numbers can't be
// mistaken for current ones next time it's switched on.
async function toggleStartupTiming() {
  const on = !isTimingEnabled();
  setTimingEnabled(on);
  if (!on) await messenger.storage.local.remove("startupTimings");
  await notify(on
    ? "Startup timing is on. Open the palette a few times, then run Debug: Copy Startup Timings."
    : "Startup timing is off. Saved timings were cleared.");
}

registerCommands(() => [
  {
    id: "debug-toggle-startup-timing",
    get label() {
      return isTimingEnabled() ? "Debug: Turn Off Startup Timing" : "Debug: Turn On Startup Timing";
    },
    icon: "⏱",
    keywords: "performance slow speed profile diagnostics measure",
    noHistory: true,
    run: toggleStartupTiming
  },
  ...(isTimingEnabled() ? [{
    id: "debug-copy-startup-timings",
    label: "Debug: Copy Startup Timings",
    icon: "⏱",
    keywords: "performance slow speed profile diagnostics",
    noHistory: true,
    run: copyStartupTimings
  }] : []),
  ...(typeof messenger.commands?.openShortcutSettings === "function" ? [{
    id: "configure-shortcuts",
    label: "Configure Keyboard Shortcuts",
    icon: "⌨",
    keywords: "keys hotkeys bindings shortcut settings repeat",
    run: () => messenger.commands.openShortcutSettings()
  }] : [])
]);

registerCommands(async () => {
  await extrasReady;
  return buildInternalCommands();
}, { deferred: true }); // needs the Extras companion

registerCommands(() => [
  {
    id: "open-address-book",
    label: "Open Address Book",
    icon: "☰",
    run: () => messenger.addressBooks.openUI()
  }
]);

registerCommands(async ({ accounts }) => {
  await extrasReady;
  if (Object.keys(extras).length === 0) return [getExtrasCommand()];
  return buildExtrasCommands(accounts);
}, { deferred: true }); // needs the Extras companion

// ---- about: pages -----------------------------------------------------------
//
// One "Open about:<name>" command per page Thunderbird lists in about:about
// (from the Extras companion; extensions can't open about: pages themselves).
// Common pages get a short description as the hint.
/** @type {Record<string, string>} */
const ABOUT_PAGE_HINTS = {
  about: "List of about: pages",
  accountsettings: "Account Settings",
  addons: "Add-ons and Themes",
  addressbook: "Address Book",
  buildconfig: "Build configuration",
  certificate: "Certificate viewer",
  config: "Config Editor",
  crashes: "Crash reports",
  debugging: "Debug Add-ons",
  downloads: "Saved files",
  import: "Import",
  logging: "Logging",
  memory: "Memory usage",
  networking: "Networking",
  performance: "Task manager",
  policies: "Enterprise policies",
  preferences: "Settings",
  processes: "Processes",
  profiling: "Profiler",
  profiles: "Profiles",
  rights: "Your rights",
  serviceworkers: "Service workers",
  support: "Troubleshooting Information",
  telemetry: "Telemetry",
  "third-party": "Third-party modules",
  "url-classifier": "URL classifier",
  webrtc: "WebRTC"
};

registerCommands(async () => {
  await extrasReady;
  const { listAboutPages, openAboutPage } = extras;
  if (typeof listAboutPages !== "function" || typeof openAboutPage !== "function") return [];
  /** @type {string[]} */
  const names = await listAboutPages();
  return names.map(name => ({
    id: `about-page:${name}`,
    label: `Open about:${name}`,
    hint: ABOUT_PAGE_HINTS[name],
    icon: "ⓘ",
    keywords: `about page internal advanced ${ABOUT_PAGE_HINTS[name] || ""}`,
    run: () => openAboutPage(name)
  }));
}, { deferred: true }); // needs the Extras companion; not needed for the first paint
