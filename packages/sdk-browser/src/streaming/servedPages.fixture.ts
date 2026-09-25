import { sha256Hex } from '../measurement/sha256Hex.ts';
import type { StreamPage } from './types.ts';

/** A catalogue of `urls`, each a verified 12-byte page, served by a `fetch` that records every
 *  url it is asked. */
export async function servedPages(urls: readonly string[]) {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);
  const sha = await sha256Hex(bytes.buffer);
  const fetched: string[] = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return new Response(bytes, { status: 200 });
  };
  const pages: StreamPage[] = urls.map((url) => ({ url, bytes: bytes.byteLength, sha256: sha }));
  return { pages, fetched };
}
