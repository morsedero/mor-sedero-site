// What core says about a task, for connections to act on (Job Hunt's Drive
// folder moves are one). Core knows nothing about who listens: it emits
//   task.done     the task was finished (store.finishTask)
//   task.deleted  the task was deleted (store.removeTask, given the task)
// each as { type, task, folderId }, folderId = the task's linked Drive folder
// (task.source.folderId) or "". A connection decides what the event means.
const listeners = new Set();

export function onTaskEvent(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitTask(type, task){
  if (!task) return;
  const detail = { type, task, folderId: task.source?.folderId || "" };
  for (const fn of listeners) {
    try { fn(detail); } catch (e) { console.error("[daisey] task event", type, e); }
  }
}
