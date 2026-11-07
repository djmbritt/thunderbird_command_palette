#!/usr/bin/env python3
"""Take the addons.thunderbird.net listing screenshots (store/screenshots/).

Runs a throwaway Thunderbird with demo mail (like the e2e tests; your own
profile is never touched), floats its window at 1280x800 on top of the
screen, opens the palette in each state and captures the window with grim.
Hyprland/Wayland only (hyprctl + grim), plus ImageMagick to scale the result.

    python3 e2e/screenshots.py
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run import ROOT, Thunderbird  # noqa: E402

OUT = ROOT / "store/screenshots"
WIDTH, HEIGHT = 1280, 800

DEMO_MESSAGES = [
    # from, subject, date, read, tags
    ("Maya Lindqvist <maya@northwind.example>", "Q3 roadmap review — notes and next steps", "Mon, 02 Nov 2026 09:12:00 +0100", False, "$label1"),
    ("Accounts <billing@cloudhost.example>", "Your invoice for October 2026", "Mon, 02 Nov 2026 07:40:00 +0100", False, ""),
    ("Tomás Ferreira <tomas@northwind.example>", "Design system: new button styles", "Fri, 30 Oct 2026 16:05:00 +0100", True, "$label4"),
    ("Priya Raman <priya@example.org>", "Lunch on Thursday?", "Fri, 30 Oct 2026 12:30:00 +0100", True, "$label2"),
    ("Rail Europe <tickets@rail.example>", "Your tickets: Amsterdam → Berlin", "Thu, 29 Oct 2026 18:22:00 +0100", True, ""),
    ("GitHub <noreply@github.example>", "[thunderbird_command_palette] New issue: shortcut conflicts", "Thu, 29 Oct 2026 10:01:00 +0100", False, ""),
    ("Jonas Weber <jonas@northwind.example>", "Invoice #2041 approved", "Wed, 28 Oct 2026 14:47:00 +0100", True, "$label3"),
    ("Sofia Rossi <sofia@example.org>", "Photos from the weekend", "Tue, 27 Oct 2026 20:15:00 +0100", True, "$label2"),
    ("The Weekly Byte <news@weeklybyte.example>", "This week: local-first apps, keyboard-driven UIs", "Mon, 26 Oct 2026 06:00:00 +0100", True, ""),
    ("Maya Lindqvist <maya@northwind.example>", "Re: Hiring plan for 2027", "Fri, 23 Oct 2026 11:38:00 +0100", True, "$label5"),
]

FOLDERS = ["Projects", "Projects.sbd/Roadmap", "Projects.sbd/Design", "Receipts", "Travel", "Newsletters", "Family"]


def mbox(messages):
    out = []
    for i, (sender, subject, date, read, tags) in enumerate(messages):
        out.append(
            "From - Mon Jan 01 00:00:00 2026\n"
            f"X-Mozilla-Status: {'0001' if read else '0000'}\n"
            "X-Mozilla-Status2: 00000000\n"
            f"X-Mozilla-Keys: {tags}\n"
            f"From: {sender}\n"
            "To: You <you@northwind.example>\n"
            f"Subject: {subject}\n"
            f"Date: {date}\n"
            f"Message-ID: <demo{i}@northwind.example>\n"
            "Content-Type: text/plain; charset=UTF-8\n"
            "\n"
            f"Hi,\n\nThis is a demo message about \"{subject}\".\n\nBest,\n{sender.split(' <')[0]}\n\n")
    return "".join(out)


def prepare(profile):
    local = profile / "Mail/Local Folders"
    (local / "Inbox").write_text(mbox(DEMO_MESSAGES))
    for f in FOLDERS:
        path = local / f
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")


def hypr(*args):
    return subprocess.run(["hyprctl", *args], check=True, capture_output=True, text=True).stdout


def test_window(profile):
    """The Hyprland client for the test instance (matched by its process)."""
    pids = subprocess.run(["pgrep", "-f", f"profile {profile}"], capture_output=True, text=True).stdout.split()
    for c in json.loads(hypr("clients", "-j")):
        if str(c["pid"]) in pids:
            return c
    raise RuntimeError("test Thunderbird window not found")


def place_window(profile):
    """Float the test window at WIDTHxHEIGHT, centred, on top (Hyprland Lua dispatchers)."""
    win = test_window(profile)
    target = f"window = 'address:{win['address']}'"
    for cmd in [
        f"hl.dsp.window.float({{ action = 'on', {target} }})",
        f"hl.dsp.window.resize({{ x = {WIDTH}, y = {HEIGHT}, {target} }})",
        f"hl.dsp.window.center({{ {target} }})",
        f"hl.dsp.focus({{ {target} }})",
        f"hl.dsp.window.alter_zorder({{ mode = 'top', {target} }})",
    ]:
        hypr("dispatch", cmd)
    time.sleep(0.8)
    win = test_window(profile)
    if tuple(win["size"]) != (WIDTH, HEIGHT):
        print(f"  note: window is {win['size'][0]}x{win['size'][1]}, not {WIDTH}x{HEIGHT}")
    return win


def capture(profile, name):
    win = test_window(profile)
    (x, y), (w, h) = win["at"], win["size"]
    raw = OUT / f".{name}.raw.png"
    subprocess.run(["grim", "-g", f"{x},{y} {w}x{h}", str(raw)], check=True)
    subprocess.run(["magick", str(raw), "-resize", f"{WIDTH}x{HEIGHT}!", str(OUT / f"{name}.png")], check=True)
    raw.unlink()
    print(f"  {OUT.relative_to(ROOT) / (name + '.png')}")


SET_THEME = """
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const theme = await AddonManager.getAddonByID(arguments[0]);
await theme.enable();
await sleep(1500);
"""

# A realistic "recently used" list, written straight into the add-on's
# storage.local (command ids; unknown ones are ignored by the palette).
SEED_MRU = """
const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");
const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(ext()));
await db.set({ mru: ["archive", "move-to", "reply-all", "goto-folder:account1://Receipts", "tag-with", "goto-unified-inbox", "sort-date"] });
"""

# Select a message and wait for the message pane to finish loading it.
SELECT = """
await showInbox(arguments[0]);
await until(() => about3().messageBrowser?.contentWindow?.document?.readyState === "complete" &&
  !W().document.getElementById("statusText")?.value?.startsWith?.("Loading"), "the message to load");
await sleep(1500);
"""

CLOSE = """
const b = paletteBrowser();
b?.closest("panel")?.hidePopup();
await until(() => !paletteBrowser(), "the palette to close");
await sleep(300);
"""


def shot(tb, name, message, script):
    tb.js(CLOSE)
    tb.js(SELECT, message, timeout_ms=60000)
    tb.js(script + '\nawait palette("nohover");', timeout_ms=60000)
    time.sleep(0.8)  # let the popup finish painting
    capture(tb.profile, name)
    tb.js(CLOSE)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="palette-shots-", dir=os.environ.get("E2E_TMPDIR")))
    tb = Thunderbird(workdir / "profile", workdir / "thunderbird.log", prepare=prepare)
    try:
        tb.js(SET_THEME, "thunderbird-compact-light@mozilla.org")
        place_window(tb.profile)
        tb.js(SEED_MRU, timeout_ms=60000)
        print("screenshots:")
        shot(tb, "1-recent-commands", "Your invoice for October 2026", "await openPalette();")
        shot(tb, "2-fuzzy-search", "Your invoice for October 2026", 'await openPalette(); await palette("type", "arch");')
        shot(tb, "3-move-to-folder", "Q3 roadmap review — notes and next steps", """
          await openPalette();
          await palette("type", "move to folder");
          await palette("key", "Enter");
          await until(async () => (await palette()).mode, "the Move picker");
          await palette("type", "pro");
        """)
        shot(tb, "4-message-search", "Q3 roadmap review — notes and next steps", """
          await openPalette();
          await palette("type", "?invoice");
          await until(async () => (await palette()).rows.length > 1, "search results", 10000);
        """)
        tb.js(SET_THEME, "thunderbird-compact-dark@mozilla.org")
        place_window(tb.profile)
        shot(tb, "5-dark-theme", "Lunch on Thursday?", 'await openPalette(); await palette("type", "tag");')
    finally:
        tb.quit()
    print(f"done; Thunderbird log: {workdir / 'thunderbird.log'}")


if __name__ == "__main__":
    main()
