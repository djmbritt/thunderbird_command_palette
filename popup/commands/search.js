// Message search for the "?" prefix ("?invoice", "?alice").
//
// Loaded after popup/palette.js (core); registers via registerMessageSearch.
// Runs two messages.query calls (subject, sender) across all folders, merges
// them newest-first, and lists the top results. Enter opens the message in a
// new tab. Only the first page of each query is used and the list is then
// aborted, so a broad term on a big mailbox doesn't keep searching after the
// palette has its results.

const SEARCH_RESULT_LIMIT = 50;

async function queryFirstPage(queryInfo) {
  const list = await messenger.messages.query({
    ...queryInfo,
    messagesPerPage: SEARCH_RESULT_LIMIT,
    autoPaginationTimeout: 0
  });
  if (list.id && typeof messenger.messages.abortList === "function") {
    messenger.messages.abortList(list.id).catch(() => {});
  }
  return list.messages || [];
}

function shortDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}

// "Alice Example <alice@example.com>" → "Alice Example"
function displayAuthor(author) {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(author || "");
  return (m && m[1]) || author || "";
}

async function searchMessages(text) {
  const [bySubject, byAuthor] = await Promise.all([
    queryFirstPage({ subject: text }),
    queryFirstPage({ author: text })
  ]);
  const seen = new Set();
  const merged = [];
  for (const m of [...bySubject, ...byAuthor]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  merged.sort((a, b) => new Date(b.date) - new Date(a.date));
  return merged.slice(0, SEARCH_RESULT_LIMIT).map(m => ({
    id: `open-message:${m.id}`,
    label: m.subject || "(no subject)",
    hint: [displayAuthor(m.author), shortDate(m.date)].filter(Boolean).join(" · "),
    icon: m.read ? "✉" : "●",
    noHistory: true,
    run: () => messenger.messageDisplay.open({ messageId: m.id, location: "tab" })
  }));
}

registerMessageSearch(searchMessages);
