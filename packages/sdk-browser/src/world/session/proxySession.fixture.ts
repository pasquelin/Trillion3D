import { probeBackendContext } from './backends.fixture.ts';
import { createExplorerPageSources } from './pageSources.ts';
import { createDiagnosticChannel, type DiagnosticObserver } from '../../diagnostic/channel.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import type { PageCache } from '../../streaming/pageCache.ts';
import {
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type ClusterManifest,
} from '../../../../sdk-core/src/index.ts';

export const base = 'http://localhost/cache/';
const page = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0]);

/**
 * A scene of `pages` 12-byte pages and a proxy of `triangles` triangles and no node, served under
 * any root by a `fetch` that records every url it is asked: a file `held` names is answered once
 * `release(file)` is called, and at once after, or refused when its request is cancelled first; one
 * `missing` names by a 404. `asked(url)` settles
 * once it is asked.
 */
export async function servedScene(
  pages: number,
  { triangles = 1, held = [] as string[], missing = [] as string[] } = {},
) {
  // The header, the triangles, their albedos.
  const words = new Uint32Array(SCENE_PROXY_HEADER_WORDS + triangles * (PROXY_TRIANGLE_FLOATS + 1));
  words.set([SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION, triangles, 0]);
  const pageSha = await sha256Hex(page.buffer);
  const urls = Array.from({ length: pages }, (_, i) => `p${i}.bin`);
  const metadata = {
    primitives: [{ pages: urls.map((url, id) => ({ id, url, bytes: 12, sha256: pageSha })) }],
    proxy: {
      version: SCENE_PROXY_VERSION,
      url: 'proxy.bin',
      bytes: words.byteLength,
      sha256: await sha256Hex(words.buffer),
      triangles,
      nodes: 0,
      bounds: [0, 0, 0, 1, 1, 0],
    },
  } as unknown as ClusterManifest;
  const served = new Map<string, Uint8Array>(urls.map((url) => [url, page]));
  served.set('proxy.bin', new Uint8Array(words.buffer));
  const fetched: string[] = [],
    released = new Map<string, Array<() => void>>(),
    freed = new Set<string>(),
    heard = new Map<string, Array<() => void>>();
  const asked = (url: string) =>
    fetched.includes(url)
      ? Promise.resolve()
      : new Promise<void>((resolve) => heard.set(url, [...(heard.get(url) ?? []), resolve]));
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      file = url.slice(url.lastIndexOf('/') + 1);
    fetched.push(url);
    for (const resolve of heard.get(url) ?? []) resolve();
    // A held answer is refused as soon as its request is cancelled, as a browser's is.
    if (held.includes(file) && !freed.has(file))
      await new Promise<void>((resolve, reject) => {
        released.set(file, [...(released.get(file) ?? []), resolve]);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    if (missing.includes(file)) return new Response(null, { status: 404 });
    return new Response(served.get(file)!.slice(), { status: 200 });
  };
  const release = (file: string) => {
    freed.add(file);
    for (const resolve of released.get(file) ?? []) resolve();
  };
  return { metadata, urls, fetched, asked, release };
}

/** One session on the world's kept cache, as far as its engines' context: what they read. `root`
 *  locates the scene, `signal` is the session's, and `diagnostics` hears the streamer's notices. */
export async function openSession(
  metadata: ClusterManifest,
  pageCache: PageCache,
  {
    root = base,
    maxPageTransferBytes,
    signal,
    diagnostics,
  }: {
    root?: string;
    maxPageTransferBytes?: number;
    signal?: AbortSignal;
    diagnostics?: DiagnosticObserver;
  } = {},
) {
  const options = { manifestUrl: `${root}manifest.json`, pageCache, maxPageTransferBytes };
  const channel = createDiagnosticChannel(diagnostics);
  const pageSources = await createExplorerPageSources(
    metadata,
    options,
    root,
    undefined,
    true,
    [],
    channel,
    () => {},
  );
  const context = await probeBackendContext(metadata, pageSources, {
    options,
    base: root,
    session: { signal },
  });
  const { streamer } = pageSources;
  return { context, streamer, flush: () => channel.flush(), close: () => streamer.dispose() };
}
