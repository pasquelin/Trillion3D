// The page of the dispose proof: worlds opened, drawn and disposed in a row on ONE device, as a
// site swaps its examples in one page — generated scenes (a blended glass, a mirror floor, bounced
// light, temporal accumulation, effects, particles, guides) and bench scenes (skin, morph, textures,
// blends), one loop over both. The device's creates and destroys are counted from outside the
// engine (`liveResources.ts`), the engine's own ledger is read beside them.
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { EffectChain } from '../../../packages/sdk-core/src/world/effect/chain.ts'
import { Bloom } from '../../../packages/sdk-core/src/world/effect/bloom.ts'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import { createGuideSet } from '../../../packages/sdk-browser/src/guides/guideSet.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import type { EngineContext } from '../../../packages/sdk-browser/src/engine/types.ts'
import { cameraFace, engine, releaseScene } from '../kit/sharedSceneProof.ts'
import { backdropScene } from '../kit/backdropScene.ts'
import { image } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { openBenchWorld } from '../vsm/shadowScene.ts'
import { settle } from './proofWorld.ts'
import { countLive } from '../kit/liveResources.ts'

/** The generated worlds: what stands in the view and what the engine is asked to draw. */
const GENERATED = [
  'opaque',
  'glass',
  'mirror',
  'bounce',
  'temporal',
  'bloom',
  'particles',
  'guides',
] as const
/** The bench scenes: skinned, morphed, textured, blended, metal. */
const BENCH = [
  'animated-morph-cube',
  'cesium-man',
  'damaged-helmet',
  'alpha-blend-mode-test',
  'metal-rough-spheres',
] as const
const KINDS = [...GENERATED, ...BENCH] as const
type Kind = (typeof GENERATED)[number]

const scene = (kind: Kind) =>
  backdropScene(
    kind === 'glass' ? 'glass' : kind === 'mirror' || kind === 'bounce' ? 'mirror' : 'none',
  )

function options(kind: Kind): Partial<EngineContext> {
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const base: Partial<EngineContext> = { sceneLights, temporalAntialiasing: false }
  if (kind === 'bounce') return { ...base, bounce: true }
  if (kind === 'temporal') return { ...base, temporalAntialiasing: true }
  if (kind === 'bloom') {
    const effects = new EffectChain()
    effects.add(new Bloom())
    return { ...base, effects }
  }
  if (kind === 'particles') {
    const pool = new ParticlePool({ capacity: 256, color: [1, 0.5, 0.25, 1], size: 0.2 })
    for (let i = 0; i < 16; i++) pool.emit(i * 0.1 - 0.8, 0, 0.5, 0, 0.1, 0, 2)
    pool.advance(1 / 60)
    return { ...base, particles: [pool] }
  }
  if (kind === 'guides') {
    const guides = createGuideSet()
    guides.lines({ positions: [-1, -1, 0.5, 1, 1, 0.5], width: 2 })
    guides.points({ positions: [0, 0, 0.5], size: 6 })
    return { ...base, guides }
  }
  return base
}

/** What a dispose leaves of a world: the resources the device still holds by label, the bytes the
 *  engine's ledger still counts, and what the world held at its peak. */
export type Round = {
  kind: string
  labels: Record<string, number>
  live: number
  peak: number
  bytes: number
}
export type Disposals = { kinds: readonly string[]; rounds: Round[] }

/** A world opened, drawn, and the means to read and dispose it. */
type Open = {
  peak(): number
  bytes(): number
  dispose(): Promise<void> | void
}

export const run = (worlds = 2 * KINDS.length) =>
  runOnDevice<Disposals>(async (device, events, result) => {
    const counter = countLive(device)
    const camera = cameraFace()
    const rounds: Round[] = (result.rounds = [])
    result.kinds = KINDS
    const generated = async (kind: Kind): Promise<Open> => {
      const prepared = scene(kind)
      const { backend, canvas } = engine(prepared, device, (e) => events.push(e), options(kind))
      await backend.prepare()
      for (let frame = 0; frame < 6; frame++) await image(backend, camera)
      return {
        // The ledger outlives the dispose on the runtime: what it still counts is held.
        peak: () => backend.metrics().gpuAllocatedBytes ?? 0,
        bytes: () => backend.metrics().gpuAllocatedBytes ?? 0,
        async dispose() {
          await backend.dispose()
          canvas.remove()
          releaseScene(prepared)
        },
      }
    }
    const bench = async (scene: (typeof BENCH)[number]): Promise<Open> => {
      const world = await openBenchWorld(scene, [320, 200], {
        gpuDevice: device,
        importedLights: true,
        temporalAntialiasing: BENCH.indexOf(scene) % 2 === 0,
      })
      world.addLight(SUN)
      await world.awaitPages()
      await settle(world)
      return {
        peak: () => world.engine.metrics().gpuAllocatedBytes ?? 0,
        bytes: () => world.engine.metrics().gpuAllocatedBytes ?? 0,
        dispose() {
          world.dispose()
          document.getElementById(scene)?.remove()
        },
      }
    }
    for (let i = 0; i < worlds; i++) {
      const kind = KINDS[i % KINDS.length]
      const open = await (GENERATED.includes(kind as Kind)
        ? generated(kind as Kind)
        : bench(kind as (typeof BENCH)[number]))
      const peak = open.peak()
      await open.dispose()
      await counter.settled()
      await device.queue.onSubmittedWorkDone()
      rounds.push({
        kind,
        labels: counter.labels(),
        live: counter.count(),
        peak,
        bytes: open.bytes(),
      })
    }
  })
