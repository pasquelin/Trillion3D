// The projection's tiles (`projectionWgsl.ts`): a group finds the lights that may reach its 8×8
// pixels from the box its lit points span (`vsmLightMayReachTile`, a lane a light), tests only those
// at each pixel (`vsmLightParticipates`), and stores only the layers holding a light one of its
// pixels is in, their bits in its tile word. The shipped kernel runs here lane by lane on generated
// tiles — many lights of every kind, radii met at a pixel to a few units in the last place, lanes
// out of the rect, sky, empty tiles, a point not finite —, its every trace call and store recorded,
// against the kernel before tiles: every light tested at every pixel, every layer stored. The traces
// each light runs, in order, with the same `participating` at every lane — hence the same votes —,
// and every lane the resolve reads (`vsmMaskFactor`) holds the same code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, lightsOf, pixelsOf } from './projectionTiles.fixture.ts';
import { reference, shipped } from './projectionTileRun.fixture.ts';
import { VSM_LIGHT_KIND_DIRECTIONAL as DIRECTIONAL } from './constants.ts';
import { seeded } from './planFrames.fixture.ts';

test('a tile traces what every light tested at every pixel traces, and the resolve reads the same codes', () => {
  const rand = seeded(1831);
  let pruned = 0,
    tested = 0,
    stored = 0,
    layers = 0;
  for (let round = 0; round < 84; round++) {
    const kind = CASES[round % CASES.length];
    const oneLight = round % 12 === 5;
    const count = oneLight ? 1 : [64, 2, 17, 40, 63][round % 5];
    const group: [number, number] = [round % 5, Math.floor(round / 5)];
    const pixels = pixelsOf(rand, group, kind);
    const lit = pixels.filter((p) => p.info.valid).map((p) => p.shifted);
    const lights = lightsOf(
      rand,
      count,
      lit.length ? lit : [[0, 0, 0]],
      kind === 'corner' ? pixels[0].shifted : undefined,
    );
    const run = shipped(pixels, lights, oneLight);
    const old = reference(pixels, lights, oneLight);
    assert.deepEqual(run.calls, old.calls, `round ${round} (${kind}): the same traces, in order`);
    // The layers stored: those holding a light of the tile; their bits, the tile's word.
    let expectedLayers = 0;
    old.tile.forEach((held, k) => held && (expectedLayers |= 1 << (k >> 2)));
    assert.equal(run.tileLayers, expectedLayers, `round ${round}: the tile word`);
    for (const [lane, p] of pixels.entries()) {
      if (!p.inRect) continue;
      for (let k = 0; k < old.codes[lane].length; k++) {
        const layer = k >> 2;
        // What `vsmMaskFactor` decodes: the stored lane where the tile word holds its layer, else 0.
        const word = (run.tileLayers >> layer) & 1 ? run.stores.get(`${p.pos}:${layer}`) : 0;
        assert.notEqual(word, undefined, `round ${round}: layer ${layer} stored at ${p.pos}`);
        assert.equal(
          (word! >>> (8 * (k & 3))) & 255,
          old.codes[lane][k],
          `round ${round}, ${p.pos}, light ${k}`,
        );
      }
    }
    for (const key of run.stores.keys()) {
      const layer = Number(key.split(':')[1]);
      assert.ok((run.tileLayers >> layer) & 1, `round ${round}: no store of an unheld layer`);
    }
    stored += run.stores.size;
    layers += pixels.filter((p) => p.inRect).length * Math.ceil(count / 4);
    tested += old.inLight.length * count;
    pruned += old.tile.filter((held) => !held).length * 64;
  }
  // The tiles do prune: lights and layers the old kernel tested and stored for nothing.
  assert.ok(pruned > tested / 4, `${pruned} of ${tested} light tests in tiles no pixel is in`);
  assert.ok(stored < (layers * 3) / 4, `${stored} of ${layers} layer stores`);
});

test('a pass of suns alone, every light its candidate, traces what every light tested traces', () => {
  const rand = seeded(1832);
  for (let round = 0; round < 28; round++) {
    const kind = CASES[round % CASES.length];
    const pixels = pixelsOf(rand, [round % 4, 0], kind);
    const lit = pixels.filter((p) => p.info.valid).map((p) => p.shifted);
    const lights = lightsOf(rand, [1, 3, 35, 64][round % 4], lit.length ? lit : [[0, 0, 0]]).map(
      (light) => ({ ...light, kind: DIRECTIONAL, invRadius: 0 }),
    );
    const suns = shipped(pixels, lights, false, 1),
      old = reference(pixels, lights, false);
    assert.deepEqual(suns.calls, old.calls, `round ${round} (${kind})`);
    let layers = 0;
    old.tile.forEach((held, k) => held && (layers |= 1 << (k >> 2)));
    assert.equal(suns.tileLayers, layers, `round ${round}: the tile word`);
  }
});
