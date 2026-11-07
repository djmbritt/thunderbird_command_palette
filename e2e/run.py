#!/usr/bin/env python3
"""End-to-end tests in a real Thunderbird (see e2e/README.md).

Starts a separate Thunderbird instance with a throwaway profile
(e2e/make-profile.sh), opens the palette exactly as the keyboard shortcut
does, types and presses keys inside it, and checks the effect in
Thunderbird. Your own profile is never touched.

    python3 e2e/run.py [--keep-open] [test-name-substring ...]
"""

import os
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from marionette import Marionette, MarionetteError  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EXT_ID = "command-palette@djmbritt.github.io"
PORT = 28290

# Chrome-side helpers, prepended to every script.
PRELUDE = r"""
const EXT_ID = "command-palette@djmbritt.github.io";
const W = () => Services.wm.getMostRecentWindow("mail:3pane");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what = "condition", ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ""}`);
}
const about3 = () => W().gTabmail.currentAbout3Pane;
const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
const ext = () => ExtensionParent.GlobalManager.getExtension(EXT_ID);
const local = () => MailServices.accounts.localFoldersServer.rootFolder;
const folder = name => local().getChildNamed(name);
const subjects = f => [...f.messages].map(h => h.mime2DecodedSubject).sort();

function paletteBrowser() {
  return [...W().document.querySelectorAll("browser")].find(b =>
    String(b.currentURI?.spec).endsWith("/popup/palette.html") && b.closest("panel")?.state === "open");
}

// Drive the palette page through a frame script (it runs in the extension
// process). Ops: read, type <text>, key <key>.
const FRAME_SCRIPT = `
addMessageListener("e2e:do", ({ data }) => {
  const doc = content.document;
  const q = doc.getElementById("query");
  if (data.op === "type") { q.value = data.arg; q.dispatchEvent(new content.Event("input")); }
  if (data.op === "key") q.dispatchEvent(new content.KeyboardEvent("keydown", { key: data.arg, bubbles: true, cancelable: true }));
  // Ignore the real mouse pointer (screenshots: no stray hover highlight).
  // Re-filtering also resets a selection the pointer made on the way.
  if (data.op === "nohover") {
    doc.getElementById("results").style.pointerEvents = "none";
    q.dispatchEvent(new content.Event("input"));
  }
  const shown = id => (doc.getElementById(id).hidden ? null : doc.getElementById(id).textContent);
  sendAsyncMessage("e2e:done", {
    query: q.value,
    rows: [...doc.querySelectorAll("#results li")].map(li => ({
      label: li.querySelector(".row-label")?.textContent,
      hint: li.querySelector(".row-hint")?.textContent || "",
      selected: li.classList.contains("selected"),
    })),
    mode: shown("mode"),
    empty: shown("empty"),
  });
});`;

async function palette(op = "read", arg = null) {
  const b = await until(paletteBrowser, "the palette to be open");
  if (!b._e2eLoaded) {
    b.messageManager.loadFrameScript("data:application/javascript," + encodeURIComponent(FRAME_SCRIPT), false);
    b._e2eLoaded = true;
  }
  let listener;
  const reply = new Promise(resolve => {
    listener = msg => resolve(msg.data);
    b.messageManager.addMessageListener("e2e:done", listener);
    b.messageManager.sendAsyncMessage("e2e:do", { op, arg });
  });
  // A key that closes the popup (Enter, Escape) can take the reply with it.
  const closed = (async () => {
    while (paletteBrowser() === b) await sleep(50);
    return { closed: true, rows: [], query: null, mode: null, empty: null };
  })();
  try {
    return await Promise.race([reply, closed]);
  } finally {
    b.messageManager?.removeMessageListener("e2e:done", listener); // gone once the popup closed
  }
}

// Open the palette the way Ctrl+Shift+P does, and wait for the deferred
// commands (tags, unified folders) so the list is complete.
async function openPalette() {
  await until(() => !paletteBrowser(), "a previous palette to close");
  W().focus();
  W().document.querySelector(`#ext-keyset-id-${EXT_ID.replace(/[^a-z0-9_-]/gi, "_")} > key`).doCommand();
  await until(async () => (await palette()).rows.some(r => r.label?.startsWith("Go to Tag:")), "the palette to finish loading");
  return palette();
}

// Per-action shortcut (palette-*), as Thunderbird dispatches it.
async function shortcut(name) {
  await until(() => !paletteBrowser(), "a previous palette to close");
  W().focus();
  ext().shortcuts.onCommand(name);
  await until(paletteBrowser, `the palette to open for ${name}`);
  await sleep(600); // pending action is applied after the deferred commands
  return palette();
}

// Open the palette, type `query`, check the top row is `expect`, press Enter,
// and wait for the popup to close.
async function run(query, expect = query) {
  await openPalette();
  const state = await palette("type", query);
  const top = state.rows[0]?.label;
  if (top !== expect) throw new Error(`top row for "${query}" is "${top}", expected "${expect}" (rows: ${state.rows.slice(0, 5).map(r => r.label).join(" | ")})`);
  await palette("key", "Enter");
  await until(() => !paletteBrowser(), `the palette to close after "${expect}"`);
}

async function showInbox(selectSubject = null) {
  const a3 = about3();
  a3.displayFolder(folder("Inbox"));
  await until(() => a3.gFolder?.URI === folder("Inbox").URI && a3.gDBView?.rowCount > 0, "the Inbox to be shown");
  if (selectSubject) {
    const view = a3.gDBView;
    let row = -1;
    for (let i = 0; i < view.rowCount; i++) {
      if (view.getMsgHdrAt(i).mime2DecodedSubject === selectSubject) row = i;
    }
    if (row === -1) throw new Error(`no message "${selectSubject}" in the Inbox`);
    a3.threadTree.selectedIndex = row;
    await until(() => a3.gDBView.getSelectedMsgHdrs().length === 1, "the message to be selected");
  }
}
"""


class Thunderbird:
    def __init__(self, profile, log_path, prepare=None):
        """`prepare(profile)` may add to the profile before Thunderbird starts."""
        self.log_path = log_path
        self.profile = profile
        subprocess.run([str(ROOT / "e2e/make-profile.sh"), str(profile)], check=True, stdout=subprocess.DEVNULL)
        if prepare:
            prepare(Path(profile))
        self.log = open(log_path, "w")
        self.proc = subprocess.Popen(
            ["thunderbird", "--profile", str(profile), "--new-instance", "--marionette", "--remote-allow-system-access"],
            stdout=self.log, stderr=subprocess.STDOUT)
        self.m = Marionette(PORT)
        self.m.start()
        self.js("await until(() => W()?.gTabmail?.currentAbout3Pane?.gFolder, 'the main window', 30000); await sleep(1500);")

    def js(self, script, *args, timeout_ms=30000):
        return self.m.js(PRELUDE + "\n" + script, *args, timeout_ms=timeout_ms)

    def log_text(self):
        self.log.flush()
        return Path(self.log_path).read_text(errors="replace")

    def quit(self):
        self.m.quit()
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.proc.kill()


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


# ---------------------------------------------------------------- tests ----

@test
def quick_filter_unread_then_clear(tb):
    tb.js("""
      await showInbox();
      await run("filter unread", "Filter: Unread");
      const qfb = about3().quickFilterBar;
      await until(() => qfb.filterer.filterValues.unread === true, "the Unread filter to be on");
      if (!qfb.filterer.visible) throw new Error("quick filter bar not shown");
      await run("filter clear", "Filter: Clear");
      // Every message is listed again (no filter left behind, inverted or not).
      const total = folder("Inbox").getTotalMessages(false);
      await until(() => !qfb.filterer.filterValues.unread && about3().gDBView.rowCount === total,
        `all ${total} messages to be listed after Filter: Clear (listed: ${about3().gDBView?.rowCount})`);
    """)


@test
def go_to_tag(tb):
    return tb.js("""
      await run("go to tag important", "Go to Tag: Important");
      const a3 = about3();
      await until(() => a3.gFolder?.URI?.includes("tag") || a3.gFolder?.getFlag?.(Ci.nsMsgFolderFlags.Virtual), "a tag folder to be shown");
      return { folder: a3.gFolder.URI, name: a3.gFolder.prettyName, modes: a3.folderPane.activeModes };
    """)


@test
def spaces_calendar_tasks_chat(tb):
    return tb.js("""
      // Each command is run from the previous space, so this also checks the
      // palette opens outside the mail space (manifest action.allowed_spaces).
      for (const [label, space] of [["Open Calendar", "calendar"], ["Open Tasks", "tasks"], ["Open Chat", "chat"]]) {
        await run(label.toLowerCase(), label);
        await until(() => W().gSpacesToolbar.currentSpace?.name === space, `the ${space} space`);
      }
      W().gTabmail.switchToTab(0);
      await until(() => W().gSpacesToolbar.currentSpace?.name === "mail", "back to mail");
    """)


@test
def today_pane_toggle(tb):
    return tb.js("""
      const panel = W().document.getElementById("today-pane-panel");
      const before = panel.isVisible();
      await run("toggle today pane", "Toggle Today Pane");
      await until(() => panel.isVisible() !== before, "the Today pane to toggle");
      await run("toggle today pane", "Toggle Today Pane");
      await until(() => panel.isVisible() === before, "the Today pane to toggle back");
      return { before };
    """)


@test
def move_then_undo(tb):
    tb.js("""
      await showInbox("Lunch plans");
      await openPalette();
      await palette("type", "move to folder");
      await palette("key", "Enter");
      const picker = await until(async () => { const s = await palette(); return s.mode ? s : null; }, "the Move picker");
      if (!/^Move 1 message to/.test(picker.mode)) throw new Error(`picker title: ${picker.mode}`);
      const s = await palette("type", "projects");
      if (s.rows[0]?.label !== "Projects") throw new Error(`top destination: ${s.rows[0]?.label}`);
      await palette("key", "Enter");
      await until(() => subjects(folder("Projects")).includes("Lunch plans"), "the message to reach Projects");
      await run("undo", "Undo");
      await until(() => subjects(folder("Inbox")).includes("Lunch plans") && !subjects(folder("Projects")).includes("Lunch plans"),
        "Undo to bring the message back to the Inbox");
    """)


@test
def view_source(tb):
    return tb.js("""
      await showInbox("Invoice March");
      const before = new Set([...Services.wm.getEnumerator(null)]);
      const tabsBefore = W().gTabmail.tabInfo.length;
      await run("view message source", "View Message Source");
      const opened = await until(() => {
        const w = [...Services.wm.getEnumerator(null)].find(w => !before.has(w));
        if (w) return { kind: "window", type: w.document.documentElement.getAttribute("windowtype"), url: String(w.location) };
        if (W().gTabmail.tabInfo.length > tabsBefore) {
          const t = W().gTabmail.tabInfo.at(-1);
          return { kind: "tab", url: String(t.browser?.currentURI?.spec) };
        }
        return null;
      }, "a source view to open");
      await sleep(500);
      for (const w of Services.wm.getEnumerator(null)) if (!before.has(w)) w.close();
      while (W().gTabmail.tabInfo.length > tabsBefore) W().gTabmail.closeTab(W().gTabmail.tabInfo.at(-1));
      return opened;
    """)


@test
def print_message(tb):
    return tb.js("""
      await showInbox("Invoice March");
      await run("print", "Print…");
      // Thunderbird's tab-modal print preview, with the print settings page.
      const settings = await until(() => W().document.querySelector("print-preview") &&
        W().document.querySelector(".printSettingsBrowser")?.contentDocument?.querySelector("#cancel-button"),
        "the print preview dialog");
      // Cancel once the preview has rendered (earlier clicks are ignored).
      await until(() => {
        settings.click();
        return !W().document.querySelector("print-preview");
      }, "the print preview to close", 15000);
    """)


@test
def message_search_ignores_case(tb):
    return tb.js("""
      // Thunderbird matches subjects case-sensitively; "?invoice" must still
      // find "Invoice March".
      await openPalette();
      await palette("type", "?invoice");
      const s = await until(async () => { const s = await palette(); return s.rows.length ? s : null; }, "search results");
      if (s.rows[0].label !== "Invoice March") throw new Error(`results: ${s.rows.map(r => r.label).join(" | ")}`);
      paletteBrowser()?.closest("panel")?.hidePopup();
      await until(() => !paletteBrowser(), "the palette to close");
      return s.rows.map(r => r.label);
    """)


@test
def other_addon_commands(tb):
    tb.js("""
      await showInbox();
      // A shortcut command of another add-on (e2e/fixtures/test-addon).
      await run("e2e test add-on say hello", "E2E Test Add-on: Say hello");
      const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");
      const other = ExtensionParent.GlobalManager.getExtension("test-addon@e2e.example");
      const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(other));
      await until(async () => (await db.get("lastCommand")).lastCommand === "say-hello", "the test add-on to receive say-hello");
      // Its toolbar button: the palette closes first, then the button's popup opens.
      await run("e2e test add-on test button", "E2E Test Add-on: Test button");
      const popup = await until(() => [...W().document.querySelectorAll("browser")].find(b =>
        String(b.currentURI?.spec).endsWith("/popup.html") && b.closest("panel")?.state === "open"), "the test add-on's popup");
      popup.closest("panel").hidePopup();
    """)


@test
def write_to_contact(tb):
    return tb.js("""
      const dir = MailServices.ab.getDirectory("jsaddrbook://abook.sqlite");
      if (![...dir.childCards].some(c => c.primaryEmail === "dana@example.com")) {
        const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
        card.firstName = "Dana"; card.lastName = "Example"; card.displayName = "Dana Example";
        card.primaryEmail = "dana@example.com";
        dir.addCard(card);
      }
      await openPalette();
      await palette("type", "write to");
      await palette("key", "Enter");
      await until(async () => (await palette()).rows.length > 0, "the contacts to load");
      const s = await palette("type", "dana");
      if (!s.rows[0]?.label?.includes("Dana Example")) throw new Error(`top contact: ${s.rows[0]?.label}`);
      await palette("key", "Enter");
      const cw = await until(() => Services.wm.getMostRecentWindow("msgcompose"), "a compose window");
      await until(() => cw.document.readyState === "complete" && cw.gMsgCompose, "the compose window to load");
      const pills = await until(() => {
        const p = [...cw.document.querySelectorAll("mail-address-pill")].map(p => p.fullAddress || p.label);
        return p.length ? p : null;
      }, "a recipient pill");
      cw.gContentChanged = false;
      cw.ComposeCanClose = () => true;
      cw.close();
      return pills;
    """)


@test
def shortcuts(tb):
    return tb.js("""
      const results = {};
      async function check(name, expect) {
        const s = await shortcut(name);
        const got = expect(s);
        results[name] = got === true ? "ok" : got;
        // Close: Escape leaves a picker, a second Escape closes the popup.
        for (let i = 0; i < 3 && paletteBrowser(); i++) { await palette("key", "Escape"); await sleep(150); }
        await until(() => !paletteBrowser(), `the palette to close after ${name}`);
      }
      await showInbox("Project kickoff");
      await check("palette-move-to", s => /^Move 1 message to/.test(s.mode ?? "") || `mode=${s.mode}`);
      await check("palette-tag-with", s => (s.mode ?? "").startsWith("Tag") || `mode=${s.mode}`);
      await check("palette-switch-tab", s => s.mode === "Switch to tab…" || `mode=${s.mode}`);
      await check("palette-write-to", s => s.mode === "Write to…" || `mode=${s.mode}`);
      await check("palette-go-to-folder", s => (s.query === "@" && s.rows.every(r => r.label.startsWith("Go to"))) || `query=${s.query}`);
      await check("palette-search", s => s.query === "?" || `query=${s.query}`);

      // repeat-last re-runs the newest MRU command: run Filter: Unread, turn
      // the filter off behind the palette's back, then use the shortcut.
      await run("filter unread", "Filter: Unread");
      const qfb = about3().quickFilterBar;
      await until(() => qfb.filterer.filterValues.unread === true, "Unread on");
      qfb.filterer.filterValues.unread = null;
      W().focus();
      ext().shortcuts.onCommand("palette-repeat-last");
      await until(() => qfb.filterer.filterValues.unread === true, "repeat-last to re-run Filter: Unread");
      await until(() => !paletteBrowser(), "the palette to close after repeat-last");
      await run("filter clear", "Filter: Clear");
      results["palette-repeat-last"] = "ok";
      return results;
    """, timeout_ms=90000)


# ---------------------------------------------------------------- main ----

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep_open = "--keep-open" in sys.argv
    selected = [t for t in TESTS if not args or any(a in t.__name__ for a in args)]
    workdir = Path(tempfile.mkdtemp(prefix="palette-e2e-", dir=os.environ.get("E2E_TMPDIR")))
    tb = Thunderbird(workdir / "profile", workdir / "thunderbird.log")
    failed = 0
    try:
        for t in selected:
            log_before = len(tb.log_text())
            try:
                detail = t(tb)
                errors = [l for l in tb.log_text()[log_before:].splitlines()
                          if l.startswith("console.error") and ("Action failed" in l or "[palette]" in l)]
                status = "PASS" if not errors else "PASS (with logged errors)"
                print(f"{status}  {t.__name__}" + (f"  {detail}" if detail is not None else ""))
                for e in errors:
                    print(f"      log: {e}")
            except MarionetteError as e:
                failed += 1
                print(f"FAIL  {t.__name__}\n      {str(e).splitlines()[0]}")
                for l in tb.log_text()[log_before:].splitlines():
                    if "Action failed" in l or "[palette]" in l or "Error" in l:
                        print(f"      log: {l[:300]}")
            except Exception:
                failed += 1
                print(f"FAIL  {t.__name__}\n{traceback.format_exc()}")
    finally:
        if keep_open:
            print(f"left running; profile and log in {workdir}")
        else:
            tb.quit()
    print(f"\n{len(selected) - failed}/{len(selected)} passed (log: {workdir / 'thunderbird.log'})")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
