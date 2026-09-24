// #360, #361: a texture's sampling follows its record, not the surfaces that wear it — once per
// record version, whichever pass reads the texture —, and a moved colour texture is signalled as a
// landed tile is, so the cutout shadows that read it follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';

installGpuGlobals();

/** A record at the default sampling, its version and transform written by the test. */
const record = () =>
  ({
    version: 0,
    magFilter: 'linear',
    minFilter: 'linear-mip-linear',
    anisotropy: 1,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }) as unknown as Texture & { version: number; transform: number[]; anisotropy: number };

/** A streamer over one colour and one data texture, both whole in their tail; counts the page
 *  table writes and the colour signals. */
function streamer(colour: Texture, data: Texture) {
  let tableWrites = 0;
  const signalled: number[][] = [];
  const device = {
    createTexture: () => ({ createView: () => ({}), destroy() {}, format: 'rgba8unorm' }),
    createBuffer: ({ size, label }: { size: number; label?: string }) => ({
      label,
      size,
      destroy() {},
    }),
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: {
      writeTexture() {},
      submit() {},
      writeBuffer: (buffer: { label?: string }) => {
        if (buffer.label?.startsWith('Trillion3D texture pages')) tableWrites++;
      },
    },
  } as never;
  const blocks = { bc7: [], astc: [] };
  const whole = (texture?: Texture) => ({
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
    texture,
  });
  const lossless = { lossless: 1, rgba: 0, 'two-channel': 0 };
  const textures = createWebgpuTileStreamer({
    device,
    color: [whole(), whole(colour)],
    data: [whole(), whole(data)],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs: Number.MAX_SAFE_INTEGER,
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: (slots) => signalled.push(slots === -1 ? [-1] : [...slots]),
  });
  textures.prepare();
  return { textures, writes: () => tableWrites, signalled };
}

test('the sampling follows each texture once per version, and signals a moved colour texture', () => {
  const colour = record(),
    data = record();
  const { textures, writes, signalled } = streamer(colour, data);
  const opened = writes();
  assert.equal(textures.followSampling(), false, 'nothing moved: nothing written');
  assert.equal(writes(), opened);
  colour.anisotropy = 8;
  assert.equal(textures.followSampling(), false, 'a field without a version is not read');
  colour.version++;
  assert.equal(textures.followSampling(), true);
  assert.deepEqual(signalled, [[1]], 'the colour slot, as a landed tile');
  assert.equal(textures.followSampling(), false, 'the same version: written once');
  // A host recomposes a placement without a version: the transform is compared all the same.
  data.transform[6] = 0.5;
  assert.equal(textures.followSampling(), true, 'a data map moved');
  assert.deepEqual(signalled, [[1]], 'no shadow reads a data map');
  assert.equal(writes(), opened + 2, 'one send per atlas that moved');
});
