// The shadow raster's fragment (`renderRasterWgsl.ts`) does no work a fragment's word does not need:
// an unmasked row — whose `maskKeep` keeps every fragment at its first test — reads no page, and a
// depth no greater than the pool's word already held writes nothing (`vsmPoolAtomicMax`): a word
// only grows, so it ends the max of every depth drawn into it, whatever their order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionText } from '../bounce/wgslBody.fixture.ts';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { FLAG_MASK } from '../visibility/types.ts';
import { vsmBindingsWgsl, vsmLayout } from './resources.ts';
import { VSM_RENDER_RASTER_FRAGMENT_SPECS, vsmRenderRasterWgsl } from './renderRasterWgsl.ts';
import { seeded } from './planFrames.fixture.ts';

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }, 2 ** 27);
const CODE = vsmRenderRasterWgsl(LAYOUT);

test('an unmasked row reads no page in the fragment: maskKeep keeps it whole', () => {
  const vertex = functionText(CODE, 'vsmRenderVs'),
    fragment = functionText(CODE, 'vsmRenderFs');
  assert.ok(vertex.includes(`out.masked=page.flags&${FLAG_MASK}u;`));
  assert.ok(
    fragment.includes(
      'if(onEmitter||(in.masked!=0u&&!maskKeep(pages[in.row],in.uv,1.0,gx,gy))){discard;}',
    ),
  );
  assert.equal(fragment.match(/pages\[/g)?.length, 1, 'the one page read, behind the flag');
  // maskKeep's first test: a row without the mask flag keeps the fragment, whatever it holds.
  const { maskKeep } = shaderRun<{
    maskKeep: (page: object, uv: number[], a: number, dx: number[], dy: number[]) => boolean;
  }>(CODE, ['maskKeep'], {});
  const unmasked = new Proxy(
    { flags: 0xffffffff & ~FLAG_MASK },
    {
      get: (page, key) => {
        if (key !== 'flags') throw new Error(`read ${String(key)}`);
        return page.flags;
      },
    },
  );
  assert.equal(maskKeep(unmasked, [0, 0], 1, [0, 0], [0, 0]), true);
});

test('the pool max writes only a greater depth, and every word ends the max of its depths', () => {
  const pool = vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, LAYOUT);
  const accessor = pool.slice(pool.indexOf('fn vsmPoolAtomicMax('));
  const parts = [...accessor.matchAll(/^ case \d+u:\{(.*)\}$/gm)].map((m) => m[1]);
  assert.ok(parts.length >= 2, 'a part a slice at least');
  for (const body of parts)
    assert.match(body, /^if\(atomicLoad\(&(\w+)\[i\]\)<value\)\{atomicMax\(&\1\[i\],value\);\}$/);
  // The body run on random depths in random orders: the word, and the writes it took.
  let writes = 0;
  const rand = seeded(5);
  for (let round = 0; round < 200; round++) {
    const word = [0];
    const run = shaderRun<{ join: (value: number) => void }>(
      `fn join(value:u32){${parts[0].replace(/\w+\[i\]/g, 'word[0]')}}`,
      ['join'],
      {
        word,
        atomicLoad: (p: { get: () => number }) => p.get(),
        atomicMax: (p: { get: () => number; set: (v: number) => void }, v: number) => (
          writes++,
          p.set(Math.max(p.get(), v))
        ),
      },
    );
    const depths = Array.from({ length: 1 + Math.floor(rand() * 40) }, () =>
      Math.floor(rand() * 2 ** 32),
    );
    writes = 0;
    let rises = 0,
      best = 0;
    for (const d of depths) {
      if (d > best) (rises++, (best = d));
      run.join(d);
    }
    assert.equal(word[0], best, 'the max of the depths');
    assert.equal(writes, rises, 'a write per new greatest depth, none else');
  }
});
