// The page of the dispose proof: twenty worlds opened and disposed in a row on ONE device, as a
// site swaps its examples in one page. The device's creates and destroys are counted from the
// outside (the harness wraps `createBuffer`, `createTexture` and their `destroy`, before the
// engine's own ledger wraps them), and the engine's allocation ledger is read beside them: both
// must come back to what the first dispose left (the caches every session shares), however the
// world drew: a blended glass, a mirror floor under a sun, bounced light, temporal accumulation.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { EffectChain } from '../../../packages/sdk-core/src/world/effect/chain.ts'
import { Bloom } from '../../../packages/sdk-core/src/world/effect/bloom.ts'
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts'
import { createGuideSet } from '../../../packages/sdk-browser/src/guides/guideSet.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import type { EngineContext } from '../../../packages/sdk-browser/src/engine/types.ts'
import { batisseur, cameraFace, engine, releaseScene } from '../kit/sharedSceneProof.ts'
import { image } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { countLive } from '../kit/liveResources.ts'

/** The worlds, cycled: what stands in the view and what the engine is asked to draw. */
const KINDS = [
  'opaque',
  'glass',
  'mirror',
  'bounce',
  'temporal',
  'scaled',
  'bloom',
  'particles',
  'guides',
] as const
type Kind = (typeof KINDS)[number]

function scene(kind: Kind) {
  const builder = batisseur()
  const add = (surface: G.GraphSurface, pass: string, z: number, half: number) => {
    const mesh = G.mesh(G.planeGeometry(2 * half, 2 * half), surface)
    mesh.position.set(0, 0, z)
    builder.source.add(mesh)
    builder.add(mesh, pass, half)
  }
  add(G.basicSurface({ color: 0x2244aa, side: G.DOUBLE_SIDE }), 'exact-clusters', -1, 4)
  if (kind === 'glass')
    add(
      G.physicalSurface({
        color: 0xffffff,
        metalness: 0,
        roughness: 0,
        transmission: 1,
        ior: 1.5,
        thickness: 0.5,
        transparent: true,
        side: G.DOUBLE_SIDE,
      }),
      'clustered-blend',
      0,
      0.8,
    )
  if (kind === 'mirror' || kind === 'bounce')
    add(
      G.standardSurface({ color: 0xffffff, metalness: 1, roughness: 0.04, side: G.DOUBLE_SIDE }),
      'exact-clusters',
      0,
      0.8,
    )
  return builder.fini()
}

function options(kind: Kind): Partial<EngineContext> {
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const base: Partial<EngineContext> = { sceneLights, temporalAntialiasing: false }
  if (kind === 'bounce') return { ...base, bounce: true }
  if (kind === 'temporal') return { ...base, temporalAntialiasing: true }
  if (kind === 'scaled') return { ...base, temporalAntialiasing: true, renderScale: 0.5 }
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

export type Round = {
  kind: Kind
  /** Live buffers and textures after the dispose, by label. */
  labels: Record<string, number>
  live: number
  /** The bytes the world held at its peak, and those the ledger still counts after its dispose. */
  peak: number
  bytes: number
}
export type Disposals = { kinds: readonly string[]; rounds: Round[] }

export const run = (worlds = 20) =>
  runOnDevice<Disposals>(async (device, events, result) => {
    const counter = countLive(device)
    const camera = cameraFace()
    const rounds: Round[] = (result.rounds = [])
    result.kinds = KINDS
    for (let i = 0; i < worlds; i++) {
      const kind = KINDS[i % KINDS.length]
      const prepared = scene(kind)
      const { backend, canvas } = engine(prepared, device, (e) => events.push(e), options(kind))
      await backend.prepare()
      for (let frame = 0; frame < 6; frame++) await image(backend, camera)
      const peak = backend.metrics().gpuAllocatedBytes ?? 0
      await backend.dispose()
      canvas.remove()
      releaseScene(prepared)
      await device.queue.onSubmittedWorkDone()
      // The session's ledger outlives its dispose on the runtime: what it still counts is held.
      const bytes = backend.metrics().gpuAllocatedBytes ?? 0
      rounds.push({ kind, labels: counter.labels(), live: counter.count(), peak, bytes })
    }
  })
