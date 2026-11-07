// Message commands: compose, reply, forward, mark, junk, archive, move/copy, delete.
//
// Loaded after popup/palette.js (core); see the Command registry there.

// Mark selected messages as junk (trains the junk filter), then move them to
// the Junk folder of the account each message belongs to. messages.update
// only sets the flag, so the move is done explicitly. Messages already in
// their Junk folder stay put; accounts without a Junk folder are only flagged.
async function markAsJunkAndMove() {
  await updateSelected({ junk: true });

  const byAccount = new Map();
  for (const m of ctx.selectedMessages) {
    const accountId = m.folder?.accountId;
    if (!accountId) continue;
    if (!byAccount.has(accountId)) byAccount.set(accountId, []);
    byAccount.get(accountId).push(m);
  }

  await Promise.all([...byAccount].map(async ([accountId, msgs]) => {
    const [junkFolder] = await messenger.folders.query({ accountId, specialUse: ["junk"] });
    if (!junkFolder) {
      console.warn(`[palette] account ${accountId} has no Junk folder; marked as junk without moving`);
      return;
    }
    const ids = msgs.filter(m => m.folder.id !== junkFolder.id).map(m => m.id);
    if (ids.length > 0) await messenger.messages.move(ids, junkFolder.id);
  }));
}

registerCommands(() => [
  {
    id: "compose-new",
    label: "Compose: New Message",
    hint: "Ctrl+N",
    icon: "✎",
    run: () => messenger.compose.beginNew()
  },
  {
    id: "reply",
    label: "Reply",
    icon: "↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToSender")
  },
  {
    id: "reply-all",
    label: "Reply All",
    icon: "↩↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToAll")
  },
  {
    id: "reply-list",
    label: "Reply to List",
    icon: "↩",
    requires: "message",
    run: () => messenger.compose.beginReply(firstSelectedId(), "replyToList")
  },
  {
    id: "forward-inline",
    label: "Forward (Inline)",
    icon: "→",
    requires: "message",
    run: () => messenger.compose.beginForward(firstSelectedId(), "forwardInline")
  },
  {
    id: "forward-attach",
    label: "Forward as Attachment",
    icon: "→",
    requires: "message",
    run: () => messenger.compose.beginForward(firstSelectedId(), "forwardAsAttachment")
  },
  {
    id: "mark-read",
    label: "Mark as Read",
    icon: "●",
    requires: "message",
    run: () => updateSelected({ read: true })
  },
  {
    id: "mark-unread",
    label: "Mark as Unread",
    icon: "○",
    requires: "message",
    run: () => updateSelected({ read: false })
  },
  {
    id: "toggle-flag",
    label: "Toggle Star / Flag",
    icon: "★",
    requires: "message",
    // Mixed selection: flag all if any are unflagged, else unflag all
    // (per-message flipping would leave a mixed selection still mixed).
    run: () => updateSelected({ flagged: ctx.selectedMessages.some(m => !m.flagged) })
  },
  {
    id: "mark-junk",
    label: "Mark as Junk",
    icon: "⚠",
    keywords: "spam",
    requires: "message",
    run: markAsJunkAndMove
  },
  {
    id: "mark-not-junk",
    label: "Mark as Not Junk",
    icon: "✓",
    keywords: "spam ham legitimate",
    requires: "message",
    run: () => updateSelected({ junk: false })
  },
  {
    id: "archive",
    label: "Archive",
    icon: "▣",
    requires: "message",
    run: () => messenger.messages.archive(ctx.selectedMessages.map(m => m.id))
  },
  {
    id: "move-to",
    label: "Move to Folder…",
    icon: "⇥",
    keywords: "file",
    requires: "message",
    picker: () => ({
      title: `Move ${selectionText()} to…`,
      empty: "No matching folders.",
      placeholder: "Type a folder name…",
      items: destinationItems("move", (ids, f) => messenger.messages.move(ids, f), { excludeSource: true })
    })
  },
  {
    id: "copy-to",
    label: "Copy to Folder…",
    icon: "⧉",
    keywords: "duplicate",
    requires: "message",
    picker: () => ({
      title: `Copy ${selectionText()} to…`,
      empty: "No matching folders.",
      placeholder: "Type a folder name…",
      items: destinationItems("copy", (ids, f) => messenger.messages.copy(ids, f), { excludeSource: false })
    })
  },
  {
    id: "delete",
    label: "Delete (Move to Trash)",
    icon: "✕",
    requires: "message",
    destructive: true,
    run: () => messenger.messages.delete(ctx.selectedMessages.map(m => m.id))
  }
]);
