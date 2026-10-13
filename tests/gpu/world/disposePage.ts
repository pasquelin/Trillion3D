// The page of the dispose proof: worlds opened, drawn and disposed in a row on ONE device, as a
// site swaps its examples in one page — generated scenes (a blended glass, a mirror floor, bounced
// light, temporal accumulation, effects, particles, guides) and bench scenes (skin, morph, textures,
// blends), one loop over both. The device's creates and destroys are counted from outside the
// engine (`liveResources.ts`), the engine's own ledger is read beside them.
import { EffectChain } from '../../../packages/sdk-core/src/world/effect/chain.ts'
import { Bloom } from '../../../packages/sdk-core/src/world/effect/bloom.ts'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import { createGuideSet } from '../../../packages/sdk-browser/src/guides/guideSet.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import type { EngineContext } from '../../../packages/sdk-browser/src/engine/types.ts'
import { backdropScene, type Backdrop } from '../kit/backdropScene.ts'
import { sunlitEngine } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { openBenchWorld } from '../vsm/shadowScene.ts'
import { settle } from './proofWorld.ts'
import { countLive } from '../kit/liveResources.ts'

/** A world opened and drawn: what the engine's ledger counts, and its dispose. */
type Open = { bytes(): number; dispose(): Promise<void> | void }

/** A generated world: what stands before the backdrop, and what the engine is asked to draw, made
 *  anew for each world. */
function generated(layout: Backdrop, options: () => Partial<EngineContext> = () => ({})) {
  return async (device: GPUDevice, events: unknown[]): Promise<Open> => {
    const { backend, release } = await sunlitEngine(backdropScene(layout), device, events, {
      images: 6,
      ...options(),
    })
    // The ledger outlives the dispose on the runtime: what it still counts is held.
    return { bytes: () => backend.metrics().gpuAllocatedBytes ?? 0, dispose: release }
  }
}

/** A bench scene, its own lights and the bench sun, antialiased over time when `temporal`. */
function bench(scene: string, temporal: boolean) {
  return async (device: GPUDevice): Promise<Open> => {
    const world = await openBenchWorld(scene, [320, 200], {
      gpuDevice: device,
      importedLights: true,
      temporalAntialiasing: temporal,
    })
    world.addLight(SUN)
    await world.awaitPages()
    await settle(world)
    return {
      bytes: () => world.engine.metrics().gpuAllocatedBytes ?? 0,
      async dispose() {
        await world.dispose()
        document.getElementById(scene)?.remove()
      },
    }
  }
}

function effects() {
  const chain = new EffectChain()
  chain.add(new Bloom())
  return chain
}

function particles() {
  const pool = new ParticlePool({ capacity: 256, color: [1, 0.5, 0.25, 1], size: 0.2 })
  for (let i = 0; i < 16; i++) pool.emit(i * 0.1 - 0.8, 0, 0.5, 0, 0.1, 0, 2)
  pool.advance(1 / 60)
  return [pool]
}

function guides() {
  const set = createGuideSet()
  set.lines({ positions: [-1, -1, 0.5, 1, 1, 0.5], width: 2 })
  set.points({ positions: [0, 0, 0.5], size: 6 })
  return set
}

/** Every world of the loop, by kind: generated, then bench scenes (skinned, morphed, textured,
 *  blended, metal). */
const OPENERS: [string, (device: GPUDevice, events: unknown[]) => Promise<Open>][] = [
  ['opaque', generated({})],
  ['glass', generated({ glass: {} })],
  ['mirror', generated({ mirror: true })],
  ['bounce', generated({ mirror: true }, () => ({ bounce: true }))],
  ['temporal', generated({}, () => ({ temporalAntialiasing: true }))],
  ['bloom', generated({}, () => ({ effects: effects() }))],
  ['particles', generated({}, () => ({ particles: particles() }))],
  ['guides', generated({}, () => ({ guides: guides() }))],
  ['animated-morph-cube', bench('animated-morph-cube', true)],
  ['cesium-man', bench('cesium-man', false)],
  ['damaged-helmet', bench('damaged-helmet', true)],
  ['alpha-blend-mode-test', bench('alpha-blend-mode-test', false)],
  ['metal-rough-spheres', bench('metal-rough-spheres', true)],
]
const KINDS = OPENERS.map(([kind]) => kind)

/** What a dispose leaves of a world: the resources the device still holds by label, and the
 *  bytes the engine's ledger still counts. */
export type Round = { kind: string; labels: Record<string, number>; bytes: number }
export type Disposals = { kinds: readonly string[]; rounds: Round[] }

export const run = (worlds = 2 * OPENERS.length) =>
  runOnDevice<Disposals>(async (device, events, result) => {
    const counter = countLive(device)
    const rounds: Round[] = (result.rounds = [])
    result.kinds = KINDS
    for (let i = 0; i < worlds; i++) {
      const [kind, open] = OPENERS[i % OPENERS.length]
      const world = await open(device, events)
      await world.dispose()
      await counter.settled()
      rounds.push({ kind, labels: counter.labels(), bytes: world.bytes() })
    }
  })
