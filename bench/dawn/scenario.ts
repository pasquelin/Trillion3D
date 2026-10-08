// A bench scenario: the same situation on every run, frame for frame — keys held, drags, the
// measurer's orbit, wheel turns, camera poses, or the events a person played recorded frame by
// frame (`recorder.js`) — in named segments, each measured and optionally captured on its own.
import { readFileSync } from 'node:fs'
import type { World } from '../../packages/sdk-browser/src/index.ts'
import { WORLD_SCENARIO } from './benchScene.ts'
import type { BenchBrowser } from './dom.ts'

/** A point on the canvas as shares of its width and height, so a scenario plays at any size. */
type At = [x: number, y: number]
/** A camera pose: where it stands and what it looks at, world metres. */
type Pose = { position: [number, number, number]; target: [number, number, number] }
/** One input event a recording holds, `frame` counted from its segment's start. */
export type RecordedEvent = {
  frame: number
  type: 'keydown' | 'keyup' | 'pointerdown' | 'pointermove' | 'pointerup' | 'wheel'
  code?: string
  key?: string
  x?: number
  y?: number
  buttons?: number
  button?: number
  deltaY?: number
}
/** A segment: `frames` frames of one situation. `measure: false` plays it unmeasured (a way in). */
export type Segment = {
  name: string
  frames: number
  measure?: boolean
  capture?: boolean
  hold?: string[]
  orbit?: { swing?: number; cycle?: number }
  drag?: { from: At; to: At }
  wheel?: { deltaY: number; every?: number }
  camera?: { from: Pose; to?: Pose }
  events?: RecordedEvent[]
}
export type Scenario = { name: string; page?: string; warm?: number; segments: Segment[] }

/** The measurer's gesture of Chrome (`__m`): a drag swinging ±150 px, two swings per 8 s. */
const ORBIT = { swing: 150, cycle: 960 }

/** Scenarios any page plays: the orbit, a still image, the car driven by keys. */
const SCENARIOS: Record<string, Scenario> = {
  orbit: {
    name: 'orbit',
    segments: [
      { name: 'orbit', frames: 480, orbit: ORBIT, capture: true },
      { name: 'still', frames: 240, capture: true },
    ],
  },
  world: WORLD_SCENARIO,
  still: { name: 'still', segments: [{ name: 'still', frames: 360, capture: true }] },
  drive: {
    name: 'drive',
    segments: [
      { name: 'straight', frames: 360, hold: ['KeyW'], capture: true },
      { name: 'turn left', frames: 240, hold: ['KeyW', 'KeyA'], capture: true },
      { name: 'brake', frames: 180, hold: ['KeyS'] },
      { name: 'still', frames: 240, capture: true },
    ],
  },
}

/** The scenario `name` means: a built-in one, or a JSON file. */
export function readScenario(name: string): Scenario {
  if (SCENARIOS[name]) return SCENARIOS[name]
  const scenario = JSON.parse(readFileSync(name, 'utf8')) as Scenario
  if (!Array.isArray(scenario.segments) || !scenario.segments.every((s) => s.frames > 0))
    throw new Error(`BENCH_SCENARIO: ${name} names no segments of frames`)
  return scenario
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Plays segments on the page: `begin`, then `step(i)` before each of its frames, then `end`. */
export function createPlayer(browser: BenchBrowser, world: World) {
  const canvas = browser.canvases[0]
  const { width, height } = canvas.css
  const pointer = (type: string, [x, y]: At, buttons: number) =>
    canvas.dispatchEvent(
      new browser.InputEvent(type, {
        pointerId: 7,
        pointerType: 'mouse',
        isPrimary: true,
        clientX: x * width,
        clientY: y * height,
        buttons,
        button: 0,
      }),
    )
  // A key goes to the document and on to the window, as a browser's does.
  const key = (type: string, code: string, name = code.replace(/^Key/, '').toLowerCase()) => {
    const init = { code, key: name }
    browser.document.dispatchEvent(new browser.InputEvent(type, init))
    browser.window.dispatchEvent(new browser.InputEvent(type, init))
  }
  const orbitAt = (segment: Segment, i: number): At => {
    const { swing, cycle } = { ...ORBIT, ...segment.orbit }
    return [0.5 + (Math.sin((i / cycle) * Math.PI * 4) * swing) / width, 0.6]
  }
  const pose = ({ position, target }: Pose) => {
    world.camera.position.set(...position)
    world.camera.lookAt(...target)
  }
  const replay = (event: RecordedEvent) => {
    if (event.type === 'keydown' || event.type === 'keyup') key(event.type, event.code!, event.key)
    else if (event.type === 'wheel')
      canvas.dispatchEvent(
        new browser.InputEvent('wheel', {
          deltaY: event.deltaY,
          clientX: (event.x ?? 0.5) * width,
          clientY: (event.y ?? 0.5) * height,
        }),
      )
    else pointer(event.type, [event.x ?? 0.5, event.y ?? 0.5], event.buttons ?? 0)
  }
  return {
    begin(segment: Segment) {
      for (const code of segment.hold ?? []) key('keydown', code)
      if (segment.orbit) pointer('pointerdown', orbitAt(segment, 0), 1)
      if (segment.drag) pointer('pointerdown', segment.drag.from, 1)
    },
    step(segment: Segment, i: number) {
      const t = segment.frames > 1 ? i / (segment.frames - 1) : 1
      if (segment.orbit) pointer('pointermove', orbitAt(segment, i), 1)
      if (segment.drag) {
        const { from, to } = segment.drag
        pointer('pointermove', [lerp(from[0], to[0], t), lerp(from[1], to[1], t)], 1)
      }
      if (segment.wheel && i % (segment.wheel.every ?? 4) === 0)
        replay({ frame: i, type: 'wheel', deltaY: segment.wheel.deltaY })
      if (segment.camera) {
        const { from, to = from } = segment.camera
        pose({
          position: from.position.map((v, k) => lerp(v, to.position[k], t)) as Pose['position'],
          target: from.target.map((v, k) => lerp(v, to.target[k], t)) as Pose['target'],
        })
      }
      for (const event of segment.events ?? []) if (event.frame === i) replay(event)
    },
    end(segment: Segment) {
      for (const code of segment.hold ?? []) key('keyup', code)
      if (segment.orbit) pointer('pointerup', orbitAt(segment, segment.frames - 1), 0)
      if (segment.drag) pointer('pointerup', segment.drag.to, 0)
    },
  }
}
