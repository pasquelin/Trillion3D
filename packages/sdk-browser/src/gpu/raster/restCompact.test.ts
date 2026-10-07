import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuRestCompact } from './restCompact.ts'
import { REST_COMPACT_SHADER } from './restCompactWgsl.ts'
import { VIS_SHADER } from '../../visibility/buffer.ts'
import { BASE_SLOTS } from '../draw/draw.ts'
import { HIZ_REJECTED_WGSL, VERDICT_REJECTED } from '../partition/contract.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { dispatchGrid } from '../dispatch/grid.ts'
import type { OpenPass } from '../core/lazyComputePass.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

// Behaviour 1: compaction keeps EXACTLY what the vertex stage drew — both texts carry the same
// `hizRejected`, and compaction keeps its negation. A hand-copied predicate had truncated the
// whole tested half when the verdict moved to three values.
test('tested-half compaction applies the vertex-stage predicate', () => {
  assert.ok(
    VIS_SHADER.includes(HIZ_REJECTED_WGSL.text),
    'the vertex stage binds the shared predicate',
  )
  assert.ok(REST_COMPACT_SHADER.includes(HIZ_REJECTED_WGSL.text), 'compaction binds the same text')
  assert.match(VIS_SHADER, /if\(hizRejected\(page\.hizSlot\)\)/)
  // An instance word's row (`INSTANCE_WORD_WGSL`).
  assert.match(REST_COMPACT_SHADER, /return !hizRejected\(pages\[instanceRow\(word\)\]\.hizSlot\);/)
  assert.match(wgslSource(HIZ_REJECTED_WGSL), new RegExp(`==${VERDICT_REJECTED}u;`))
})

// Behaviour 2: the survivors are written back from a copy, in three dispatches, each at its
// tile's offset plus its rank among the earlier survivors of its tile: their order is the one
// the draw compact gave them. Word 0 of the command, the vertex count, is never rewritten.
test('compaction scatters the survivors from a copy and only rewrites the instance count', () => {
  for (const kernel of ['restCount', 'restScan', 'restScatter'])
    assert.match(REST_COMPACT_SHADER, new RegExp(`fn ${kernel}\\(`))
  assert.match(REST_COMPACT_SHADER, /work\[at\]=row;/)
  assert.match(REST_COMPACT_SHADER, /row=work\[start\+x\]/)
  assert.match(REST_COMPACT_SHADER, /instances\[start\+work\[tileWord\(n,t\)\]\+rank\]=row;/)
  assert.match(REST_COMPACT_SHADER, /indirect\[restSlotAt\(n\)\*4u\+1u\]=laneSums\[63u\];/)
  assert.doesNotMatch(REST_COMPACT_SHADER, /indirect\[[^\]]*\*4u\]=/)
})

// Behaviour 2b: a tile past its slot's count leaves at once, from uniform control flow (the count
// is broadcast by \`workgroupUniformLoad\`), so its lanes run no scan; tile 0 still records it.
test('a tile past its slot count runs no scan', () => {
  assert.match(REST_COMPACT_SHADER, /return workgroupUniformLoad\(&slotCount\);/)
  assert.match(REST_COMPACT_SHADER, /if\(t>0u&&t\*64u>=count\)\{return;\}/)
  const scatter = REST_COMPACT_SHADER.slice(REST_COMPACT_SHADER.indexOf('fn restScatter'))
  assert.ok(scatter.indexOf('if(t*64u>=count){return;}') < scatter.indexOf('laneScan('))
})

// Behaviour 3: the rank of tested slot number n follows the `slotOf` convention — three face
// modes per layer, the tested half after the occluders.
test('visited slots are those of the tested half', () => {
  const half = BASE_SLOTS / 2
  assert.match(
    REST_COMPACT_SHADER,
    new RegExp(`return \\(n/${half}u\\)\\*${BASE_SLOTS}u\\+${half}u\\+n%${half}u;`),
  )
})

// Behaviour 4: without compute there is no compaction and the frame keeps the previous path.
test('a device without compute does not mount compaction', async () => {
  const buffer = {} as GPUBuffer
  const { device } = fakeDevice({ compute: false })
  const made = await createGpuRestCompact(device, {
    instances: buffer,
    indirect: buffer,
    slotOffsets: buffer,
    flags: buffer,
  })
  assert.equal(made, undefined)
})

// Behaviour 5: a slot of more tiles than one dimension of a dispatch holds runs them in rows up
// y (`dispatchGrid`), the slot up z; the shipped flat rank ranks every in-range group's tile
// once, a single row's as x did, and the groups past the tiles leave.
test('tiles past one dimension of a dispatch run in rows up y, each tile ranked once', async () => {
  const buffer = { size: 4 * 64 } as GPUBuffer
  const { device } = fakeDevice()
  const made = (await createGpuRestCompact(device, {
    instances: buffer,
    indirect: buffer,
    slotOffsets: buffer,
    flags: buffer,
  }))!
  const tiles = 65_537,
    calls: number[][] = []
  const pass = {
    setBindGroup() {},
    setPipeline() {},
    dispatchWorkgroups: (...xyz: number[]) => void calls.push(xyz),
  } as unknown as GPUComputePassEncoder
  assert.ok(made.encode({ pass } as OpenPass, 3, tiles * 64, buffer))
  assert.deepEqual(calls, [[65_535, 2, 3], [1], [65_535, 2, 3]])
  const { flatIndex } = shaderRun<{
    flatIndex: (wg: number[], n: number[], lanes: number) => number
  }>(REST_COMPACT_SHADER, ['flatIndex'], {})
  for (const count of [5, tiles]) {
    const [x, y] = dispatchGrid(count),
      seen = new Uint8Array(count)
    let past = 0
    for (let row = 0; row < y; row++)
      for (let at = 0; at < x; at++) {
        const t = flatIndex([at, row, 2], [x, y, 3], 1)
        if (t >= count) past++
        else assert.equal(seen[t]++, 0, `tile ${t} ranked twice`)
        if (y === 1) assert.equal(t, at, 'one row: the tile of x, as before the rows')
      }
    assert.ok(seen.every((hit) => hit === 1))
    assert.equal(past, x * y - count)
  }
  made.dispose()
})
