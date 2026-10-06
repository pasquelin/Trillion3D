// The image contract against the texel store the read replaced (`transmissionRead.fixture.ts`): on
// generated scenes, the changed pixels are edges alone — the changed mask eroded once by a 3 × 3
// square is empty — and every pixel inside one caster is identical in 8 bits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryOf, readAt, reader } from './transmissionRead.fixture.ts'
import { byte, scene, texelStore } from './transmissionScenes.fixture.ts'
import { type V, f32, geometry, random } from './transmissionSheets.fixture.ts'

test('the changed pixels are edges alone: the changed mask eroded by a 3 × 3 square is empty', () => {
  // A pixel is 6 texels wide (the texel is 1/5.7 to 1/11.3 of a pixel at the sea's levels).
  const pixel = 6
  for (const seed of [4, 5]) {
    const casters = scene(seed)
    const read = reader(memoryOf(casters))
    const store = texelStore(casters)
    const rnd = random(200 + seed)
    const offset = [rnd(), rnd()].map((x) => x * pixel)
    const n = Math.floor((128 - pixel) / pixel)
    const changed: boolean[][] = []
    let changes = 0,
      interior = 0
    for (let y = 0; y < n; y++) {
      changed.push([])
      for (let x = 0; x < n; x++) {
        const p = [offset[0] + x * pixel, offset[1] + y * pixel].map(f32)
        const now = byte(readAt(read, p, 0.001)),
          before = byte(store(p, 0.001))
        const differs = now.some((c, i) => c !== before[i])
        changed[y].push(differs)
        if (differs) changes++
        // Inside one caster with its four texels covered alike, the value is the store's to the bit.
        const centres = [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ].map(([dx, dy]) => [
          Math.floor(p[0] - 0.5) + 0.5 + dx + 0.5,
          Math.floor(p[1] - 0.5) + 0.5 + dy + 0.5,
        ])
        const under = (q: V) => casters.filter((c) => geometry.vsmTInside(...c.tri, q)).length
        if (centres.every((q) => under(q) === 1) && under(p) === 1) {
          assert.ok(!differs, `seed ${seed}: interior pixel at ${p} changed`)
          interior++
        }
      }
    }
    let eroded = 0
    for (let y = 1; y + 1 < n; y++)
      for (let x = 1; x + 1 < n; x++) {
        let all = true
        for (let dy = -1; dy <= 1 && all; dy++)
          for (let dx = -1; dx <= 1 && all; dx++) all = changed[y + dy][x + dx]
        if (all) eroded++
      }
    assert.equal(eroded, 0, `seed ${seed}: ${changes} changed pixels, none of them a patch`)
    assert.ok(interior > 50, `seed ${seed}: ${interior} interior pixels compared`)
  }
})
