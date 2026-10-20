// A pixel's resolve issues a bounded number of fetches per display pixel, one program at every
// render scale, still or moving (`resolveWgsl.ts`): the nearest surface and reprojection edge the
// analysis pass found for its render texel in one load (`closestRead`) — the 3×3 depths and
// identifiers are gathered once per render texel by the analysis (`closestAnalysis`), their
// identifiers counted per display pixel —, the 3×3's 9 colour loads, which the kernel's five reuse,
// and the spatial anti-aliaser's texel where aliasing shows: 11, all a pixel whose history is
// refused reads (the closest surfaces scattered where they stood are words of a buffer, no
// fetch). A kept pixel then reads its share texel, the history's five Catmull-Rom samples, the
// reactive value, the shading analysis's texel and its flicker word: 9 more. The as-is resolve
// adds its 3×3 flags.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countTaaFetches } from './taaFetchCount.ts'

test('the resolve issues 20 fetches a kept pixel, 11 a refused one, at every scale, still or moving', () => {
  const fragment = countTaaFetches
  // The analysis gathers 16 identifiers per render texel: 16 per display pixel at the display's
  // size, 4 at half of it per axis.
  const ids = (scale: number) => (scale === 1 ? 16 : 4)
  for (const scale of [1, 0.5])
    for (const moving of [true, false]) {
      assert.deepEqual(fragment(scale, false, false, moving), { fetches: 20, ids: ids(scale) })
      assert.deepEqual(fragment(scale, true, false, moving), { fetches: 11, ids: ids(scale) })
    }
  // The as-is resolve adds its 3×3 flags, still or moving.
  assert.deepEqual(fragment(1, false, true), { fetches: 29, ids: 16 })
  assert.deepEqual(fragment(0.5, false, true, false), { fetches: 29, ids: 4 })
})
