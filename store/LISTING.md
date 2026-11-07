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

Plain text, pasted as is:

```
Plain HTML/CSS/JS, no build step, nothing minified or generated. Source: https://github.com/djmbritt/thunderbird_command_palette (dev-only tooling there is excluded from the .xpi). Tested on Thunderbird 158 with end-to-end tests.

How to test: press Ctrl+Shift+P (or click the toolbar button), type to filter, Enter to run, Esc to close. Message commands appear when a message is selected; compose commands when opened from a compose window. Prefixes: @ folders, # tags, ? message search. Delete, Empty Trash and Send Later need Enter twice. Local Folders is enough to test most commands.

Why an Experiment (experiments/implementation.js): each function covers something no MailExtension API provides:
- getNewMail: trigger Get New Messages.
- openSettings / openAccountSettings: open Thunderbird's Settings and Account Settings.
- runCommand: only an allowlist of built-in commands (undo, redo, compact, expand/collapse threads, print, view source); anything else is rejected.
- toggleTodayPane: show/hide the Today pane.
- openSpace: open a built-in space (allowlisted); spaces.open only opens the extension's own spaces.
- getUIFontSize: read mail.uifontsize so the popup matches Thunderbird's font size.
It reads only that one preference, writes none, and makes no network requests of its own. Every function is feature-detected, so the add-on still works if the experiment fails to load.
```

## Screenshots

In `store/screenshots/` (1280×800), taken from a throwaway Thunderbird with demo mail by `python3 e2e/screenshots.py` (Hyprland + grim; rerun after UI changes):

1. `1-recent-commands.png`: the palette with an empty query (recent commands first).
2. `2-fuzzy-search.png`: fuzzy search, typing "arch".
3. `3-move-to-folder.png`: the Move to Folder… picker.
4. `4-message-search.png`: `?invoice` message search.
5. `5-dark-theme.png`: dark theme, typing "tag".
