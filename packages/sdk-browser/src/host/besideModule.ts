/**
 * The URL of a module beside the caller's, named without extension: it carries the caller's own
 * extension — `.ts` in a source tree served as is, `.js` in a built `dist/`. A fixed string would
 * hit the wrong file on one side, and a missing worker would fail without saying so.
 * @param name - The module's file name, without extension.
 * @param from - The caller's `import.meta.url`.
 */
export const besideModule = (name: string, from: string) =>
  new URL(`./${name}${from.endsWith('.ts') ? '.ts' : '.js'}`, from);

/** One same-origin stand-in per cross-origin worker module, kept for the page's life: a worker
 *  that starts its own threads on its location (`joltWorkerPool`) reuses it. */
const standIns = new Map<string, string>();

/**
 * A module worker on `url`. A page may not start a worker on a script of another origin — the
 * engine loaded from a CDN — but a module worker may import one: such a worker starts on a
 * same-origin blob that imports the module, whose `import.meta.url` stays the CDN's, so what it
 * fetches beside itself (its WebAssembly) is still found there.
 * @param url - The worker module, `besideModule`'s answer or a worker's own location.
 */
export function startModuleWorker(url: URL | string) {
  const href = String(url);
  const origin = globalThis.location?.origin;
  // Same origin, or no page (Node): started on the URL as given, exactly as before the bundle.
  if (!origin || new URL(href).origin === origin) return new Worker(url, { type: 'module' });
  let standIn = standIns.get(href);
  if (!standIn) {
    const source = `import ${JSON.stringify(href)};`;
    standIn = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    standIns.set(href, standIn);
  }
  return new Worker(standIn, { type: 'module' });
}
