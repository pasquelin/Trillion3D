import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pageFile, readPage } from './page.ts'
import { BENCH_SCENE, START_KEY, WORLD_SCENARIO } from './worldScenario.ts'

/** The repository the bench scene lives in. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

test('the scenario plays the bench scene, every segment captured, 1 200 frames in all', () => {
  assert.equal(WORLD_SCENARIO.page, BENCH_SCENE)
  assert.deepEqual(
    WORLD_SCENARIO.segments.map((segment) => segment.name),
    ['approach', 'glide', 'yard', 'bed', 'still'],
  )
  assert.ok(WORLD_SCENARIO.segments.every((segment) => segment.capture))
  assert.equal(
    WORLD_SCENARIO.segments.reduce((frames, segment) => frames + segment.frames, 0),
    1200,
  )
})

test('the motion starts on the first measured frame, and only there', () => {
  const pressed = WORLD_SCENARIO.segments.flatMap((segment, rank) =>
    (segment.events ?? [])
      .filter((event) => event.type === 'keydown' && event.code === START_KEY)
      .map((event) => [rank, event.frame]),
  )
  assert.deepEqual(pressed, [[0, 0]])
  assert.notEqual(WORLD_SCENARIO.segments[0].measure, false)
})

test('the scene page starts its motion on the key the scenario presses, its runtime alone imported', () => {
  const [script] = readPage(pageFile(BENCH_SCENE, ROOT)).scripts
  assert.match(script, new RegExp(`START_KEY = '${START_KEY}'`))
  const imported = [...script.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((found) => found[1])
  assert.deepEqual(imported.sort(), ['../runtime/engine.js', '../runtime/kit.js'])
})
