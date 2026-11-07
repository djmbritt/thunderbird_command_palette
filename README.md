# Thunderbird Command Palette

The missing command palette for Thunderbird. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> (<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on macOS), type a few letters, and press <kbd>Enter</kbd>. It works like the command palette in VS Code. You can reply, archive, move messages, jump to folders, change the view, compose, search, and more without touching the mouse.

## Features

- **Fuzzy search** over every command and folder. Recently used commands are listed first.
- **Messages:**
  - reply, reply all, reply to list, forward;
  - mark read or unread, star, mark as junk (also moves to Junk);
  - archive, delete, open in a new tab or window, print, view source.
- **Move / Copy to Folder…** Pick a destination by typing part of its name. Recent destinations come first.
- **Folders:**
  - *Go to* any folder, or a unified folder (Unified Inbox, Sent, …);
  - mark a folder as read, add it to favourites, compact folders, empty trash.
- **Tags:** *Tag with…* toggles a tag on the selection, plus *Remove All Tags* and *Go to Tag*.
- **View:**
  - quick filters (unread, starred, attachments, contacts, tagged);
  - sort by any column, threaded or unthreaded view;
  - show or hide the folder and message panes, Classic / Wide / Vertical layout.
- **Navigation:** *Switch to Tab…*, *Write to…* a contact, open Calendar / Tasks / Chat / Address Book, toggle the Today pane.
- **In a compose window:** Send Later, Save as Draft or Template, *Send from…* another identity, set priority, request return or delivery receipts.
- **Undo / Redo**, Get New Mail, and quick access to Settings and Account Settings.
- Follows Thunderbird's **light/dark theme** and **font size**.

## Using it

| Key | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Open the palette |
| <kbd>↑</kbd> <kbd>↓</kbd> | Move the selection |
| <kbd>Enter</kbd> | Run the selected command |
| <kbd>Esc</kbd> | Close, or go back from a sub-list like *Move to Folder…* |

Start your search with a prefix to narrow it down:

| Prefix | Shows | Example |
|---|---|---|
| `>` | commands only | `>sort` |
| `@` | folders only | `@inbox` |
| `#` | tags only | `#work` |
| `?` | search messages by subject or sender | `?invoice` |

Commands that can't be undone easily (*Delete*, *Empty Trash*, *Send Later*) ask you to press <kbd>Enter</kbd> a second time. They never move to the top of the list on their own.

### Extra shortcuts

You can bind keys directly to *Repeat Last Command*, *Move to Folder…*, *Tag with…*, *Switch to Tab…*, *Write to…*, *Go to Folder* (`@`) and *Search Messages* (`?`). They have no default keys, so they never clash with Thunderbird's own. To set them, go to **Add-ons and Themes → ⚙ → Manage Extension Shortcuts**, or run *Configure Keyboard Shortcuts* from the palette.

These shortcuts open the palette through its toolbar button, so keep the button on the toolbar.

## Install

Requires **Thunderbird 128 or newer**.

### Try it without installing

1. Open **Tools → Add-ons and Themes**, click **⚙ → Debug Add-ons**.
2. Click **Load Temporary Add-on…** and choose `manifest.json` from this folder.

A temporary add-on is removed when Thunderbird quits.

### Install permanently

```bash
./package.sh
```

This builds `../command-palette-<version>.xpi`. Install it via **Add-ons and Themes → ⚙ → Install Add-on From File…**.

## Permissions

The add-on asks for access to your accounts, folders, messages, tags, address books, compose windows and tabs, plus storage and notifications. It only uses them to carry out the commands you run. The add-on has no network access of its own and sends no data anywhere.

Some commands (Undo, Print, Today pane, Calendar/Tasks/Chat, Get New Mail, Settings) need Thunderbird features that add-ons can't normally reach. They're provided by a small privileged "experiment" in `experiments/` that only allows a fixed list of actions. If it can't load, those commands are hidden and everything else still works.

## Development

There's no build step: plain HTML, CSS and JavaScript.

```bash
node --test tests/   # run the tests (Node 18+, no dependencies)
```

After loading the add-on temporarily, click **Reload** on the Debug Add-ons page after each change. [`CLAUDE.md`](CLAUDE.md) covers the architecture, how to add a command, and debugging tips.

## TODO

- [x] add an icon
- [ ] verify in Thunderbird: Filter: Clear, Write to…, Calendar/Tasks/Chat, Today pane, Undo, Print, View Source, and the extra shortcuts
- [ ] check that Undo can undo moves made from the palette
