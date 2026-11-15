// The bridge client uses window timers (Obsidian popout-window rule); node tests have no window.
const g = globalThis as unknown as { window?: unknown };
g.window ??= globalThis;
