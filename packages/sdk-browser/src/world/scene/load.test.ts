/**
 * What a session reads to prepare its scene, read from its own request list: the scene tables, the
 * binary of the document it draws and the images its surfaces sample — never a glTF — and, by
 * default, not the images whose chain the cache baked. Proven on a published cache
 * (`site/assets/examples/bust`), served from disk.
 */
import { isDrawnNode } from '../../host/graph/kinds.ts';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadPreparedScene } from './scene.ts';
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts';

const bust = new URL(
  '../../../../../site/assets/examples/bust/cache/native/full/',
  import.meta.url,
);

/** The key folder of the bust cache, as its pointer names it. */
async function folder() {
  const { url } = JSON.parse(await readFile(new URL('manifest.json', bust), 'utf8')) as {
    url: string;
  };
  return new URL('./', new URL(url, bust));
}

/** Serves files from disk — the tables through `alter` — decodes images to a stand-in, and
 *  returns the list of what was asked for. */
function serve(t: TestContext, alter: (tables: string) => string = (tables) => tables) {
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (url.startsWith('data:')) return new Response(new Uint8Array(1));
    const body = await readFile(fileURLToPath(url));
    return new Response(url.endsWith('scene-tables.json') ? alter(body.toString('utf8')) : body);
  });
  Object.assign(globalThis, { createImageBitmap: async () => ({ width: 1, height: 1 }) });
  t.after(() => delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap);
  return asked;
}

const load = async (metadata: ClusterManifest, textureSource?: 'host' | 'cache') =>
  loadPreparedScene(
    { manifestUrl: '', ...(textureSource ? { textureSource } : {}) },
    metadata,
    'source.gltf',
    (await folder()).href,
    'full',
    false,
    undefined,
    () => {},
    () => {},
  );

const plain = { primitives: [] } as unknown as ClusterManifest;

test('a session prepares its scene from the tables, the binary and the images, and no glTF', async (t) => {
  const asked = serve(t);
  const { source, textureIndices } = await load(plain, 'host');
  const names = asked.map((url) => url.split('/').at(-1));
  assert.deepEqual(
    asked.filter((url) => /\.gl(?:tf|b)$/.test(url)),
    [],
    'no document is parsed',
  );
  assert.ok(names.includes('scene-tables.json') && names.includes('source.bin'), `${names}`);
  const images = (
    await readdir(new URL('../../../../source/', await folder()), { recursive: true })
  ).map((path) => path.split('/').at(-1));
  assert.ok(
    names.some((name) => /\.(?:png|jpe?g)$/.test(name ?? '') && images.includes(name)),
    'the images are read',
  );
  let meshes = 0;
  source.traverse((node) => void (meshes += isDrawnNode(node) ? 1 : 0));
  assert.ok(meshes > 0 && textureIndices.size > 0, 'a scene with its surfaces');
});

// Every image the sidecar bakes whole is spared by default: a white pixel stands in its place.
// Only a host that names `'host'` — a backend of its session samples the images themselves — gets
// them read (`resolveTextureSource`, `../../backend/defaultBackendsTextureSource.test.ts`).
test('the baked images are read only when the host asks for them', async (t) => {
  const tables = JSON.parse(
    await readFile(new URL('scene-tables.json', await folder()), 'utf8'),
  ) as { documents: Record<string, { images: unknown[] }> };
  const count = tables.documents['source.gltf'].images.length;
  const baked = {
    primitives: [],
    textures: { url: 'textures/v4' },
    texturePreviews: Array.from({ length: count }, (_, image) => ({
      image,
      firstLevel: 0,
      bakedLevels: 0,
    })),
  } as unknown as ClusterManifest;
  const sourceImages = (asked: string[]) =>
    asked.filter((url) => url.includes('/source/') && !url.endsWith('.bin')).length;
  const spared = serve(t);
  await load(baked);
  assert.equal(sourceImages(spared), 0, 'no source image by default');
  assert.equal(spared.filter((url) => url.startsWith('data:')).length, count);
  const read = serve(t);
  await load(baked, 'host');
  assert.equal(sourceImages(read), count, 'every image when the host asks');
});

// Case 4 of the singular-normals convention: a non-finite pose never enters the engine. The load
// refuses it by the node's name, before it would come out as a darkened surface far from its cause.
test('a non-finite pose in the tables is refused at load (NON_FINITE_TRANSFORM)', async (t) => {
  serve(t, (text) => {
    const tables = JSON.parse(text) as { nodes: { name: string; translation: unknown }[] };
    const drawn = tables.nodes.findIndex((node) => 'mesh' in node && node.mesh !== null);
    tables.nodes[drawn].name = 'cible';
    tables.nodes[drawn].translation = 'INFINITE';
    return JSON.stringify(tables).replace('"INFINITE"', '[1e400,0,0]');
  });
  await assert.rejects(
    () => load(plain, 'host'),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'NON_FINITE_TRANSFORM' &&
      error.details.nodeName === 'cible',
  );
});
