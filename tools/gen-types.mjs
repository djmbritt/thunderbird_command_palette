#!/usr/bin/env node
// Generate TypeScript declarations for `messenger.*` from WebExtension JSON
// schema files. Dev-only: used for type checking (see "Type checking" in
// CLAUDE.md), never shipped in the .xpi.
//
//   node tools/gen-types.mjs <out.d.ts> <schema.json | schema-dir>... [--header "text"]
//
// Inputs are Thunderbird's annotated MV3 schemas
// (github.com/thunderbird/webext-annotated-schemas, branch esr-mv3) and our own
// experiments/schema.json; both use the same format. Run `npm run types:update`
// rather than calling this directly.
//
// The mapping is deliberately loose where the schema is (unknown/unsupported
// shapes become `any`), so the checker reports real mistakes, not generator gaps.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
let header = "";
const headerAt = args.indexOf("--header");
if (headerAt !== -1) {
  header = args[headerAt + 1];
  args.splice(headerAt, 2);
}
const [outFile, ...inputs] = args;
if (!outFile || !inputs.length) {
  console.error("usage: gen-types.mjs <out.d.ts> <schema.json | dir>... [--header text]");
  process.exit(2);
}

// ---------------------------------------------------------------- load ----

const files = inputs.flatMap(p =>
  statSync(p).isDirectory()
    ? readdirSync(p).filter(f => f.endsWith(".json")).sort().map(f => join(p, f))
    : [p]
);

// The schemas contain // comments in some versions; strip whole-line ones.
const parse = text => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

/** namespace name → merged { types, functions, events, properties, description } */
const namespaces = new Map();
for (const file of files) {
  for (const ns of parse(readFileSync(file, "utf8"))) {
    const name = ns.namespace;
    if (!name || name === "manifest") continue; // manifest types aren't runtime API
    const merged = namespaces.get(name) ?? { types: [], functions: [], events: [], properties: {}, description: "" };
    merged.types.push(...(ns.types ?? []).filter(t => t.id && !t.$extend));
    merged.functions.push(...(ns.functions ?? []));
    merged.events.push(...(ns.events ?? []));
    Object.assign(merged.properties, ns.properties ?? {});
    merged.description ||= ns.description ?? "";
    namespaces.set(name, merged);
  }
}

const typeIds = new Map([...namespaces].map(([name, ns]) => [name, new Set(ns.types.map(t => t.id))]));

// ------------------------------------------------------------- helpers ----

const RESERVED = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true",
  "try", "typeof", "var", "void", "while", "with"]);

const KNOWN_INSTANCES = new Set(["Date", "Blob", "File", "ArrayBuffer", "FormData", "RegExp", "Promise", "Window"]);

const ident = name => (RESERVED.has(name) || !/^[A-Za-z_$][\w$]*$/.test(name) ? `${name.replace(/\W/g, "_")}_` : name);
const propKey = name => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

const unsupported = s => s?.unsupported === true;

function sinceVersion(s) {
  return (s?.annotations ?? []).find(a => a.version_added)?.version_added;
}

function docUrl(s) {
  return (s?.annotations ?? []).find(a => a.api_documentation_url)?.api_documentation_url;
}

function cleanText(text = "") {
  return text
    .replace(/\$\(ref:([\w.]+)\)/g, "$1")
    .replace(/\$\(url:[^)]*\)\[([^\]]*)\]/g, "$1")
    .replace(/<\/?var>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\*\//g, "*\\/")
    .replace(/\s+/g, " ")
    .trim();
}

function jsdoc(s, indent) {
  const lines = [];
  const desc = cleanText(s?.description);
  if (desc) lines.push(desc);
  const since = sinceVersion(s);
  if (since) lines.push(`@since Thunderbird ${since}`);
  if (s?.deprecated) lines.push(`@deprecated ${typeof s.deprecated === "string" ? cleanText(s.deprecated) : ""}`.trim());
  const url = docUrl(s);
  if (url) lines.push(`@see ${url}`);
  if (!lines.length) return "";
  return `${indent}/**\n${lines.map(l => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}

function resolveRef(ref, ns) {
  const dot = ref.lastIndexOf(".");
  if (dot === -1) {
    if (typeIds.get(ns)?.has(ref)) return `messenger.${ns}.${ref}`;
    for (const [other, ids] of typeIds) if (ids.has(ref) && other === "types") return `messenger.types.${ref}`;
    return "any";
  }
  const target = ref.slice(0, dot);
  const id = ref.slice(dot + 1);
  return typeIds.get(target)?.has(id) ? `messenger.${target}.${id}` : "any";
}

const paren = t => (/[|&]|=>/.test(t) ? `(${t})` : t);

// ------------------------------------------------------------ type map ----

function tsType(s, ns, indent) {
  if (!s) return "any";
  if (s.$ref) return resolveRef(s.$ref, ns);
  if (s.choices) {
    const parts = [...new Set(s.choices.filter(c => !unsupported(c)).map(c => tsType(c, ns, indent)))];
    return parts.includes("any") ? "any" : parts.join(" | ") || "any";
  }
  switch (s.type) {
    case "string":
      if (s.enum) {
        const values = s.enum.map(e => (typeof e === "string" ? e : e.name)).filter(Boolean);
        return values.map(v => JSON.stringify(v)).join(" | ") || "string";
      }
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return s.items ? `${paren(tsType(s.items, ns, indent))}[]` : "any[]";
    case "function":
      return functionType(s, ns, indent);
    case "object":
    case undefined:
      if (s.isInstanceOf) return KNOWN_INSTANCES.has(s.isInstanceOf) ? `globalThis.${s.isInstanceOf}` : "any";
      if (s.properties || s.functions || s.events || s.additionalProperties || s.patternProperties) {
        return objectType(s, ns, indent);
      }
      return s.type === "object" ? "{ [key: string]: any }" : "any";
    default:
      return "any"; // any, JSON, JavaScript, CSS, …
  }
}

function objectType(s, ns, indent) {
  const inner = `${indent}  `;
  const members = [];
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    if (unsupported(prop)) continue;
    const optional = prop.optional ? "?" : "";
    members.push(`${jsdoc(prop, inner)}${inner}${propKey(name)}${optional}: ${tsType(prop, ns, inner)};`);
  }
  for (const fn of s.functions ?? []) {
    if (unsupported(fn)) continue;
    for (const sig of signatures(fn, ns, inner)) members.push(`${jsdoc(fn, inner)}${inner}${ident(fn.name)}${sig};`);
  }
  for (const ev of s.events ?? []) {
    if (unsupported(ev)) continue;
    members.push(`${jsdoc(ev, inner)}${inner}${ident(ev.name)}: WebExtEvent<${functionType(ev, ns, inner, true)}>;`);
  }
  const extra = s.additionalProperties ?? Object.values(s.patternProperties ?? {})[0];
  if (extra) {
    // With named properties present the index type must cover them, so use any.
    const valueType = members.length || extra === true ? "any" : tsType(extra, ns, inner);
    members.push(`${inner}[key: string]: ${valueType};`);
  }
  if (!members.length) return "{}";
  return `{\n${members.join("\n")}\n${indent}}`;
}

function paramList(params, ns, indent) {
  // TS only allows optional parameters at the end; schema optionals in the
  // middle are handled by overloads (see signatures()).
  let lastRequired = -1;
  params.forEach((p, i) => { if (!p.optional) lastRequired = i; });
  return params
    .map((p, i) => `${ident(p.name ?? `arg${i}`)}${p.optional && i > lastRequired ? "?" : ""}: ${tsType(p, ns, indent)}`)
    .join(", ");
}

function returnType(fn, ns, indent, params) {
  if (typeof fn.async === "string") {
    const cb = params.find(p => p.name === fn.async);
    const cbParams = cb?.parameters ?? [];
    return `Promise<${cbParams.length ? tsType(cbParams[0], ns, indent) : "void"}>`;
  }
  if (fn.async === true) return `Promise<${fn.returns ? tsType(fn.returns, ns, indent) : "any"}>`;
  return fn.returns ? tsType(fn.returns, ns, indent) : "void";
}

function visibleParams(fn) {
  return (fn.parameters ?? []).filter(p => !unsupported(p) && !(typeof fn.async === "string" && p.name === fn.async));
}

function functionType(fn, ns, indent, isListener = false) {
  const params = (fn.parameters ?? []).filter(p => !unsupported(p));
  // Listeners are called by the browser, so their parameters are never omitted.
  const list = params.map((p, i) => `${ident(p.name ?? `arg${i}`)}${p.optional && !isListener ? "?" : ""}: ${tsType(p, ns, indent)}`);
  // Listener return values are loosely specified (onMessage may also return a Promise).
  const ret = isListener ? (fn.returns ? "any" : "void") : returnType(fn, ns, indent, fn.parameters ?? []);
  return `(${list.join(", ")}) => ${ret}`;
}

// The browser lets callers omit optional parameters anywhere when the
// remaining arguments are unambiguous (`mailTabs.update(tabId?, props)`,
// `compose.beginNew(messageId?, details?)`). TS only allows trailing optionals,
// so emit one overload per subset of omitted non-final optionals.
function signatures(fn, ns, indent) {
  const params = visibleParams(fn);
  const ret = returnType(fn, ns, indent, fn.parameters ?? []);
  const omittable = params.map((p, i) => (p.optional && i < params.length - 1 ? i : -1)).filter(i => i !== -1);
  if (omittable.length > 4) omittable.length = 4; // bounds the overload count
  const sigs = [];
  for (let mask = 0; mask < 1 << omittable.length; mask++) {
    const omit = new Set(omittable.filter((_, bit) => mask & (1 << bit)));
    sigs.push(`(${paramList(params.filter((_, i) => !omit.has(i)), ns, indent)}): ${ret}`);
  }
  return [...new Set(sigs)];
}

// ---------------------------------------------------------------- emit ----
//
// Types go in `namespace messenger.<ns>` (so JSDoc can say
// `messenger.folders.MailFolder`). The callable API is described by interfaces
// in `messenger.__api` and a `messenger` constant of the root interface; that
// way members may use reserved words (`messages.delete`).

const iface = name => name.replace(/\./g, "_");
const parentOf = name => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : null);
const sorted = [...namespaces.keys()].sort();

const out = [];
out.push(`// GENERATED by tools/gen-types.mjs — do not edit. Regenerate with \`npm run types:update\`.`);
if (header) out.push(...header.split("\n").map(l => `// ${l}`));
out.push("");
out.push(`interface WebExtEvent<TCallback extends (...args: any[]) => any> {
  addListener(cb: TCallback, ...extra: any[]): void;
  removeListener(cb: TCallback): void;
  hasListener(cb: TCallback): boolean;
}
`);
out.push("declare namespace messenger {");
for (const name of sorted) {
  const ns = namespaces.get(name);
  const types = ns.types.filter(t => !unsupported(t));
  if (!types.length) continue;
  out.push(`  namespace ${name} {`);
  for (const t of types) {
    out.push(`${jsdoc(t, "    ")}    type ${ident(t.id)} = ${tsType({ ...t, id: undefined }, name, "    ")};`);
  }
  out.push("  }");
}

out.push("  namespace __api {");
const i2 = "    ";
const i3 = "      ";
const children = name => sorted.filter(n => parentOf(n) === name);
const member = child => `${jsdoc(namespaces.get(child), i3)}${i3}readonly ${propKey(child.slice(child.lastIndexOf(".") + 1))}: ${iface(child)};`;
out.push(`${i2}interface Root {`);
for (const child of children(null)) out.push(member(child));
out.push(`${i2}}`);
for (const name of sorted) {
  const ns = namespaces.get(name);
  out.push(`${i2}interface ${iface(name)} {`);
  for (const child of children(name)) out.push(member(child));
  for (const [pname, prop] of Object.entries(ns.properties)) {
    if (unsupported(prop)) continue;
    const type = "value" in prop ? JSON.stringify(prop.value) : tsType(prop, name, i3);
    out.push(`${jsdoc(prop, i3)}${i3}readonly ${propKey(pname)}: ${type};`);
  }
  for (const fn of ns.functions) {
    if (unsupported(fn)) continue;
    for (const sig of signatures(fn, name, i3)) out.push(`${jsdoc(fn, i3)}${i3}${propKey(fn.name)}${sig};`);
  }
  for (const ev of ns.events) {
    if (unsupported(ev)) continue;
    out.push(`${jsdoc(ev, i3)}${i3}readonly ${propKey(ev.name)}: WebExtEvent<${functionType(ev, name, i3, true)}>;`);
  }
  out.push(`${i2}}`);
}
out.push("  }");
out.push("}");
out.push("");
out.push("declare const messenger: messenger.__api.Root;");
out.push("declare const browser: messenger.__api.Root;");
out.push("");

const orphans = sorted.filter(n => parentOf(n) && !namespaces.has(parentOf(n)));
if (orphans.length) console.warn(`namespaces without a parent (not reachable): ${orphans.join(", ")}`);

writeFileSync(outFile, out.join("\n"));
console.log(`wrote ${outFile}: ${namespaces.size} namespaces from ${files.length} files`);
