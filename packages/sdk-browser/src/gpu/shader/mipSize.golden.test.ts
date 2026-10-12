// The shader's mip side (`mipSize`, `packages/math/src/wgsl/integer.ts`), its shipped text run in
// JavaScript, against the Rust twin's sides in `packages/math/golden/mip_size.json`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { mipSize2 } from '../../../../math/src/wgsl/integer.ts'
import { eachGolden } from '../../../../math/src/golden.fixture.ts'

const run = shaderRun<Record<string, (...args: never[]) => never>>(
  wgslModule(mipSize2),
  ['mipSize', 'mipSize2'],
  {},
) as unknown as Record<string, (...args: unknown[]) => unknown>

test('the shader’s mip side is the Rust twin’s on every reference case', () => {
  eachGolden('mip_size', 'mip_size', ([size, level], [side], line) => {
    assert.equal(run.mipSize(size, level), side, line)
    assert.deepEqual(Array.from(run.mipSize2([size, size + 1], level) as ArrayLike<number>), [
      side,
      Math.max(1, (size + 1) >>> Math.min(level, 31)),
    ])
  })
})
