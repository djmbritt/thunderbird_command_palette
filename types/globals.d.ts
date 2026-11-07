// Globals shared between the popup's <script>s that TypeScript can't link up
// on its own. lib/*.js also set `module.exports` for the Node tests, which
// makes TypeScript treat them as CommonJS modules rather than global scripts,
// so their globals are declared here from the module types.

type FuzzyLib = typeof import("../lib/fuzzy.js");
type VCardLib = typeof import("../lib/vcard.js");

declare const Fuzzy: FuzzyLib;
declare const VCard: VCardLib;

interface Window {
  Fuzzy: FuzzyLib;
  VCard: VCardLib;
}
