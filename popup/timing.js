// Startup timing instrumentation (diagnostic; see "Measuring startup" in
// CLAUDE.md). Loaded before palette.js so every later script can use it.
//
// Each palette open records:
//   steps   name → { start, end } in ms since the popup document started
//           loading (performance.now()), so parallel steps show overlap;
//   counts  name → number (folders, selected messages, pages, rows, …).
// After the first paint, a one-line summary is logged and the run is saved to
// storage.local "startupTimings" (last TIMING_RUNS_KEPT runs). Unread counts
// finish later and are added to the same run when they do.

const TIMING_RUNS_KEPT = 10;

const Timing = {
  run: {
    at: new Date().toISOString(),
    scriptsStart: Math.round(performance.now()), // HTML parsed, libs loaded
    steps: {},
    counts: {}
  },

  // Time a promise or async function under `name`. Returns its result.
  async time(name, work) {
    const start = performance.now();
    try {
      return await (typeof work === "function" ? work() : work);
    } finally {
      this.run.steps[name] = { start: Math.round(start), end: Math.round(performance.now()) };
    }
  },

  // Time a synchronous function under `name`. Returns its result.
  timeSync(name, fn) {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.run.steps[name] = { start: Math.round(start), end: Math.round(performance.now()) };
    }
  },

  mark(name) {
    const t = Math.round(performance.now());
    this.run.steps[name] = { start: t, end: t };
  },

  count(name, n = 1) {
    this.run.counts[name] = (this.run.counts[name] || 0) + n;
  },

  set(name, n) {
    this.run.counts[name] = n;
  },

  // Human-readable summary, slowest steps first.
  summary(run = this.run) {
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
      const runs = startupTimings.filter(r => r.at !== this.run.at);
      runs.unshift(JSON.parse(JSON.stringify(this.run)));
      await messenger.storage.local.set({ startupTimings: runs.slice(0, TIMING_RUNS_KEPT) });
    } catch (e) {
      console.warn("[palette timing] save failed", e);
    }
  },

  // Called once the first frame with results has been painted.
  async reportFirstPaint() {
    console.log(`[palette timing]\n${this.summary()}`);
    await this.save();
  },

  async reportLate(name) {
    const s = this.run.steps[name];
    if (s) console.log(`[palette timing] ${name}: ${s.end - s.start} ms (done at ${s.end} ms)`);
    await this.save();
  }
};

// Resolves after the next frame has actually been painted: one
// requestAnimationFrame runs before paint, a timeout after it runs after.
function afterNextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
