# addons.thunderbird.net listing

Text to paste into the ATN listing and submission forms. Not shipped in the
.xpi. Keep it in sync with README.md (features) and PRIVACY.md.

- **Add-on ID** (manifest, immutable once published): `command-palette@djmbritt.github.io`
- **Name:** Command Palette
- **Categories:** pick the closest available, e.g. Message and News Reading / Productivity / Miscellaneous
- **License:** MIT
- **Homepage:** https://github.com/djmbritt/thunderbird_command_palette
- **Support:** https://github.com/djmbritt/thunderbird_command_palette/issues
- **Privacy policy:** paste the full text of PRIVACY.md (ATN doesn't accept a link)
- **Screenshots:** still to take; see the list at the end

## Summary

(Short text shown in search results; ATN's limit is 250 characters.)

> A VS Code-style command palette for Thunderbird. Press Ctrl+Shift+P, type a few letters, press Enter: reply, archive, move or tag messages, jump to any folder, change the view, compose, search, and more without the mouse.

## Description

> Press **Ctrl+Shift+P** (**⌘+Shift+P** on macOS), type a few letters, and press **Enter**. Command Palette works like the command palette in VS Code: one keyboard shortcut for almost everything in Thunderbird.
>
> **What you can do**
> - **Messages:** reply, reply all, reply to list, forward; mark read or unread, star, mark as junk (and move to Junk); archive, delete, open in a tab or window, print, view source.
> - **Move / Copy to Folder…** by typing part of the folder name. Recent destinations come first.
> - **Folders:** go to any folder or unified folder (Unified Inbox, Sent, …); mark a folder as read, add it to favourites, compact folders, empty trash.
> - **Tags:** tag the selection, remove all tags, go to a tag.
> - **View:** quick filters, sort by any column, threaded or unthreaded, show or hide the folder and message panes, Classic / Wide / Vertical layout.
> - **Navigation:** switch to any open tab, write to a contact, open Calendar, Tasks, Chat or the Address Book, toggle the Today pane.
> - **While composing:** Send Later, save as draft or template, change the sending identity, set priority, request receipts.
> - **Undo / Redo**, Get New Mail, Settings and Account Settings.
>
> **Fast to use**
> - Fuzzy search: "gtp" finds "Go to: Projects", "arch" finds "Archive".
> - Recently used commands are listed first.
> - Prefixes narrow the list: `>` commands, `@` folders, `#` tags, `?` search messages by subject or sender.
> - Commands that can't easily be undone (Delete, Empty Trash, Send Later) ask you to press Enter twice.
> - Optional extra shortcuts for Move to Folder…, Tag with…, Switch to Tab…, Write to…, Go to Folder, Search Messages and Repeat Last Command (set them under Add-ons → ⚙ → Manage Extension Shortcuts).
> - Follows Thunderbird's light/dark theme and font size.
>
> **Privacy:** Command Palette collects nothing and sends nothing anywhere; it has no network access of its own. It reads your accounts, folders, messages, contacts and tabs only to run the command you pick, inside Thunderbird. It stores only your recently used commands and the UI font size, locally. See the privacy policy for details.
>
> **Full access:** a few commands (Get New Mail, Undo/Redo, Print, View Source, Compact Folders, Expand/Collapse Threads, Today pane, Calendar/Tasks/Chat, Settings) need Thunderbird features that add-ons can't otherwise reach, so the add-on includes a small "experiment" and Thunderbird asks for full access. That code only performs that fixed list of actions.
>
> Requires Thunderbird 128 to 160 (raised as new Thunderbird versions are tested). Open source (MIT): https://github.com/djmbritt/thunderbird_command_palette

## Notes to reviewer

> **No build step.** The submitted files are the source: plain HTML, CSS and JavaScript, not minified or generated. The GitHub repository additionally contains dev-only tooling (tests, TypeScript type checking, a type generator) that is excluded from the .xpi by `package.sh`.
>
> **How to test**
> 1. Press Ctrl+Shift+P in the main window (or click the toolbar button). The palette opens as the toolbar button's popup.
> 2. Type to filter, ↑/↓ to move, Enter to run, Esc to close. Try "reply", "archive", "go to inbox", "sort", "layout".
> 3. Message commands only appear when a message is selected. Compose commands (Send Later, Send from…, Set Priority…) only appear when the palette is opened from a compose window.
> 4. Pickers: "Move to Folder…", "Tag with…", "Switch to Tab…", "Write to…" open a sub-list; Esc goes back.
> 5. Prefixes: `@` folders, `#` tags, `?` message search (e.g. `?invoice`), `>` commands only.
> 6. Delete, Empty Trash and Send Later need Enter twice.
> No accounts or credentials are needed beyond any mail account (Local Folders is enough for most commands).
>
> **Why an Experiment API** (`experiments/implementation.js`, `messenger.palette.*`). Each function covers something no built-in MailExtension API provides:
> - `getNewMail(accountId?)`: trigger Get New Messages (all accounts via `cmd_getMsgsForAuthAccounts`, or one account's incoming server). There is no WebExtension API to fetch mail.
> - `openSettings()` / `openAccountSettings(accountId?)`: open Thunderbird's own Settings tab and Account Settings. `runtime.openOptionsPage` only opens an add-on's own options.
> - `runCommand(command)`: dispatch one of a fixed allowlist of built-in commands (`ALLOWED_COMMANDS`): cmd_undo, cmd_redo, cmd_compactFolder, cmd_expandAllThreads, cmd_collapseAllThreads, cmd_print, cmd_viewPageSource. Any other id is rejected. There are no WebExtension APIs for undo/redo, compacting, expanding/collapsing threads, printing a message or Thunderbird's source view.
> - `toggleTodayPane()`: show/hide the calendar Today pane. No API exists.
> - `openSpace(name)`: open a built-in space (allowlist: mail, addressbook, calendar, tasks, chat, settings). The `spaces.open` API only opens spaces created by the calling extension.
> - `getUIFontSize()`: read Thunderbird's UI font size (`mail.uifontsize`) so the popup matches it. No API exposes it.
>
> The experiment only reads the one font-size preference, never writes preferences, and makes no network requests of its own (Get New Mail asks Thunderbird to check mail as its toolbar button does). If it fails to load, the popup hides these commands and everything else keeps working (each function is feature-detected).
>
> **Permissions:** each permission and what it's used for is listed in the privacy policy; none are requested for future use.

## Screenshots

In `store/screenshots/` (1280×800), taken from a throwaway Thunderbird with demo mail by `python3 e2e/screenshots.py` (Hyprland + grim; rerun after UI changes):

1. `1-recent-commands.png`: the palette with an empty query (recent commands first).
2. `2-fuzzy-search.png`: fuzzy search, typing "arch".
3. `3-move-to-folder.png`: the Move to Folder… picker.
4. `4-message-search.png`: `?invoice` message search.
5. `5-dark-theme.png`: dark theme, typing "tag".
