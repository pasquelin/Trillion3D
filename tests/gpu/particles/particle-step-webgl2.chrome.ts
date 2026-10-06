// The engine's WebGL2 particle step, in Chrome: its GLSL compiles, two steps ten kilometres out move
// a newborn 1 mm each and age it, a particle born dead and a slot never emitted into stay as they
// are, and a 60 s life at 144 Hz dies at 60 s and stays where it died while the steps go on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './particleStepWebgl2Page.ts'

const PAGE = resolve(import.meta.dirname, 'particleStepWebgl2Page.ts')

test(
  'the WebGL2 particle step drifts, keeps what it must not move, and stops a dead life',
  { timeout: 60_000 },
  async () => {
    const { images, dead, error } = await inChrome<ReturnType<typeof execute>>(PAGE, 'execute')
    console.log(JSON.stringify({ images, dead, error }))
    assert.equal(error, 0, 'GL error')
    const [first, second] = images
    const within = (x: number, expected: number) => Math.abs(x - expected) <= 1e-6
    assert.ok(within(first[0], 0.251) && within(second[0], 0.252), `x: ${first[0]}, ${second[0]}`)
    assert.ok(second[1] > first[1] && first[1] > 0, 'rose, from the emitter')
    assert.deepEqual([first[3], second[3]], [1 / 64, 2 / 64], 'aged by each step')
    assert.deepEqual(second.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged')
    assert.deepEqual(second.slice(16, 24), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched')
    const { steps, particle } = dead,
      [, y, , age, , , , lifetime] = particle
    assert.ok(age >= lifetime && age < lifetime + 0.02, `died at 60 s: age ${age}`)
    assert.ok(steps / 144 > age + 3 / 144, `stepped on past its death: ${steps} steps`)
    assert.ok(Math.abs(y - age) < 1e-3, `stayed where it died: y ${y}, age ${age}`)
  },
)
