// The cut's worlds are brought to the eye on the GPU: the kernel's text, run as is
// (`shaderRun`), takes the eye off each exact translation in double and rounds once — the bits the
// CPU's rebase wrote (`worldToRenderOrigin`), on random translations and eyes and on the edges.
// A selection rebases before a cut whose eye moved or after worlds were written, and only then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  pair,
  type Pair,
} from '../../placement/composeDoubles.fixture.ts'
import { rebaseWorldsOnGpu } from './worldRebase.ts'
import { WORLD_REBASE_WGSL } from './worldRebaseWgsl.ts'
import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'

const run = shaderRun<{ rebased(t: Pair, e: Pair): number }>(
  WORLD_REBASE_WGSL,
  [...DOUBLE_HELPERS, 'toF32', 'rebased'],
  { countLeadingZeros },
)
const f32Bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]

test('a translation brought to the eye on the GPU is the CPU rebase, bit for bit', () => {
  const next = random(1473)
  const EDGES = [NaN, 0, -0, Infinity, -Infinity, 1e39, -1e39, 1e-45, 5e-324, 2 ** 24 + 1, 1e300]
  const values: number[] = [...EDGES]
  for (let i = 0; i < 3000; i++) values.push((next() - 0.5) * 10 ** Math.floor(next() * 14 - 3))
  for (const t of values)
    for (const e of [values[Math.floor(next() * values.length)], 0, -0, t]) {
      const expected = f32Bits(t - e),
        got = run.rebased(pair(t), pair(e)) >>> 0
      if (Number.isNaN(t - e)) assert.equal(got, 0x7fc00000, `${t} − ${e}`)
      else assert.equal(got, expected, `${t} − ${e}`)
    }
})

test('a selection rebases before a cut whose eye moved or after worlds were written, only then', () => {
  const encoded: number[][] = []
  // Whatever writes the worlds — a pose sent, roots appended — advances `worldsWritten`.
  const selection = {
    worldsWritten: 0,
    dispatch: () => undefined,
    dispose: () => {},
  } as unknown as GpuSelection & { worldsWritten: number }
  const device = {
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { submit: () => {} },
  } as unknown as GPUDevice
  const rebase = {
    encode: (_: unknown, eye: ArrayLike<number>) => void encoded.push(Array.from(eye)),
    dispose: () => undefined,
  }
  rebaseWorldsOnGpu(selection, device, rebase)
  const at = (x: number) => ({ cameraWorld: [x, 0, 0] }) as unknown as SelectionUniforms
  selection.dispatch(at(0))
  selection.dispatch(at(0))
  selection.dispatch(at(1))
  selection.worldsWritten++
  selection.dispatch(at(1))
  selection.dispatch(at(1))
  assert.deepEqual(encoded, [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
  ])
})
