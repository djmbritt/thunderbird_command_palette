// Navigation commands: Switch to Tab…, Write to… (contacts), and opening
// Thunderbird's built-in spaces (Calendar, Tasks, Chat).
//
// Loaded after popup/palette.js (core); see the Command registry there.

// ---- Switch to Tab… --------------------------------------------------------

const TAB_TYPE_LABELS = {
  mail: "Mail",
  messageDisplay: "Message",
  messageCompose: "Compose",
  addressBook: "Address Book",
  calendar: "Calendar",
  calendarEvent: "Event",
  calendarTask: "Task",
  tasks: "Tasks",
  chat: "Chat",
  content: "Web",
  special: "Thunderbird"
};

async function tabPicker() {
  const tabs = await messenger.tabs.query({});
  return {
    title: "Switch to tab…",
    placeholder: "Type a tab title…",
    empty: "No matching tabs.",
    items: tabs.map(t => ({
      id: `tab:${t.id}`,
      label: t.title || TAB_TYPE_LABELS[t.type] || "Untitled",
      hint: [TAB_TYPE_LABELS[t.type], t.active && t.windowId === ctx.windowId ? "current" : null]
        .filter(Boolean).join(" · "),
      icon: "▭",
      keywords: t.type || "",
      noHistory: true, // tab ids don't survive a restart
      run: async () => {
        await messenger.tabs.update(t.id, { active: true });
        await messenger.windows.update(t.windowId, { focused: true });
      }
    }))
  };
}

// ---- Write to… -------------------------------------------------------------
//
// Lists local address-book contacts (remote/LDAP books need a search string,
// so they're skipped) and starts a new message to the chosen address. One
// item per email address. Capped so a huge address book stays responsive.
const CONTACT_LIMIT = 3000;

async function contactPicker() {
  const nodes = await messenger.addressBooks.contacts.query({ includeRemote: false });
  const items = [];
  for (const node of nodes) {
    const { name, emails } = VCard.parse(node.vCard);
    for (const email of emails) {
      items.push({
        id: `write-to:${email.toLowerCase()}`,
        label: name || email,
        hint: name ? email : undefined,
        icon: "✉",
        keywords: email,
        run: () => messenger.compose.beginNew({ to: [mailbox(name, email)] })
      });
      if (items.length >= CONTACT_LIMIT) break;
    }
    if (items.length >= CONTACT_LIMIT) break;
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  return {
    title: "Write to…",
    placeholder: "Type a name or email address…",
    empty: nodes.length ? "No matching contacts." : "No contacts with an email address.",
    items
  };
}

// ---- Spaces ----------------------------------------------------------------
//
// spaces.open() only opens spaces the extension created, so built-in spaces
// go through the experiment (messenger.palette.openSpace).
const SPACES = [
  { name: "calendar", label: "Open Calendar", icon: "📅", keywords: "events agenda schedule" },
  { name: "tasks", label: "Open Tasks", icon: "☑", keywords: "todo to-do" },
  { name: "chat", label: "Open Chat", icon: "💬", keywords: "instant messaging matrix xmpp irc" }
];

registerCommands(() => [
  {
    id: "switch-tab",
    label: "Switch to Tab…",
    icon: "▭",
    keywords: "tabs go window",
    picker: tabPicker
  },
  ...(typeof messenger.addressBooks?.contacts?.query === "function" ? [{
    id: "write-to",
    label: "Write to…",
    icon: "✉",
    keywords: "compose new message email contact address book send to",
    picker: contactPicker
  }] : []),
  ...(typeof messenger.palette?.openSpace === "function" ? SPACES.map(sp => ({
    id: `open-space-${sp.name}`,
    label: sp.label,
    icon: sp.icon,
    keywords: `space ${sp.name} ${sp.keywords}`,
    run: () => messenger.palette.openSpace(sp.name)
  })) : [])
]);
