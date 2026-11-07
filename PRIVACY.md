# Privacy Policy — Command Palette for Thunderbird

Last updated: 2026-11-07

**Command Palette does not collect, transmit or share any data.** It has no network access of its own, sends nothing to the developer or to anyone else, and contains no analytics or tracking.

## What it accesses, and why

The add-on reads your Thunderbird data only to carry out the command you choose, at the moment you choose it:

- **Accounts and folders**: to list folders for *Go to*, *Move to Folder…* and *Copy to Folder…*, and to find each account's Junk and Trash folders.
- **Selected or displayed messages**: so commands such as *Reply*, *Archive*, *Mark as Read*, *Tag with…* and *Delete* act on them.
- **Message search**: the `?` prefix searches message subjects and senders with Thunderbird's own search. Results are shown in the palette and are not stored.
- **Address books**: to list contacts for *Write to…*.
- **Open tabs**: to list tab titles for *Switch to Tab…*.
- **Compose windows**: to read and change the sending identity, priority and receipt options of the message you're writing, and to send it later or save it.
- **Tags**: to list your tags for *Tag with…* and *Go to Tag*.
- **Notifications**: to confirm actions whose result isn't visible, such as moving messages.
- **Other add-ons**: to list the names and keyboard-shortcut commands of your other installed add-ons (and their toolbar buttons), so you can run them from the palette. The add-on only runs one when you choose it.

All of this happens inside Thunderbird on your computer.

## What it stores

The add-on stores a small amount of data locally, in Thunderbird's extension storage on your computer:

- the identifiers of the commands you used most recently (up to 50), so they can be listed first; for *Move to* and *Copy to* this includes the destination folder's identifier;
- the Thunderbird font size from the last time the palette opened, so it opens at the right size;
- only if you turn on *Debug: Startup Timing*: timing measurements of the palette opening (the last 10), which you can copy to the clipboard yourself. *Debug: Turn Off Startup Timing* deletes them.

This data never leaves your computer. Removing the add-on removes it.

## Privileged access

Some commands (Get New Mail, Undo/Redo, Print, View Source, Compact Folders, Expand/Collapse Threads, the Today pane, opening Calendar/Tasks/Chat, Settings, Account Settings, Add-ons and Themes, and other add-ons' commands) use a small built-in "experiment" API, because Thunderbird doesn't offer these to add-ons otherwise. Because of it, Thunderbird asks you to grant the add-on full access. The experiment code only performs that fixed list of actions and does not read or send any data. It is in `experiments/implementation.js` in the [source code](https://github.com/djmbritt/thunderbird_command_palette).

## Contact

Questions: open an issue at <https://github.com/djmbritt/thunderbird_command_palette/issues>.
