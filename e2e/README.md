# End-to-end tests in a real Thunderbird

`npm run test:e2e` (or `python3 e2e/run.py [name-filter…] [--keep-open]`) runs the palette inside a real Thunderbird. It needs `thunderbird` on the PATH and Python 3, with no other dependencies. A Thunderbird window opens while the tests run.

**Your profile is never touched.** The runner creates a throwaway profile in a temporary directory (`make-profile.sh`): one Local Folders account with three test messages and no first-run dialogs. The add-on is loaded straight from the working tree through an extension proxy file, so there's nothing to package first. It starts a separate instance (`--new-instance`) with Marionette, Gecko's built-in remote-control protocol, on port 28290.

**How it drives the palette.** From privileged ("chrome") JavaScript sent over Marionette (`marionette.py` is a minimal client):
- *Ctrl+Shift+P*: fires the add-on's own `<key>` element, the same thing the keyboard shortcut does.
- *Per-action shortcuts*: `extension.shortcuts.onCommand(name)`, as Thunderbird dispatches them.
- *Typing and keys inside the popup*: a frame script loaded into the popup's browser sets the query, dispatches `keydown` events, and reports the rows, banner and empty text.
- Effects are checked in Thunderbird itself: quick-filter state and listed rows, current space, Today pane visibility, folder contents after move and undo, the view-source window, the print preview, the compose window's recipients.

`--keep-open` leaves Thunderbird running after the tests, for poking at it over Marionette. The profile and `thunderbird.log` (console output, including the popup's) are in the temporary directory the runner prints. Set `E2E_TMPDIR` to choose where that goes.

It tests the installed Thunderbird version only (currently 158). Commands that depend on the version (`isUserAction`, the `messages.delete` options) also have unit tests for the 128 behaviour.
