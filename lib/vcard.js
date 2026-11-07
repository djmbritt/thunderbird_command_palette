// Minimal vCard reader: just the display name and email addresses.
//
// Thunderbird (MV3, TB 128+) exposes contacts only as raw vCard text
// (ContactNode.vCard). The docs suggest bundling ical.js; for two fields a
// small reader is enough and keeps the extension dependency-free.
//
// Handles line folding (RFC 6350 §3.2), property groups ("item1.EMAIL"),
// parameters ("EMAIL;TYPE=work:"), and value escapes (\, \; \n).

/**
 * @param {string} text vCard text
 * @returns {{ name: string, emails: string[] }}
 */
function parseVCard(text) {
  const unfolded = String(text || "").replace(/\r?\n[ \t]/g, "");
  /** @type {{ name: string, emails: string[] }} */
  const result = { name: "", emails: [] };
  let structuredName = "";

  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    // "item1.EMAIL;TYPE=work" → "EMAIL"
    const prop = (line.slice(0, colon).split(";")[0].split(".").pop() ?? "").toUpperCase();
    const value = line.slice(colon + 1);

    if (prop === "FN") {
      result.name = unescapeValue(value).trim();
    } else if (prop === "N") {
      // N:Family;Given;Additional;Prefix;Suffix
      const [family = "", given = ""] = value.split(";").map(unescapeValue);
      structuredName = [given, family].filter(Boolean).join(" ").trim();
    } else if (prop === "EMAIL") {
      const email = unescapeValue(value).trim();
      if (email) result.emails.push(email);
    }
  }
  if (!result.name) result.name = structuredName;
  return result;
}

/** @param {string} v */
function unescapeValue(v) {
  return v.replace(/\\([\;,nN])/g, (_, /** @type {string} */ c) => (c === "n" || c === "N" ? "\n" : c));
}

const VCard = { parse: parseVCard };
if (typeof window !== "undefined") window.VCard = VCard;
if (typeof module !== "undefined") module.exports = VCard; // node --test
