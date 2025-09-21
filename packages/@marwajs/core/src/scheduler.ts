// Minimal microtask-based job scheduler with deduping.
// Used by effects to batch re-runs and avoid sync cascades.

type jobType = () => void;
const resolved = Promise.resolve();
const queue = new Set<jobType>();
let isFlushing = false;

export function queueJob(job: jobType): void {
  queue.add(job);
  if (!isFlushing) {
    isFlushing = true;
    resolved.then(flushJobs);
  }
}

export function flushJobs(): void {
  try {
    for (const job of queue) {
      job();
    }
  } finally {
    queue.clear();
    isFlushing = false;
  }
}

/** Useful for awaiting DOM updates in user-land */
export function nextTick(): Promise<void> {
  return resolved.then(() => {});
}
