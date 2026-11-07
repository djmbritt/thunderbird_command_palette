#!/usr/bin/env bash
# Create a throwaway Thunderbird profile for the end-to-end tests: one Local
# Folders account with a few test messages, no first-run dialogs, and this
# add-on loaded straight from the working tree (an extension proxy file).
#
#   e2e/make-profile.sh <profile-dir>
#
# Never point this at a real profile: the directory is wiped first.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
profile=${1:?usage: make-profile.sh <profile-dir>}
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["browser_specific_settings"]["gecko"]["id"])' "$here/manifest.json")

rm -rf "$profile"
mkdir -p "$profile/extensions" "$profile/Mail/Local Folders"

# Extension proxy file: the file name is the add-on id, the content is the
# source directory. Lets the tests run the working tree without packaging.
printf '%s\n' "$here" > "$profile/extensions/$id"
# A second add-on whose commands the palette should list and run.
printf '%s\n' "$here/e2e/fixtures/test-addon" > "$profile/extensions/test-addon@e2e.example"

cat > "$profile/user.js" <<'PREFS'
// Load the add-on from the profile without asking.
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
// No first-run UI, updates or telemetry.
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mailnews.start_page.enabled", false);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("mail.spotlight.firstRunDone", true);
user_pref("mail.winsearch.firstRunDone", true);
user_pref("app.update.disabledForTesting", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.dom.window.dump.enabled", true);
user_pref("devtools.console.stdout.chrome", true);
user_pref("devtools.console.stdout.content", true);
user_pref("marionette.port", 28290);
// One Local Folders account.
user_pref("mail.accountmanager.accounts", "account1");
user_pref("mail.accountmanager.localfoldersserver", "server1");
user_pref("mail.account.account1.server", "server1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
user_pref("mail.server.server1.name", "Local Folders");
user_pref("mail.server.server1.userName", "nobody");
user_pref("mail.server.server1.directory-rel", "[ProfD]Mail/Local Folders");
PREFS

msg() { # from subject date keywords
  cat <<MSG
From - Mon Jan 01 00:00:00 2026
X-Mozilla-Status: 0000
X-Mozilla-Status2: 00000000
X-Mozilla-Keys: $4
From: $1
To: Test User <test@example.com>
Subject: $2
Date: $3
Message-ID: <$(echo "$2" | tr -cd 'a-zA-Z0-9')@e2e.example>
Content-Type: text/plain; charset=UTF-8

Body of "$2".

MSG
}
{
  msg "Alice Example <alice@example.com>" "Invoice March" "Mon, 02 Mar 2026 10:00:00 +0000" ""
  msg "Bob Example <bob@example.com>" "Lunch plans" "Tue, 03 Mar 2026 11:00:00 +0000" '$label1'
  msg "Carol Example <carol@example.com>" "Project kickoff" "Wed, 04 Mar 2026 12:00:00 +0000" ""
} > "$profile/Mail/Local Folders/Inbox"
: > "$profile/Mail/Local Folders/Projects"
: > "$profile/Mail/Local Folders/Trash"
echo "profile ready: $profile (add-on $id from $here)"
