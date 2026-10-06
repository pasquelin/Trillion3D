import type { CommandWriter } from '../../../../sdk-core/src/physics/index.ts'
import type { ToPhysics } from '../protocol.ts'
import type { startPhysicsWorker } from '../sessionWorker.ts'
import { along, type createStepClock } from '../stepClock.ts'

/**
 * What the session's page side tracks of its worker, fields of one object (`session.ts`).
 *
 * `dirty`: the scene's bodies are reconciled before the next frame; `ready`: the worker said so.
 * `live`: whether the worker asks for steps, as the page last heard; `wakes`: the messages that may
 * wake the world sent so far (`PhysicsResults.heard`: only a rest after all of them says the world
 * rests); `sent`: whether one went since the last advance (an advance of no step runs it).
 * `reached`: the page's step the newest states the worker delivered stand at; `owed`: the steps
 * the frame's time owes, not sent yet. `redraw`: whether what the drawing reads changed since the
 * last frame drew (a tick, the world woken or at rest); `drawnStep` and `drawnOwed`: the time it
 * drew and what it answered, a frame at that time with nothing new draws nothing again (a paused
 * clock); `moving`: what it answered. `received`: page ms spent on ticks since the last frame, its
 * `physics` stage's; `namedAt`: page ms the last soft bodies brought back were named at; `asked`:
 * the scene queries sent; `waterAt`: the page's step the water's waves start at (`setWater`).
 */
export function createSessionState() {
  return {
    dirty: true,
    ready: false,
    live: false,
    wakes: 0,
    sent: false,
    reached: 0,
    owed: 0,
    redraw: false,
    drawnStep: Number.NaN,
    drawnOwed: Number.NaN,
    moving: false,
    received: 0,
    namedAt: -Infinity,
    asked: 0,
    waterAt: 0,
  }
}

export type SessionState = ReturnType<typeof createSessionState>

/** The page's end of the worker's channel: what is sent, and what the frames' clock reads of it. */
export function createWorkerLink(
  s: SessionState,
  worker: ReturnType<typeof startPhysicsWorker>,
  writer: CommandWriter,
  clock: ReturnType<typeof createStepClock>,
  step: number,
) {
  const wake = () => {
    // Woken from rest, the simulation stands where the frames' clock does: nothing moved since.
    if (!s.live) s.reached = clock.steps
    ;[s.live, s.sent, s.redraw] = [true, true, true]
    s.wakes++
  }
  const send = (message: ToPhysics, transfer: Transferable[] = []) => {
    worker.postMessage(message, transfer)
    wake()
  }
  return {
    send,
    /** The worker stands at the page's step `at`, at rest after the first `heard` waking
     *  messages. */
    rested(heard: number, at: number) {
      s.reached = Math.max(s.reached, at)
      if (heard === s.wakes) [s.live, s.redraw] = [false, true]
    },
    /** The fraction of a step the frame's time stands at (`along`), as everything is drawn. */
    at: () => along(clock.drawn, s.reached, step, s.live),
    /** The steps of the frame's time `steps` (none: the clock stands still), its clock now at
     *  `clock.steps`. */
    advance(steps: number) {
      worker.postMessage({ type: 'advance', to: clock.steps, steps })
      s.sent = false
    },
    flush() {
      const words = s.ready && writer.length ? writer.take() : null
      if (words) send({ type: 'commands', words }, [words.buffer])
    },
  }
}

export type WorkerLink = ReturnType<typeof createWorkerLink>
