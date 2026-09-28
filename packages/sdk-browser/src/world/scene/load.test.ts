/**
 * What a session reads to prepare its scene, read from its own request list: the scene tables and
 * the images its surfaces sample — never a glTF, never the binary of the document it draws (read
 * on first need, `lazyBinary.test.ts`) — and, by default, not the images whose chain the cache baked. Proven on a published cache
 * (`site/assets/examples/bust`), served from disk.
 */
import { isDrawnNode } from '../../host/graph/kinds.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadPreparedScene } from './scene.ts';
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { bust, folder, load, plain, serve } from './load.fixture.ts';

test('a session prepares its scene from the tables and the images, and no glTF', async (t) => {
  const asked = serve(t);
  const { source, textureIndices } = await load(plain, 'host');
  const names = asked.map((url) => url.split('/').at(-1));
  assert.deepEqual(
    asked.filter((url) => /\.gl(?:tf|b)$/.test(url)),
    [],
    'no document is parsed',
  );
  assert.ok(names.includes('scene-tables.json'), `${names}`);
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

// A partitioned scene places its cells' nodes on rows the replicas would share: refused (#404).
test('a partitioned scene is not replicated', async (t) => {
  serve(t);
  const pointer = new URL('../../../../ten-thousand-objects/cache/native/full/manifest.json', bust);
  const { url } = JSON.parse(await readFile(pointer, 'utf8')) as { url: string };
  await assert.rejects(
    () =>
      loadPreparedScene(
        { manifestUrl: '', textureSource: 'host', replicaCount: 4 },
        plain,
        'source.gltf',
        new URL('./', new URL(url, pointer)).href,
        'full',
        false,
        undefined,
        () => {},
        () => {},
      ),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_SCENE_UPDATE',
  );
});
