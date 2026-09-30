/**
 * A module imported on its first use (#1353): the CDN bundle makes it a chunk of its own
 * (`scripts/bundle-fold.ts`), which a page without that family never downloads. `get` starts the
 * import and answers the module once it has arrived, `undefined` until then; `arrived` says the
 * import is over, the module in or refused; `failed` holds the refusal; `settled` waits for the
 * import in flight and `load` for the module itself, refused as the import was. A frame never
 * reads a module that has not arrived: what uses it waits for it first (`families.ts`).
 * @param load - The module's dynamic import, a relative specifier as the bundle folds it.
 */
export function onDemand<M>(load: () => Promise<M>) {
  let module: M | undefined,
    refusal: Error | undefined,
    loading: Promise<void> | undefined,
    arrived = false;
  const start = () =>
    (loading ??= load().then(
      (loaded) => void ((module = loaded), (arrived = true)),
      (cause) =>
        void ((refusal = cause instanceof Error ? cause : new Error(String(cause))),
        (arrived = true)),
    ));
  return {
    get(): M | undefined {
      start();
      return module;
    },
    get arrived() {
      return arrived;
    },
    get failed() {
      return refusal;
    },
    settled: () => loading ?? Promise.resolve(),
    async load(): Promise<M> {
      await start();
      if (refusal) throw refusal;
      return module!;
    },
  };
}

export type OnDemand<M> = ReturnType<typeof onDemand<M>>;
