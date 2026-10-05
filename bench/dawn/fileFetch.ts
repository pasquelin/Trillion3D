// `fetch` for the engine's own files in Node: its WebAssembly and workers sit beside its modules as
// `file:` addresses, which Node's `fetch` refuses, and a page asks relative ones, which it cannot
// read. Every other address goes to the real `fetch`.
import { readFile } from 'node:fs/promises';

const TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.ts': 'text/javascript',
};

const typeOf = (href: string) =>
  TYPES[href.slice(href.lastIndexOf('.')).replace(/[?#].*$/, '')] ?? 'application/octet-stream';

/** Installs the `file:`-aware `fetch` once on this thread's global. */
export function installFileFetch() {
  const real = globalThis.fetch;
  if ((real as { fileAware?: boolean }).fileAware) return;
  const fileFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const asked = typeof input === 'string' ? input : 'url' in input ? input.url : input.href;
    // A relative address is the page's, as a browser reads it.
    const href = new URL(asked, globalThis.location?.href).href;
    if (!href.startsWith('file:')) return real(typeof input === 'string' ? href : input, init);
    try {
      const body = await readFile(new URL(href));
      return new Response(body, { status: 200, headers: { 'content-type': typeOf(href) } });
    } catch {
      return new Response(null, { status: 404, statusText: `not found: ${href}` });
    }
  };
  globalThis.fetch = Object.assign(fileFetch, { fileAware: true }) as typeof fetch;
}
