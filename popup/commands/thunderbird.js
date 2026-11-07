// Thunderbird-level commands: address book, and actions that need the privileged experiment (messenger.palette.*).
//
// Loaded after popup/palette.js (core); see the Command registry there.

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

// Internal Thunderbird commands dispatched through the experiment's
// allowlisted runCommand(). Errors such as "nothing to undo" propagate and
// are logged by executeAndClose.
const INTERNAL_COMMANDS = [
  { command: "cmd_undo", id: "undo", label: "Undo", icon: "↶", keywords: "revert back" },
  { command: "cmd_redo", id: "redo", label: "Redo", icon: "↷", keywords: "again" },
  { command: "cmd_compactFolder", id: "compact-folders", label: "Compact Folders", icon: "⇲", keywords: "cleanup space disk", requires: "mailTab" },
  { command: "cmd_expandAllThreads", id: "expand-threads", label: "Expand All Threads", icon: "⊞", keywords: "open threads conversations", requires: "mailTab" },
  { command: "cmd_collapseAllThreads", id: "collapse-threads", label: "Collapse All Threads", icon: "⊟", keywords: "close threads conversations", requires: "mailTab" },
  { command: "cmd_print", id: "print", label: "Print…", icon: "⎙", keywords: "print pdf", requires: "message" },
  { command: "cmd_viewPageSource", id: "view-source", label: "View Message Source", icon: "</>", keywords: "source raw headers", requires: "message" }
];

function buildInternalCommands() {
  if (typeof messenger.palette?.runCommand !== "function") return [];
  return [
    ...INTERNAL_COMMANDS.map(c => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      keywords: c.keywords,
      requires: c.requires,
      run: () => messenger.palette.runCommand(c.command)
    })),
    ...(typeof messenger.palette?.toggleTodayPane === "function" ? [{
      id: "toggle-today-pane",
      label: "Toggle Today Pane",
      icon: "📅",
      keywords: "today pane calendar agenda sidebar",
      run: () => messenger.palette.toggleTodayPane()
    }] : [])
  ];
}

// Diagnostic: copy the saved startup timings (see popup/timing.js) to the
// clipboard so they can be pasted into a bug report.
async function copyStartupTimings() {
  const { startupTimings = [] } = await messenger.storage.local.get("startupTimings");
  const text = startupTimings.length
    ? startupTimings.map(run => Timing.summary(run)).join("\n\n")
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

registerCommands(() => [
  {
    id: "debug-copy-startup-timings",
    label: "Debug: Copy Startup Timings",
    icon: "⏱",
    keywords: "performance slow speed profile diagnostics",
    noHistory: true,
    run: copyStartupTimings
  },
  ...buildInternalCommands(),
  ...(typeof messenger.commands?.openShortcutSettings === "function" ? [{
    id: "configure-shortcuts",
    label: "Configure Keyboard Shortcuts",
    icon: "⌨",
    keywords: "keys hotkeys bindings shortcut settings repeat",
    run: () => messenger.commands.openShortcutSettings()
  }] : [])
]);

registerCommands(({ accounts }) => [
  {
    id: "open-address-book",
    label: "Open Address Book",
    icon: "☰",
    run: () => messenger.addressBooks.openUI()
  },
  ...buildExperimentCommands(accounts)
]);
