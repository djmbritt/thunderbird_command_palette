// Tag commands: "Tag with…" picker, "Remove All Tags", and "Go to Tag: X".
//
// Loaded after popup/palette.js (core); see the Command registry there.
// Tags are identified by `key` (stored on messages); `tag` is the display
// name. messages.tags.list needs the messagesTagsList permission.

async function listTags() {
  if (typeof messenger.messages?.tags?.list !== "function") return [];
  const tags = await messenger.messages.tags.list();
  // Thunderbird's own order: by ordinal if set, else by name.
  return tags.sort((a, b) =>
    (a.ordinal || "").localeCompare(b.ordinal || "") || a.tag.localeCompare(b.tag));
}

// One picker item per tag. Enter toggles the tag on the whole selection:
// if every selected message has it, remove it; otherwise add it to all.
/** @returns {Promise<PickerSpec>} */
async function tagPicker() {
  const tags = await listTags();
  const selected = ctx.selectedMessages;
  const n = selected.length;
  return {
    title: `Tag ${selectionText()}…`,
    placeholder: "Type a tag name…",
    empty: tags.length ? "No matching tags." : "No tags defined.",
    items: tags.map((t) => {
      const count = selected.filter(m => (m.tags || []).includes(t.key)).length;
      const onAll = count === n;
      return {
        id: `tag-with:${t.key}`,
        label: t.tag,
        icon: "●",
        iconColor: t.color,
        hint: onAll ? "✓ applied · Enter removes" : count > 0 ? `on ${count} of ${n}` : undefined,
        keywords: t.key,
        run: () => Promise.all(selected.map((m) => {
          const current = m.tags || [];
          const next = onAll
            ? current.filter(k => k !== t.key)
            : current.includes(t.key) ? current : [...current, t.key];
          return messenger.messages.update(m.id, { tags: next });
        }))
      };
    })
  };
}

// "Go to Tag: X" opens the virtual tag folder (folders.getTagFolder, TB 127+),
// retrying with the Tags folder mode if the plain update is rejected.
/**
 * @param {messenger.messages.tags.MessageTag[]} tags
 * @returns {Command[]}
 */
function goToTagCommands(tags) {
  if (typeof messenger.folders?.getTagFolder !== "function") return [];
  return tags.map(t => ({
    id: `goto-tag:${t.key}`,
    label: `Go to Tag: ${t.tag}`,
    nameStart: "Go to Tag: ".length,
    icon: "●",
    iconColor: t.color,
    keywords: `tag label ${t.key}`,
    kind: "tag",
    run: async () => {
      const folder = await messenger.folders.getTagFolder(t.key);
      await switchToFolder(folder, { retryProps: { folderMode: "tags" } });
    }
  }));
}

registerCommands(async () => {
  /** @type {messenger.messages.tags.MessageTag[]} */
  let tags = [];
  try {
    tags = await listTags();
  } catch (e) {
    console.warn("[palette] tags unavailable", e);
  }
  return [
    {
      id: "tag-with",
      label: "Tag with…",
      icon: "●",
      keywords: "tag label add remove toggle",
      requires: "message",
      picker: tagPicker
    },
    {
      id: "tags-remove-all",
      label: "Remove All Tags",
      icon: "○",
      keywords: "tag label clear untag",
      requires: "message",
      run: () => updateSelected({ tags: [] })
    },
    ...goToTagCommands(tags)
  ];
}, { deferred: true }); // messages.tags.list is a round trip; not needed for first paint
