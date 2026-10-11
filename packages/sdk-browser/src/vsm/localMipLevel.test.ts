// The local light's mip level is written twice, in TypeScript (`vsmLocalMipLevel`, doubles: the
// CPU's setup) and in WGSL (`pageTableWgsl.ts`, f32: the marking and the traces). The two are the
// one rule: on footprints and biases whose level sits clear of a boundary (where f32 and doubles
// may round either way, `resolutionLodBiasZero.test.ts`), they give the same level.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { VSM_MIPS, vsmLocalMipLevel } from './constants.ts'
import { VSM_STRUCTS_WGSL } from './pageTableWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { halton } from '../../../math/src/sequence/halton.ts'

const wgsl = shaderRun<{
  vsmLocalMipLevel: (footprint: number, map: number, pressure: number, extra: number) => number
}>(wgslModule(VSM_STRUCTS_WGSL), ['vsmLocalMipLevel'], { VSM_MIPS })

test('the WGSL local mip level is the TypeScript one, across the footprints, biases and the clamps', () => {
  let compared = 0,
    top = 0,
    bottom = 0
  for (let i = 1; i <= 4000; i++) {
    const footprint = 2 ** (halton(i, 2) * 24 - 8),
      map = halton(i, 3) * 6 - 2,
      pressure = halton(i, 5) * 3,
      extra = i % 3 ? 0 : halton(i, 7) * 2
    const level = Math.log2(footprint) + map + pressure + extra
    if (Math.abs(level - Math.round(level)) < 1e-3) continue
    const expected = vsmLocalMipLevel(footprint, map, pressure, extra)
    assert.equal(wgsl.vsmLocalMipLevel(Math.fround(footprint), map, pressure, extra), expected)
    compared++
    if (expected === VSM_MIPS - 1) top++
    if (expected === 0) bottom++
  }
  assert.ok(compared > 3000 && top > 50 && bottom > 50, `${compared} ${top} ${bottom}`)
})
