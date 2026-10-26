import type { MeasuredWorld } from '../explorer.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs/jobs.ts'
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts'
import type { World } from './world.ts'
import type { BeforeFrameInfo } from './frames/frames.ts'
import { families } from '../host/families.ts'

/** What the families that read a world's engine reach it by, without the page holding it. */
type Access = { session: () => MeasuredWorld | null; last: () => FrameMetrics | null }
/** What the world holds for every session it opens (`switches.ts`). */
type Held = { particles: ParticlePool[] }
const worlds = new WeakMap<object, Access & Held>()

export const registerWorld = (world: object, access: Access, held: Held) => {
  worlds.set(world, { ...access, particles: held.particles })
}

/** `session`, the one drawing a world now; none — a world that draws nothing yet — is refused by
 *  name. The one guard of every method that reaches a world's session. */
export function drawing(session: MeasuredWorld | null | undefined): MeasuredWorld {
  if (!session) throw new Error('This world draws nothing yet: add an object or load a model first')
  return session
}

/** The session drawing `world` now (`drawing`). */
export const sessionOf = (world: object) => drawing(worlds.get(world)?.session())

/** The hooks of a world a pool is stepped by: its frame hooks and its request for a frame. */
export interface PoolHooks {
  beforeFrame(hook: (frame: BeforeFrameInfo) => void): () => void
  onFrame(hook: () => void): () => void
  invalidate(): void
}

/** Steps `pool` on the GPU at every frame a world draws, its time advanced by the world's frames:
 *  the world's own loop draws on while the pool moves, a world its page leads at each `render()`.
 *  `pools` are the world's held pools. Returns the remover. A pool is attached once. */
export function attachPool(pools: ParticlePool[], world: PoolHooks, pool: ParticlePool) {
  if (pools.includes(pool)) throw new Error('PARTICLES_ATTACH: attached already')
  pools.push(pool)
  families.particles.get() // started now: the next frame, which draws the pool, waits for it
  const stops = [
    world.beforeFrame(({ delta }) => pool.advance(delta)),
    world.onFrame(() => pool.moving && world.invalidate()), // after every hook's emission
  ]
  world.invalidate()
  return () => {
    for (const stop of stops) stop()
    const at = pools.indexOf(pool)
    if (at >= 0) pools.splice(at, 1)
    world.invalidate() // the next image gives the pool's buffers back
  }
}

/** `attachPool` for a made world, the measurement entry's way in: a pool of its own. */
export function attachParticles(world: World, pool: ParticlePool) {
  const pools = worlds.get(world)?.particles
  if (!pools) throw new Error('PARTICLES_ATTACH: no world')
  return attachPool(pools, world, pool)
}

/** The metrics of the last frame `world` drew, null before its first. */
export const lastFrameOf = (world: object) => worlds.get(world)?.last() ?? null

/**
 * `world.awaitPages`: resolves once the pages the current view reads are resident. It takes no
 * picture (`image: false`): a world whose loop redraws every frame — a large world streaming, an
 * animated scene — never holds an image still long enough to read one back, and a wait that asked
 * for it never settled. A capture reads its own image (`capture.buffer`). `onProgress`
 * hears `session` while the session that draws the view settles, then `pages`: those the view
 * reads, resident as each one lands (`session/lifecycle.ts`). A session that closes for another — a lost
 * device, a reopen — ends its wait, never with a rejection: the wait carries on with the next
 * session, until one has its pages resident.
 */
export async function awaitViewPages(
  runtime: { settled(): Promise<void>; ended(session: MeasuredWorld): Promise<void> },
  session: () => MeasuredWorld | null,
  onProgress?: (event: JobProgress) => void,
) {
  // The session that draws the view opens — or opens again — before the pages it reads are known.
  onProgress?.({ phase: 'session', completed: 0, total: 1, message: 'The view opens' })
  for (;;) {
    await runtime.settled()
    const current = session()
    if (!current) return
    const pages = current.awaitPages({ image: false, onProgress })
    pages.catch(() => {}) // a session closed first: what it says then is no one's to hear
    try {
      await Promise.race([pages, runtime.ended(current)])
    } catch (error) {
      if (session() === current) throw error
    }
    if (session() === current) return
  }
}
