#!/usr/bin/env node
// Flag messenger.* APIs that are newer than the add-on's minimum Thunderbird
// version (manifest strict_min_version) and aren't feature-detected.
//
//   node tools/check-since.mjs        (npm run check:since; part of npm run check)
//
// The type check accepts anything in the current ESR's schemas, which are newer
// than our minimum, so a call to a 140+ API type-checks but throws on 128.
// Version data comes from types/api-since.json, written by tools/gen-types.mjs.
//
// An API counts as feature-detected when the same file contains a typeof check
// on it, e.g. `typeof messenger.commands?.openShortcutSettings === "function"`.
// To accept a use on purpose, put `since-ok` in a comment on that line.
//
// Limits: the schemas date namespaces, functions, events and properties, not
// individual parameters or options, so a new option passed to an old function
// isn't caught. Experiment APIs (messenger.palette.*) aren't checked.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const since = JSON.parse(readFileSync(join(root, "types/api-since.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const minVersion = manifest.browser_specific_settings?.gecko?.strict_min_version;
if (!minVersion) {
  console.error("check-since: manifest.json has no strict_min_version");
  process.exit(2);
}

const parseVersion = v => v.split(".").map(n => parseInt(n, 10) || 0);
function newer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

function jsFiles(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap(f => jsFiles(join(path, f))).filter(f => f.endsWith(".js"));
}

// Blank out comments but keep line breaks, so JSDoc type references
// (`messenger.mailTabs.MailTab`) aren't mistaken for calls.
function stripComments(src) {
  const blank = s => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, before) => before + blank(m.slice(before.length)));
}

// Longest dotted prefix of `path` that's a known API (functions on returned
// objects, e.g. storage.local.get, resolve to storage.local).
function resolve(path) {
  const parts = path.split(".");
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join(".");
    if (key in since) return key;
  }
  return null;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const problems = [];
const files = ["background.js", "popup", "lib"].flatMap(p => jsFiles(join(root, p)));
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  const code = stripComments(raw);
  const seen = new Set();
  code.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\bmessenger((?:\??\.[A-Za-z_$][\w$]*)+)/g)) {
      const path = m[1].replace(/\?/g, "").slice(1);
      const api = resolve(path);
      if (!api || !newer(since[api], minVersion)) continue;
      if (/since-ok/.test(rawLines[i])) continue;
      // typeof messenger.a?.b … — the API itself or any longer path through it.
      const detect = new RegExp(`typeof\\s+messenger${api.split(".").map(p => `\\??\\.${escape(p)}`).join("")}\\b`);
      if (detect.test(code)) continue;
      const key = `${api}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      problems.push(`${relative(root, file)}:${i + 1}: messenger.${api} needs Thunderbird ${since[api]} (minimum is ${minVersion}) and isn't feature-detected`);
    }
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} API use(s) newer than strict_min_version ${minVersion}. ` +
    "Feature-detect them (typeof messenger.ns?.fn === \"function\") or mark the line `since-ok`.");
  process.exit(1);
}
console.log(`check-since: no undetected APIs newer than Thunderbird ${minVersion} (${files.length} files)`);
