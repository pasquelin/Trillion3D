// #42: a hosted map follows its readers' coverage rule after prepare: reduced again and copied at
// the next image's follow, with no new prepare; a still rule reduces nothing, a moved picture once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { tileCatalogue } from './catalogue.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { CoverageReaders } from '../../texture/coverage.ts';
import { surfaceOf } from '../../page/surface.ts';
import { hostTextureWritten, importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import * as G from '../../host/graph/graph.fixture.ts';

test('a surface switched from masked to opaque after prepare reduces its hosted map again', async () => {
  installGpuGlobals();
  const host = G.dataTexture(new Uint8Array(64), 4, 4);
  host.generateMipmaps = true;
  const material = G.standardSurface({ map: host, alphaTest: 0.5 });
  const readers = new CoverageReaders();
  readers.read(surfaceOf(material));
  const map = importHostTexture(host as unknown as HostTexture),
    encoding = poolEncoding(undefined);
  const { device, renderPipelines, textures: made } = mockGpu();
  const signalled: number[][] = [];
  const lossless = { lossless: 2, rgba: 0, 'two-channel': 0 };
  const textures = createWebgpuTileStreamer({
    device,
    color: tileCatalogue([map], () => undefined, undefined, encoding, readers),
    data: tileCatalogue([], () => undefined, undefined, encoding),
    layers: { color: lossless, data: lossless },
    encoding,
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: (slots) => void signalled.push(slots === -1 ? [-1] : [...slots]),
  });
  textures.prepare();
  const rules = () => renderPipelines.map((pipeline) => pipeline.fragment?.constants?.weighted);
  const scratches = () => made.filter((texture) => texture.label === 'Trillion3D texture scratch');
  assert.deepEqual(rules(), [1], 'masked at prepare: weighted');
  assert.equal(textures.followSampling(), false, 'no filter rule switched');
  assert.deepEqual([signalled, scratches().length], [[], 1], 'a still rule reduces nothing');
  material.alphaTest = 0;
  assert.equal(textures.followSampling(), false);
  assert.deepEqual(rules(), [1, 0], 'opaque now: reduced again, plain');
  assert.deepEqual(signalled, [[1]], 'its places copied again, as a landed tile');
  assert.ok(
    scratches().every((texture) => texture.destroyed),
    'the working texture returned',
  );
  textures.followSampling();
  assert.equal(scratches().length, 2, 'once');
  material.alphaTest = 0.5;
  host.needsUpdate = true;
  hostTextureWritten();
  await Promise.resolve();
  textures.followSampling();
  assert.equal(scratches().length, 3, 'reduced once, by its new picture, never twice');
  textures.destroy();
  material.dispose();
});
