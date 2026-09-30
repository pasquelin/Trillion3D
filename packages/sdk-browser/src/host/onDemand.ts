/**
 * A module imported on its first use, read by a frame that never awaits (#1353): the CDN bundle
 * makes it a chunk of its own (`scripts/bundle-fold.ts`), which a page without that family never
 * downloads. `get` starts the import and answers the module once it has arrived, `undefined`
 * until then, as a texture or a page still loading; `failed` holds the import's refusal, and
 * `settled` waits for the import in flight, for the frame readiness that draws again on arrival.
 * @param load - The module's dynamic import, a relative specifier as the bundle folds it.
 */
export function onDemand<M>(load: () => Promise<M>) {
  let module: M | undefined, refusal: Error | undefined, loading: Promise<void> | undefined;
  return {
    get(): M | undefined {
      loading ??= load().then(
        (arrived) => void (module = arrived),
        (cause) => void (refusal = cause instanceof Error ? cause : new Error(String(cause))),
      );
      return module;
    },
    get failed() {
      return refusal;
    },
    settled: () => loading ?? Promise.resolve(),
  };
}
