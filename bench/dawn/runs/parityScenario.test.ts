import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  PARITY_COLUMNS,
  pageClipAction,
  parityPose,
  parityScenario,
  poseParity,
  readParityFile,
} from './parityScenario.ts'
import { readScenario } from './scenario.ts'
import { runTrack } from './trackFrames.ts'

/** Row `i` of a path: the eye walks along -z, the target is 100 m ahead, the clip's time is `i / 60`. */
const row = (i: number) => [i, i / 60, 0, 1.7, 12 - i, 0, 1.7, -88 - i, i / 60]

const made: string[] = []
afterEach(() => {
  delete process.env.PARITY_PATHS
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A parity file of two paths, written where `PARITY_PATHS` names it. */
function writeFile(edit: (json: Record<string, any>) => void = () => {}) {
  const json: Record<string, any> = {
    schema: 'parity-paths/1',
    fps: 60,
    width: 4112,
    height: 2294,
    near: 0.05,
    far: 3000,
    fovVerticalDegrees: 55,
    warmupFrames: 3,
    frameColumns: PARITY_COLUMNS,
    paths: {
      walk: { rows: [0, 1, 2, 3, 4].map(row), shots: [0, 4] },
      hold: { rows: [0, 1].map(() => row(0)).map((r, i) => [i, ...r.slice(1)]), shots: [] },
    },
  }
  edit(json)
  const dir = mkdtempSync(join(tmpdir(), 'parity-'))
  made.push(dir)
  const file = join(dir, 'parity-paths.json')
  writeFileSync(file, JSON.stringify(json))
  process.env.PARITY_PATHS = file
  return file
}

test('the file is read as it is given: the optics once, a path an array of nine-number rows', () => {
  const file = readParityFile(writeFile())
  assert.deepEqual(
    [file.fps, file.width, file.height, file.near, file.far, file.fov, file.warmup],
    [60, 4112, 2294, 0.05, 3000, 55, 3],
  )
  assert.deepEqual(Object.keys(file.paths), ['walk', 'hold'])
  assert.deepEqual(file.paths.walk.rows[3], row(3))
  assert.deepEqual(file.paths.walk.shots, [0, 4])
})

test('a file whose schema, columns, rows or captures do not agree is refused', () => {
  const refused = (edit: (json: Record<string, any>) => void, match: RegExp) =>
    assert.throws(() => readParityFile(writeFile(edit)), match)
  refused((json) => (json.schema = 'parity-paths/2'), /schema/)
  refused((json) => (json.frameColumns = ['frame', 't']), /columns/)
  refused((json) => (json.paths.walk.rows[2] = [2, 0, 0]), /image 2/)
  refused((json) => (json.paths.walk.rows[1][0] = 7), /image 1/)
  refused((json) => (json.paths.walk.shots = [5]), /image 5/)
  refused((json) => (json.paths.walk.rows = []), /no image/)
  refused((json) => delete json.fps, /fps/)
  refused((json) => (json.warmupFrames = -1), /warmupFrames/)
})

test('a path is played after its warm-up, held on the first pose, at the file’s size', () => {
  writeFile()
  const scenario = parityScenario('walk')
  assert.equal(scenario.name, 'parity:walk')
  assert.equal(scenario.warm, 0)
  assert.deepEqual(scenario.display, { width: 4112, height: 2294, ratio: 1 })
  const [warm, path] = scenario.segments
  assert.deepEqual(
    [warm.name, warm.frames, warm.measure, warm.capture],
    ['walk warm', 3, false, undefined],
  )
  assert.ok(warm.track!.rows.every((r) => r === warm.track!.rows[0]))
  assert.equal(warm.track!.rows[0], path.track!.rows[0])
  assert.deepEqual(
    [path.name, path.frames, path.capture, path.track!.shots],
    ['walk', 5, true, [0, 4]],
  )
  assert.deepEqual(
    [path.track!.fov, path.track!.near, path.track!.far, path.track!.fps],
    [55, 0.05, 3000, 60],
  )
  assert.deepEqual(
    parityScenario('all').segments.map((segment) => segment.name),
    ['walk warm', 'walk', 'hold warm', 'hold'],
  )
  writeFile((json) => (json.warmupFrames = 0))
  assert.deepEqual(
    parityScenario('walk').segments.map((segment) => segment.name),
    ['walk'],
    'no warm-up to play',
  )
  assert.throws(() => parityScenario('nowhere'), /no path nowhere; one of walk, hold/)
})

test('`--scenario parity:<path>` names the scenario; its page is `PARITY_PAGE`, none when that is not set', () => {
  writeFile()
  delete process.env.PARITY_PAGE
  const scenario = readScenario('parity:hold')
  assert.equal(scenario.segments.at(-1)!.name, 'hold')
  assert.equal(scenario.page, undefined)
  process.env.PARITY_PAGE = '/pages/district.html'
  try {
    assert.equal(readScenario('parity:hold').page, process.env.PARITY_PAGE)
  } finally {
    delete process.env.PARITY_PAGE
  }
})

test('each image is posed from its row: the eye, the target, the field, the clip stopped and sought to its time', () => {
  writeFile()
  const { track } = parityScenario('walk').segments[1]
  const calls: unknown[] = []
  const world = {
    camera: { set: (pose: object) => calls.push(['camera', pose]) },
    controls: {
      target: { set: (...target: number[]) => calls.push(['target', target]) },
      update: () => calls.push(['update']),
    },
    invalidate: () => calls.push(['invalidate']),
  }
  const motion = {
    stop() {
      calls.push(['stop'])
      return { seek: (time: number) => calls.push(['seek', time]) }
    },
  }
  poseParity(world, motion, track!, 3)
  assert.deepEqual(calls, [
    ['camera', { position: [0, 1.7, 9], target: [0, 1.7, -91], fov: 55 }],
    ['target', [0, 1.7, -91]],
    ['update'],
    ['stop'],
    ['seek', 3 / 60],
    ['invalidate'],
  ])
  assert.deepEqual(parityPose(track!, 0).position, [0, 1.7, 12])
})

test('the clip is the one of the mixer the page made; a page with none is refused', () => {
  const action = { stop: () => ({ seek: () => {} }) }
  const clip = {}
  const mixers = [
    { root: {}, clipAction: () => assert.fail('a mixer with no clip') },
    {
      root: { animations: [clip] },
      clipAction: (given: unknown) => (assert.equal(given, clip), action),
    },
  ]
  assert.equal(pageClipAction(mixers), action)
  assert.throws(() => pageClipAction([]), /no animation mixer/)
})

test('the images a path asks for are captured among its frames, each after its own, the last frame played', async () => {
  writeFile()
  const { track } = parityScenario('walk').segments[1]
  const log: string[] = []
  const frame = { drawn: true }
  const rig = {} as never
  // `runFrames` is the engine's loop; the path's chunks are told apart by the frames they pose.
  const frames = await runTrack(
    rig,
    { time: 0, frame: 0, frozen: false, step: 1000 / 60 },
    track!,
    (i) => log.push(`pose ${i}`),
    async (i) => log.push(`shot ${i}`) && i,
    async (_, __, count, before) => {
      assert.ok(before, 'the track poses each image through the frames’ `before`')
      for (let i = 0; i < count; i++) before(i)
      return Array(count).fill(frame) as never
    },
  )
  assert.deepEqual(log, ['pose 0', 'shot 0', 'pose 1', 'pose 2', 'pose 3', 'pose 4', 'shot 4'])
  assert.deepEqual(frames.shots, [0, 4])
  assert.equal(frames.frames.length, 5)
})
