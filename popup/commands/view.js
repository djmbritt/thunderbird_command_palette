// View commands for the current mail tab: panes and layout.
//
// Loaded after popup/palette.js (core); see the Command registry there.

// mailTabs `layout` values, named as in Thunderbird's View → Layout menu.
const LAYOUTS = [
  { layout: "standard", name: "Classic View", icon: "⊟" },
  { layout: "wide", name: "Wide View", icon: "☰" },
  { layout: "vertical", name: "Vertical View", icon: "◫" }
];

// Quick filters. setQuickFilter is given the full boolean state each time, so
// each command replaces the current filter rather than stacking onto it
// (the API doesn't document whether omitted fields are kept).
const QUICK_FILTERS = [
  { id: "unread", name: "Unread", icon: "○", keywords: "new" },
  { id: "flagged", name: "Starred", icon: "★", keywords: "flagged" },
  { id: "attachment", name: "Has Attachment", icon: "📎", keywords: "attachments files" },
  { id: "contact", name: "From Contacts", icon: "☺", keywords: "address book people known" },
  { id: "tags", name: "Tagged", icon: "●", keywords: "tags labels" }
];
const CLEAR_FILTER = { unread: false, flagged: false, attachment: false, contact: false, tags: false };

function quickFilterCommands() {
  return [
    ...QUICK_FILTERS.map(f => ({
      id: `quick-filter-${f.id}`,
      label: `Filter: ${f.name}`,
      icon: f.icon,
      keywords: `quick filter show only ${f.keywords}`,
      requires: "mailTab",
      run: () => messenger.mailTabs.setQuickFilter(ctx.mailTab.id, { ...CLEAR_FILTER, [f.id]: true, show: true })
    })),
    {
      id: "quick-filter-clear",
      label: "Filter: Clear",
      icon: "⊘",
      keywords: "quick filter reset remove show all",
      requires: "mailTab",
      run: () => messenger.mailTabs.setQuickFilter(ctx.mailTab.id, { ...CLEAR_FILTER, text: { text: "" } })
    }
  ];
}

// Sorting. mailTabs sortType values, named as in Thunderbird's View → Sort by.
// Picking a new column keeps the current direction ("none" → ascending).
const SORT_TYPES = [
  { type: "date", name: "Date", keywords: "sent time" },
  { type: "received", name: "Received", keywords: "arrival time" },
  { type: "author", name: "Sender", keywords: "from author" },
  { type: "recipient", name: "Recipient", keywords: "to" },
  { type: "correspondent", name: "Correspondents", keywords: "from to" },
  { type: "subject", name: "Subject", keywords: "title" },
  { type: "size", name: "Size", keywords: "bytes" },
  { type: "unread", name: "Read Status", keywords: "unread" },
  { type: "flagged", name: "Star", keywords: "flagged starred" },
  { type: "tags", name: "Tags", keywords: "labels" },
  { type: "attachments", name: "Attachments", keywords: "files" },
  { type: "priority", name: "Priority", keywords: "importance" },
  { type: "junkStatus", name: "Junk Status", keywords: "spam" },
  { type: "id", name: "Order Received", keywords: "unsorted" }
];

function sortCommands() {
  const currentOrder = () => (ctx.mailTab?.sortOrder === "descending" ? "descending" : "ascending");
  return [
    ...SORT_TYPES.map(({ type, name, keywords }) => ({
      id: `sort-${type}`,
      label: `Sort by ${name}`,
      get hint() {
        return ctx.mailTab?.sortType === type ? `current · ${currentOrder()}` : undefined;
      },
      icon: "⇅",
      keywords: `sort order ${keywords}`,
      requires: "mailTab",
      run: () => messenger.mailTabs.update(ctx.mailTab.id, { sortType: type, sortOrder: currentOrder() })
    })),
    {
      id: "sort-reverse",
      label: "Reverse Sort Order",
      get hint() {
        return ctx.mailTab?.sortOrder ? `now ${currentOrder()}` : undefined;
      },
      icon: "⇵",
      keywords: "sort order ascending descending flip invert",
      requires: "mailTab",
      run: () => messenger.mailTabs.update(ctx.mailTab.id, {
        // sortOrder requires sortType to be given too.
        sortType: ctx.mailTab.sortType || "date",
        sortOrder: currentOrder() === "ascending" ? "descending" : "ascending"
      })
    }
  ];
}

// Threading / grouping (mailTabs groupType, TB 128+).
const GROUP_TYPES = [
  { type: "groupedByThread", name: "Threaded", keywords: "threads conversations" },
  { type: "ungrouped", name: "Unthreaded", keywords: "flat no threads" },
  { type: "groupedBySortType", name: "Grouped by Sort", keywords: "groups" }
];

function groupCommands() {
  return GROUP_TYPES.map(({ type, name, keywords }) => ({
    id: `group-${type}`,
    label: `View: ${name}`,
    get hint() {
      return ctx.mailTab?.groupType === type ? "current" : undefined;
    },
    icon: "≡",
    keywords: `thread group view ${keywords}`,
    requires: "mailTab",
    run: () => messenger.mailTabs.update(ctx.mailTab.id, { groupType: type })
  }));
}

registerCommands(() => [...quickFilterCommands(), ...sortCommands(), ...groupCommands()]);

registerCommands(() => [
  {
    id: "toggle-folder-pane",
    // Label reflects the current state (captured when the palette opened).
    get label() {
      return ctx.mailTab?.folderPaneVisible === false ? "Show Folder Pane" : "Hide Folder Pane";
    },
    icon: "◧",
    keywords: "toggle folder pane sidebar layout view",
    requires: "mailTab",
    run: () => messenger.mailTabs.update(ctx.mailTab.id, {
      folderPaneVisible: ctx.mailTab.folderPaneVisible === false
    })
  },
  {
    id: "toggle-message-pane",
    get label() {
      return ctx.mailTab?.messagePaneVisible === false ? "Show Message Pane" : "Hide Message Pane";
    },
    icon: "⬓",
    keywords: "toggle message pane preview reading pane layout view",
    requires: "mailTab",
    run: () => messenger.mailTabs.update(ctx.mailTab.id, {
      messagePaneVisible: ctx.mailTab.messagePaneVisible === false
    })
  },
  ...LAYOUTS.map(({ layout, name, icon }) => ({
    id: `layout-${layout}`,
    label: `Layout: ${name}`,
    // Mark the active layout rather than hiding it, so all three are always
    // findable and the user can see which one is in use.
    get hint() {
      return ctx.mailTab?.layout === layout ? "current" : undefined;
    },
    icon,
    keywords: `view layout pane ${layout}`,
    requires: "mailTab",
    run: () => messenger.mailTabs.update(ctx.mailTab.id, { layout })
  }))
]);
