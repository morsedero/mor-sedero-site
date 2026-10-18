// How long an Undo toast stays (Mor, 2026-10-18: 8 s, was 3.5 s - too short to
// read and tap). ONE number for ui.js flash and now.js's own toast. The fade
// in app.css (.toast.timed) starts 300 ms before it.
export const UNDO_MS = 8000;
export const UNDO_FADE_MS = 300;
