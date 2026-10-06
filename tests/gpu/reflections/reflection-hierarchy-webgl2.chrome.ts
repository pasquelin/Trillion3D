// The WebGL2 reflection capture, in Chrome: the complete cluster program compiles, and a 7 × 5
// frame — odd both ways, so every level drops a row and a column — reduces into a radiance chain
// that averages every texel and a depth hierarchy that keeps the nearest and the farthest, exactly.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './reflectionHierarchyWebgl2Page.ts'

const PAGE = resolve(import.meta.dirname, 'reflectionHierarchyWebgl2Page.ts')

test(
  'the WebGL2 reflection hierarchy reduces an odd-size frame exactly',
  { timeout: 60_000 },
  async () => {
    const result = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute')
    console.log(JSON.stringify(result))
    assert.equal(result.reductionError, 0)
    assert.equal(result.error, 0)
    const [red, alpha, near, far] = result.values
    // Level 2 of 7 × 5 covers all 35 texels: one of them 16 against 34 at 1, alpha 0 against 1.
    assert.ok(Math.abs(red - (1 + 15 / 35)) < 0.003, `red ${red}`)
    assert.ok(Math.abs(alpha - (1 - 1 / 35)) < 0.002, `alpha ${alpha}`)
    // The depth bounds keep the extremes, not an average.
    assert.ok(Math.abs(near - 0.25) < 1e-6, `near ${near}`)
    assert.ok(Math.abs(far - 0.875) < 1e-6, `far ${far}`)
  },
)
