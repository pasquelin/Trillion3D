import { NO_INDEX } from '../../../../math/src/constants.ts'
import { BODY_INDEX, EVENT_WORDS, POSE_WORDS } from '../../../../sdk-core/src/physics/layout.ts'
import { MAX_CATCH_UP_STEPS, type PhysicsBudget } from '../../../../sdk-core/src/physics/options.ts'
import type { JoltModule } from '../joltModule.ts'
import type { CharacterReport } from '../character/characterDriver.ts'
import {
  beforesAt,
  eventsAt,
  resultWords,
  type FromPhysics,
  type PhysicsResults,
  type TickRecords,
} from '../protocol.ts'
import {
  createFeetTick,
  createSoftTick,
  createVehicleTick,
  noBefore,
  rewriteRecord,
} from '../recordTick.ts'

type Send = (message: FromPhysics, transfer?: Transferable[]) => void

/** A step's refused shapes, diverged bodies, broken joints and exhausted budgets reach the page
 *  as they happen; the world runs. Returns the budgets named exhausted, `overflow` the last
 *  time. */
function reportStep(jolt: JoltModule, send: Send, overflow: string) {
  const joints = jolt.broken()
  if (joints.length) send({ type: 'broken', joints })
  // Bodies the module took out alone: the page hears their ids and retires them.
  const leave = (code: string, bodies: number[], what: string) => {
    if (bodies.length)
      send({
        type: 'error',
        code,
        message: `Physics: ${bodies.length} ${what}.`,
        fatal: false,
        bodies,
      })
  }
  leave('PHYSICS_FAILED', jolt.refused(), 'body shape(s) refused by the module')
  leave('PHYSICS_DIVERGED', jolt.diverged(), 'body(ies) went non-finite and left the simulation')
  const now = jolt.overflow().join(', ')
  if (now && now !== overflow) {
    const message = `Physics budget "${now}" exceeded in a step: contacts were missed.`
    send({ type: 'error', code: 'PHYSICS_BUDGET', message, fatal: false })
  }
  return now
}

/** The last run's `count` poses `words` into `to`: a body's first record of the tick takes the
 *  next slot (`poseCount` on), one met again rewrites its own. Returns the pose count. */
function gatherPoses(
  slots: { slotOf: Int32Array; stamp: Uint32Array; befores: number },
  tick: number,
  poseCount: number,
  to: Uint32Array,
  words: Uint32Array,
  count: number,
  stepped: boolean,
) {
  const { slotOf, stamp, befores } = slots
  for (let r = 0; r < count; r++) {
    const at = r * POSE_WORDS,
      index = words[at] & BODY_INDEX,
      met = stamp[index] === tick
    if (!met) [stamp[index], slotOf[index]] = [tick, poseCount++]
    const o = slotOf[index] * POSE_WORDS
    if (met) rewriteRecord(to, o, to, befores + o, words, at, POSE_WORDS, stepped)
    else {
      to[befores + o] = noBefore(words[at])
      for (let k = 0; k < POSE_WORDS; k++) to[o + k] = words[at + k]
    }
  }
  return poseCount
}

/** The staged results `out` copied into `buffer`, the first one back from the page. */
function restage(
  buffer: ArrayBuffer,
  out: Uint32Array,
  layout: { befores: number; events: number; poseCount: number; eventCount: number },
) {
  const { befores, events, poseCount, eventCount } = layout
  const words = new Uint32Array(buffer)
  words.set(out.subarray(0, poseCount * POSE_WORDS))
  words.set(out.subarray(befores, befores + poseCount * POSE_WORDS), befores)
  words.set(out.subarray(events, events + eventCount * EVENT_WORDS), events)
}

/** The tick's results sent to the page: `buffer`, the records taken from the `ticks` and
 *  the command buffers `spent` moved to it. The records are the tick's own copies, never copied
 *  again. */
function sendResults(
  send: Send,
  buffer: ArrayBuffer,
  counts: Pick<PhysicsResults, 'poses' | 'events' | 'dropped' | 'steps'>,
  rest: {
    after: Pick<PhysicsResults, 'active' | 'step' | 'resting' | 'heard'>
    timing: Pick<PhysicsResults, 'stepMs' | 'stepMaxMs'>
    ticks: Record<'vehicles' | 'soft' | 'feet', { take(): TickRecords | null }>
    character: () => CharacterReport | null
    spent: ArrayBuffer[]
  },
) {
  const { after, timing, ticks } = rest
  const records = {
    vehicles: ticks.vehicles.take(),
    soft: ticks.soft.take(),
    feet: ticks.feet.take(),
  }
  const message = {
    ...{ ...counts, ...after, ...records, ...timing },
    ...{ character: rest.character(), spent: rest.spent.splice(0) },
  }
  const transfer: Transferable[] = [buffer, ...message.spent]
  for (const kind of Object.values(records)) {
    if (kind) transfer.push(kind.words.buffer)
    if (kind?.befores) transfer.push(kind.befores.buffer)
  }
  send({ type: 'results', buffer, ...message }, transfer)
}

/** Each body's slot in the tick's poses, the tick that last wrote it, and where the poses of the
 *  step before begin. */
function createPoseSlots(budget: PhysicsBudget) {
  return {
    slotOf: new Int32Array(budget.bodies),
    stamp: new Uint32Array(budget.bodies).fill(NO_INDEX),
    befores: beforesAt(budget),
  }
}

/** The tick's result buffer: the one taken from the free ones, or the staging copy while the page
 *  holds both. */
type ResultOut = {
  out: Uint32Array | null
  buffer: ArrayBuffer | null
  staging: Uint32Array | null
}

/** Where the tick's results are written: taken on the first write of the tick. */
function resultTarget(r: ResultOut, buffers: ArrayBuffer[], budget: PhysicsBudget) {
  if (r.out) return r.out
  r.buffer = buffers.pop() ?? null
  r.out = r.buffer
    ? new Uint32Array(r.buffer)
    : (r.staging ??= new Uint32Array(resultWords(budget)))
  return r.out
}

/** The buffer the results go to the page in: staged while the page held both buffers, they are
 *  copied into the first one back; `null` while it holds both. */
function resultBuffer(
  r: ResultOut,
  buffers: ArrayBuffer[],
  layout: { befores: number; events: number; poseCount: number; eventCount: number },
) {
  if (r.buffer) return r.buffer
  r.buffer = buffers.pop() ?? null
  if (r.buffer) restage(r.buffer, r.out!, layout)
  return r.buffer
}

/**
 * One tick's results in the physics worker: the poses and events of every step it takes, written
 * straight into a free result buffer (`buffers`), or into a staging copy while the page holds
 * both; one pose slot per body (a later step overwrites), then the events. A body met again in a
 * later run of the tick keeps its pose of the step before in the same slot from `beforesAt`
 * (`rewriteRecord`): the page draws between a body's last two steps (`../poses.ts`); met once, that
 * slot's id word names no body (`noBefore`). The wheels, the soft vertices and the character's
 * feet are kept by the same rule (`../recordTick.ts`). Nothing is allocated per pose, and no event is
 * ever cut: the worker steps only while one more step's events fit.
 */
export function createTickResults(
  jolt: JoltModule,
  budget: PhysicsBudget,
  buffers: ArrayBuffer[],
  send: Send,
) {
  const slots = createPoseSlots(budget)
  const { befores } = slots,
    events = eventsAt(budget)
  const ticks = {
    soft: createSoftTick(),
    vehicles: createVehicleTick(),
    feet: createFeetTick(),
  }
  const result: ResultOut = { out: null, buffer: null, staging: null }
  let tick = 0,
    poseCount = 0,
    eventCount = 0,
    dropped = 0,
    overflow = ''
  return {
    /** Keeps the last run's `count` poses and its events, `stepped` when it took a step. */
    gather(count: number, stepped: boolean) {
      const words = jolt.poses(count),
        to = resultTarget(result, buffers, budget)
      poseCount = gatherPoses(slots, tick, poseCount, to, words, count, stepped)
      const fresh = jolt.events()
      to.set(fresh, events + eventCount * EVENT_WORDS)
      eventCount += fresh.length / EVENT_WORDS
      dropped += jolt.dropped()
      ticks.soft.gather(jolt.soft(), stepped)
      ticks.vehicles.gather(jolt.vehicles(), stepped)
      ticks.feet.gather(jolt.character(), stepped)
      overflow = reportStep(jolt, send, overflow)
    },
    /** Whether one more step's events surely fit in the tick's results. */
    room: () => eventCount + budget.contactEvents <= budget.contactEvents * MAX_CATCH_UP_STEPS,
    /** Hands the tick's results to the page, `after` the state the steps left (the bodies
     *  awake, the page's step it stands at, whether it rests), and the command buffers `spent`
     *  since the last results; false while it holds both buffers. */
    post(
      { steps, stepMs, stepMaxMs }: { steps: number; stepMs: number; stepMaxMs: number },
      after: { active: number; step: number; resting: boolean; heard: number },
      character: () => CharacterReport | null,
      spent: ArrayBuffer[],
    ) {
      if (!result.out || !(poseCount || eventCount || steps)) return false
      const buffer = resultBuffer(result, buffers, { befores, events, poseCount, eventCount })
      if (!buffer) return false
      const counts = { poses: poseCount, events: eventCount, dropped, steps }
      sendResults(send, buffer, counts, {
        ...{ after, timing: { stepMs, stepMaxMs }, ticks, character, spent },
      })
      result.out = result.buffer = null
      tick++
      poseCount = eventCount = dropped = 0
      return true
    },
  }
}
