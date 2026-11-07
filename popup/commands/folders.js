// Folder commands: Go to folder, unified folders, Empty Trash.
//
// Loaded after popup/palette.js (core); see the Command registry there.

async function emptyTrashAllAccounts() {
  const accounts = await messenger.accounts.list(false);
  for (const a of accounts) {
    const [trash] = await messenger.folders.query({ accountId: a.id, specialUse: ["trash"] });
    if (!trash) continue;
    let page = await messenger.messages.list(trash.id);
    while (true) {
      if (page.messages.length === 0) break;
      const ids = page.messages.map(m => m.id);
      await messenger.messages.delete(ids, { deletePermanently: true });
      if (!page.id) break;
      page = await messenger.messages.continueList(page.id);
    }
  }
}

function buildFolderCommands(entries) {
  return entries.map(e => ({
    id: `goto-folder:${e.folder.id}`,
    label: `Go to: ${e.displayName}`,
    // Index where the folder name starts in `label`. The name is scored on
    // its own too, so typing "inbox" gets the prefix bonus on "Inbox".
    nameStart: "Go to: ".length,
    hint: e.breadcrumb,
    icon: e.icon,
    keywords: e.keywords,
    kind: "folder",
    // Filled in by loadUnreadCounts() after the first render.
    get badge() {
      return e.unread > 0 ? String(e.unread) : undefined;
    },
    run: () => switchToFolder(e.folder)
  }));
}

// Unread counts for the "Go to:" badges. Loaded after the palette is shown
// (one getFolderInfo per folder) so a large folder tree doesn't delay opening;
// the list re-renders once counts arrive. Capped to keep it cheap.
const UNREAD_COUNT_LIMIT = 500;

async function loadUnreadCounts(entries) {
  if (typeof messenger.folders?.getFolderInfo !== "function") return;
  await Promise.all(entries.slice(0, UNREAD_COUNT_LIMIT).map(async (e) => {
    if (e.folder.isVirtual) return; // saved searches: counting re-runs the search
    try {
      e.unread = (await messenger.folders.getFolderInfo(e.folder.id)).unreadMessageCount || 0;
    } catch {
      // Folder may be gone or unavailable (offline IMAP); leave it blank.
    }
  }));
}

// Actions on the folder shown in the current mail tab.
function displayedFolder() {
  return ctx.mailTab?.displayedFolder || null;
}

function currentFolderCommands() {
  return [
    {
      id: "folder-mark-read",
      label: "Mark Folder as Read",
      get hint() {
        return displayedFolder()?.name;
      },
      icon: "●",
      keywords: "mark all read folder catch up",
      requires: "mailTab",
      run: () => messenger.folders.markAsRead(displayedFolder().id)
    },
    {
      id: "folder-toggle-favorite",
      get label() {
        return displayedFolder()?.isFavorite ? "Remove Folder from Favorites" : "Add Folder to Favorites";
      },
      get hint() {
        return displayedFolder()?.name;
      },
      icon: "☆",
      keywords: "favorite favourite star pin folder",
      requires: "mailTab",
      run: () => messenger.folders.update(displayedFolder().id, { isFavorite: !displayedFolder().isFavorite })
    }
  ];
}

// "Go to: Unified <folder>" commands. folders.getUnifiedFolder (TB 127+)
// returns the cross-account aggregate for a special-use type; these have no
// accountId and aren't part of any account's folder tree. Types are the ones
// getUnifiedFolder documents, in the order they're listed in the palette.
const UNIFIED_TYPES = [
  { type: "inbox", name: "Inbox", keywords: "all inboxes combined" },
  { type: "drafts", name: "Drafts", keywords: "" },
  { type: "sent", name: "Sent", keywords: "outgoing" },
  { type: "archives", name: "Archives", keywords: "archive" },
  { type: "templates", name: "Templates", keywords: "" },
  { type: "junk", name: "Junk", keywords: "spam" },
  { type: "trash", name: "Trash", keywords: "deleted bin" }
];

async function buildUnifiedCommands() {
  if (typeof messenger.folders?.getUnifiedFolder !== "function") return [];
  const results = await Promise.all(UNIFIED_TYPES.map(async (u) => {
    try {
      return { ...u, folder: await messenger.folders.getUnifiedFolder(u.type) };
    } catch (e) {
      // One unavailable type shouldn't hide the others.
      console.warn(`[palette] getUnifiedFolder(${u.type}) failed`, e);
      return { ...u, folder: null };
    }
  }));
  return results
    .filter(r => r.folder)
    .map(({ type, name, keywords, folder }) => ({
      // Stable id for MRU: unified folder ids are only valid per-session.
      id: `goto-unified-${type}`,
      label: `Go to: Unified ${name}`,
      nameStart: "Go to: ".length,
      hint: "All accounts",
      icon: specialIcon([type]),
      keywords: `unified all accounts smart ${type} ${keywords}`,
      kind: "folder",
      run: () => switchToFolder(folder, { retryProps: { folderMode: "unified" } })
    }));
}

registerCommands(() => [
  {
    id: "empty-trash-all",
    label: "Empty Trash (All Accounts)",
    hint: "permanent",
    icon: "✕",
    destructive: true,
    run: emptyTrashAllAccounts
  }
]);
registerCommands(() => buildUnifiedCommands());
registerCommands(() => currentFolderCommands().filter(() => displayedFolder()));
registerCommands(() => {
  loadUnreadCounts(folderEntries).then(() => render());
  return buildFolderCommands(folderEntries);
});
