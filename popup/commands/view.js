// View commands for the current mail tab: panes and layout.
//
// Loaded after popup/palette.js (core); see the Command registry there.

// mailTabs `layout` values, named as in Thunderbird's View → Layout menu.
const LAYOUTS = [
  { layout: "standard", name: "Classic View", icon: "⊟" },
  { layout: "wide", name: "Wide View", icon: "☰" },
  { layout: "vertical", name: "Vertical View", icon: "◫" }
];

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
