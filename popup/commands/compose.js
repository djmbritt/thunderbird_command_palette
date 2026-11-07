// Compose-window commands. Shown only when the palette is opened from a
// compose tab (requires: "compose"); they act on ctx.composeTab, using the
// details captured in ctx.composeDetails for current-state labels.
//
// Loaded after popup/palette.js (core); see the Command registry there.
// Permissions: compose (details), compose.send (sendLater),
// compose.save (draft/template), accountsRead (identities).

/** @type {{ value: messenger.compose.ComposeDetails["priority"], name: string }[]} */
const PRIORITIES = [
  { value: "highest", name: "Highest" },
  { value: "high", name: "High" },
  { value: "normal", name: "Normal" },
  { value: "low", name: "Low" },
  { value: "lowest", name: "Lowest" }
];

function composeTabId() {
  return ctx.composeTab.id;
}

/** @returns {Promise<PickerSpec>} */
async function identityPicker() {
  const identities = await messenger.identities.list();
  const current = ctx.composeDetails?.identityId;
  return {
    title: "Send from…",
    placeholder: "Type a name or address…",
    empty: "No matching identities.",
    items: identities
      .sort((a, b) => (a.email || "").localeCompare(b.email || ""))
      .map(id => ({
        id: `compose-identity:${id.id}`,
        label: mailbox(id.name, id.email).replace(/^"([^"]*)"/, "$1"),
        hint: [id.label, id.id === current ? "current" : null].filter(Boolean).join(" · ") || undefined,
        icon: "☺",
        keywords: `${id.email} ${id.label || ""}`,
        run: () => messenger.compose.setComposeDetails(composeTabId(), { identityId: id.id })
      }))
  };
}

/** @returns {PickerSpec} */
function priorityPicker() {
  const current = ctx.composeDetails?.priority || "normal";
  return {
    title: "Set priority…",
    empty: "No matching priority.",
    items: PRIORITIES.map(p => ({
      id: `compose-priority:${p.value}`,
      label: p.name,
      hint: p.value === current ? "current" : undefined,
      icon: "!",
      run: () => messenger.compose.setComposeDetails(composeTabId(), { priority: p.value })
    }))
  };
}

// Toggle commands whose label reflects the captured compose state.
/** @returns {Command} */
function toggleCommand({ id, prop, on, off, icon, keywords }) {
  return {
    id,
    get label() {
      return ctx.composeDetails?.[prop] ? off : on;
    },
    icon,
    keywords,
    requires: "compose",
    run: () => messenger.compose.setComposeDetails(composeTabId(), { [prop]: !ctx.composeDetails?.[prop] })
  };
}

registerCommands(() => [
  {
    id: "compose-send-later",
    label: "Send Later",
    hint: "Outbox",
    icon: "⏲",
    keywords: "send outbox queue",
    requires: "compose",
    // Sending is outward-facing: confirm first and never put it on top via MRU.
    destructive: true,
    run: () => messenger.compose.sendMessage(composeTabId(), { mode: "sendLater" })
  },
  {
    id: "compose-save-draft",
    label: "Save as Draft",
    icon: "✎",
    keywords: "save draft",
    requires: "compose",
    run: () => messenger.compose.saveMessage(composeTabId(), { mode: "draft" })
  },
  {
    id: "compose-save-template",
    label: "Save as Template",
    icon: "▤",
    keywords: "save template reuse",
    requires: "compose",
    run: () => messenger.compose.saveMessage(composeTabId(), { mode: "template" })
  },
  {
    id: "compose-identity",
    label: "Send from…",
    icon: "☺",
    keywords: "identity from account sender switch change",
    requires: "compose",
    picker: identityPicker
  },
  {
    id: "compose-priority",
    label: "Set Priority…",
    get hint() {
      const p = PRIORITIES.find(x => x.value === (ctx.composeDetails?.priority || "normal"));
      return p ? `now ${p.name}` : undefined;
    },
    icon: "!",
    keywords: "priority importance urgent",
    requires: "compose",
    picker: priorityPicker
  },
  toggleCommand({
    id: "compose-return-receipt",
    prop: "returnReceipt",
    on: "Request Return Receipt",
    off: "Don't Request Return Receipt",
    icon: "↺",
    keywords: "return receipt read receipt mdn"
  }),
  toggleCommand({
    id: "compose-dsn",
    prop: "deliveryStatusNotification",
    on: "Request Delivery Status Notification",
    off: "Don't Request Delivery Status Notification",
    icon: "↺",
    keywords: "dsn delivery status notification receipt"
  })
]);
