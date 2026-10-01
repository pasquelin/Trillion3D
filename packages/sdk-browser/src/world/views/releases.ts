/** A removed view still owns its GPU readbacks until its asynchronous release settles. */
export function pendingViewReleases() {
  const pending = new Set<Promise<unknown>>();
  return {
    track<T>(start: Promise<T> | (() => T | Promise<T>)): Promise<T> {
      let work: Promise<T>;
      try {
        work = Promise.resolve(typeof start === 'function' ? start() : start);
      } catch (error) {
        work = Promise.reject(error);
      }
      pending.add(work);
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work),
      );
      return work;
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
