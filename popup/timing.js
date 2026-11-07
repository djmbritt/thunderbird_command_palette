// Startup timing instrumentation (diagnostic; see "Measuring startup" in
// CLAUDE.md). Loaded before palette.js so every later script can use it.
//
// Each palette open records:
//   steps   name → { start, end } in ms since the popup document started
//           loading (performance.now()), so parallel steps show overlap;
//   counts  name → number (folders, selected messages, pages, rows, …).
// Recording is always on (it's just a few timestamps in memory). Reporting is
// OFF by default: only when enabled ("Debug: Turn On Startup Timing", stored
// in localStorage so checking it is synchronous) is a summary logged after the
// first paint and the run saved to storage.local "startupTimings" (last
// TIMING_RUNS_KEPT runs). Deferred sources finish later and are added to the
// same run when they do.

const TIMING_RUNS_KEPT = 10;
const TIMING_ENABLED_KEY = "debugStartupTiming";

function isTimingEnabled() {
  try {
    return localStorage.getItem(TIMING_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** @param {boolean} on */
function setTimingEnabled(on) {
  if (on) localStorage.setItem(TIMING_ENABLED_KEY, "1");
  else localStorage.removeItem(TIMING_ENABLED_KEY);
}

/**
 * @typedef {{ start: number, end: number }} TimingStep
 * @typedef {{ at: string, scriptsStart: number, steps: Record<string, TimingStep>, counts: Record<string, number> }} TimingRun
 */

const Timing = {
  /** @type {TimingRun} */
  run: {
    at: new Date().toISOString(),
    scriptsStart: Math.round(performance.now()), // HTML parsed, libs loaded
    steps: {},
    counts: {}
  },

  /**
   * Time a promise or async function under `name`. Returns its result.
   * @template T
   * @param {string} name
   * @param {Promise<T> | (() => T | Promise<T>)} work
   * @returns {Promise<T>}
   */
  async time(name, work) {
    const start = performance.now();
    try {
      return await (typeof work === "function" ? work() : work);
    } finally {
      this.run.steps[name] = { start: Math.round(start), end: Math.round(performance.now()) };
    }
  },

  /**
   * Time a synchronous function under `name`. Returns its result.
   * @template T
   * @param {string} name
   * @param {() => T} fn
   * @returns {T}
   */
  timeSync(name, fn) {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.run.steps[name] = { start: Math.round(start), end: Math.round(performance.now()) };
    }
  },

  /** @param {string} name */
  mark(name) {
    const t = Math.round(performance.now());
    this.run.steps[name] = { start: t, end: t };
  },

  /** @param {string} name */
  count(name, n = 1) {
    this.run.counts[name] = (this.run.counts[name] || 0) + n;
  },

  /**
   * @param {string} name
   * @param {number} n
   */
  set(name, n) {
    this.run.counts[name] = n;
  },

  /**
   * Human-readable summary, slowest steps first.
   * @param {TimingRun} [run]
   */
  summary(run) {
    run ??= this.run;
    const steps = Object.entries(run.steps)
      .map(([name, s]) => ({ name, ms: s.end - s.start, end: s.end }))
      .sort((a, b) => b.ms - a.ms);
    const painted = run.steps.firstPaint?.end;
    const lines = [
      `startup ${run.at}: first paint at ${painted ?? "?"} ms (scripts started at ${run.scriptsStart} ms)`,
      ...steps.map(s => `  ${s.name.padEnd(34)} ${String(s.ms).padStart(6)} ms   (done at ${s.end} ms)`),
      `  counts: ${Object.entries(run.counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`
    ];
    return lines.join("\n");
  },

  // Save the current run (replacing an earlier save of the same run).
  async save() {
    try {
      const { startupTimings = [] } = await messenger.storage.local.get("startupTimings");
      const runs = startupTimings.filter((/** @type {TimingRun} */ r) => r.at !== this.run.at);
      runs.unshift(JSON.parse(JSON.stringify(this.run)));
      await messenger.storage.local.set({ startupTimings: runs.slice(0, TIMING_RUNS_KEPT) });
    } catch (e) {
      console.warn("[palette timing] save failed", e);
    }
  },

  // Page lifecycle from the Navigation Timing API (ms since document start).
  recordNavigation() {
    const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType?.("navigation")?.[0]);
    if (!nav) return;
    /** @type {[string, number][]} */
    const landmarks = [
      ["page: DOM interactive", nav.domInteractive],
      ["page: DOMContentLoaded done", nav.domContentLoadedEventEnd],
      ["page: load event done", nav.loadEventEnd]
    ];
    for (const [name, value] of landmarks) {
      if (value > 0) this.run.steps[name] = { start: Math.round(value), end: Math.round(value) };
    }
  },

  // Called once the first frame with results has been painted.
  async reportFirstPaint() {
    if (!isTimingEnabled()) return;
    this.recordNavigation();
    console.log(`[palette timing]\n${this.summary()}`);
    await this.save();
  },

  /** @param {string} name */
  async reportLate(name) {
    if (!isTimingEnabled()) return;
    const s = this.run.steps[name];
    if (s) console.log(`[palette timing] ${name}: ${s.end - s.start} ms (done at ${s.end} ms)`);
    await this.save();
  }
};

// When does Thunderbird actually show the popup? Record the first occurrence
// of events that fire as the panel opens, and the first animation frame (the
// refresh driver only produces frames once the document is being displayed).
// Comparing these with "first refilter + render" separates time spent in
// Thunderbird's panel from time spent in our code.
Timing.set("visibleAtScriptStart", document.visibilityState === "visible" ? 1 : 0);
for (const type of ["load", "pageshow", "focus", "resize", "visibilitychange"]) {
  window.addEventListener?.(type, () => {
    const name = `event: first ${type}${type === "visibilitychange" ? ` (${document.visibilityState})` : ""}`;
    if (!Timing.run.steps[name]) Timing.mark(name);
  });
}
// Every resize, not just the first: more than one means the popup changed
// size after Thunderbird first measured it.
window.addEventListener?.("resize", () => {
  Timing.count("resizeEvents");
  Timing.mark("event: last resize");
});
if (typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => Timing.mark("event: first animation frame"));
}
