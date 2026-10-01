/** Retains pending native/view releases across exit, browser end and a subsequent world dispose. */
export function createXrReleases(failed: (error: unknown) => void) {
  let pending: Promise<void> | undefined;
  return {
    wait(...jobs: (void | Promise<void> | null)[]) {
      const waiting = jobs.filter((job): job is Promise<void> => !!job);
      if (!waiting.length) return pending;
      const next = Promise.allSettled([...(pending ? [pending] : []), ...waiting]).then(
        (results) => {
          if (pending === next) pending = undefined;
          for (const result of results) if (result.status === 'rejected') failed(result.reason);
        },
      );
      pending = next;
      return next;
    },
  };
}
