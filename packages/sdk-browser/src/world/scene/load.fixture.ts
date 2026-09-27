/**
 * A published cache (`site/assets/examples/bust`) served from disk, the files a load asks for
 * counted: what the load proofs read.
 */
import type { TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPreparedScene } from './scene.ts';
import { decodingImages } from '../../host/prepared/decodedImages.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';

export const bust = new URL(
  '../../../../../site/assets/examples/bust/cache/native/full/',
  import.meta.url,
);

/** The key folder of the bust cache, as its pointer names it. */
export async function folder() {
  const { url } = JSON.parse(await readFile(new URL('manifest.json', bust), 'utf8')) as {
    url: string;
  };
  return new URL('./', new URL(url, bust));
}

/** Serves files from disk — the tables through `alter` — decodes images to a stand-in, and
 *  returns the list of what was asked for. */
export function serve(t: TestContext, alter: (tables: string) => string = (tables) => tables) {
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith('data:')) return new Response(new Uint8Array(1));
    const body = await readFile(fileURLToPath(url));
    return new Response(url.endsWith('scene-tables.json') ? alter(body.toString('utf8')) : body);
  });
  decodingImages(t);
  return asked;
}

export const load = async (
  metadata: ClusterManifest,
  textureSource?: 'host' | 'cache',
  signal?: AbortSignal,
) =>
  loadPreparedScene(
    { manifestUrl: '', ...(textureSource ? { textureSource } : {}) },
    metadata,
    'source.gltf',
    (await folder()).href,
    'full',
    false,
    signal,
    () => {},
    () => {},
  );

export const plain = { primitives: [] } as unknown as ClusterManifest;
