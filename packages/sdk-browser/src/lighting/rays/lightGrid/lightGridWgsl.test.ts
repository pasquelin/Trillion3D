import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_GRID_OVERFLOW } from './lightGridLayout.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { declaredBindings } from '../../../gpu/core/wgslLayoutMatch.fixture.ts'
import {
  LIGHT_GRID_BUILD_BINDINGS,
  lightGridBuildProgram,
  lightGridLookupWgsl,
} from './lightGridWgsl.ts'

test('the builder declares the bindings its layout holds', () => {
  const found = declaredBindings(lightGridBuildProgram())
  assert.deepEqual(
    found.map((b) => [b.group, b.binding, b.name]),
    [
      [0, LIGHT_GRID_BUILD_BINDINGS.params, 'lp'],
      [0, LIGHT_GRID_BUILD_BINDINGS.lights, 'lights'],
      [0, LIGHT_GRID_BUILD_BINDINGS.grid, 'grid'],
    ],
  )
  const grid = found[2]!
  assert.deepEqual(
    [grid.kind, grid.format, grid.access],
    ['storageTexture', 'r32uint', 'write-only'],
  )
})

test('the lookup reads the grid as a read-only storage texture at its binding', () => {
  const text = wgslProgram('', [lightGridLookupWgsl(69)])
  const [grid] = declaredBindings(text)
  assert.deepEqual([grid!.binding, grid!.format, grid!.access], [69, 'r32uint', 'read-only'])
})

test('no WGSL text holds a backtick', () => {
  for (const text of [lightGridBuildProgram(), wgslProgram('', [lightGridLookupWgsl(1)])])
    assert.ok(!text.includes('`'))
})

test('a cell that more lights overlap than it keeps says so, and its lookup loops over every light', () => {
  const build = lightGridBuildProgram()
  const lookup = wgslProgram('', [lightGridLookupWgsl(1)])
  assert.ok(build.includes(`select(visible,${LIGHT_GRID_OVERFLOW}u,overflow)`))
  assert.ok(
    lookup.includes(
      `if(n==${LIGHT_GRID_OVERFLOW}u){return LitCell(directLights.count,LIT_CELL_ALL`,
    ),
  )
})

test("the builder reuses the engine's plane and slab helpers", () => {
  const build = lightGridBuildProgram()
  assert.ok(build.includes('fn boxBehindPlane('))
  assert.ok(build.includes('rayInverseDirection(d)'))
  assert.ok(!build.includes('lgBoxBehindPlane'))
})
