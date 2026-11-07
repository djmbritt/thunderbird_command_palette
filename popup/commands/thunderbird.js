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

registerCommands(({ accounts }) => [
  {
    id: "open-address-book",
    label: "Open Address Book",
    icon: "☰",
    run: () => messenger.addressBooks.openUI()
  },
  ...buildExperimentCommands(accounts)
]);
