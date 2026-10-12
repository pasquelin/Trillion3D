// The page of the worlds proof: bench scenes that carry what a generated scene cannot — skin, morph,
// textures, blends, mirrors — opened on one device the page keeps (`gpuDevice`), drawn and disposed
// twenty times in a row, as a site swaps its examples. Each dispose is read as the device holds it
// afterwards (`liveResources.ts`).
import { runOnDevice } from '../kit/deviceProof.ts'
import { countLive } from '../kit/liveResources.ts'
import { openBenchWorld } from '../vsm/shadowScene.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { settle } from './proofWorld.ts'

/** The scenes, cycled. */
const SCENES = [
  'animated-morph-cube',
  'cesium-man',
  'damaged-helmet',
  'alpha-blend-mode-test',
  'metal-rough-spheres',
  'duck',
  'lantern',
] as const

/** What a world held at its peak, and the device holds after its dispose. */
export type WorldRound = {
  scene: string
  peak: number
  labels: Record<string, number>
  live: number
}
export type WorldDisposals = { scenes: readonly string[]; rounds: WorldRound[] }

/** Waits until the device's live count stops moving: a dispose finishes after its call returns. */
async function quiet(count: () => number) {
  for (let still = 0, last = -1; still < 3; last = count()) {
    await sleep(100)
    still = count() === last ? still + 1 : 0
  }
}

export const run = (worlds = 20) =>
  runOnDevice<WorldDisposals>(async (device, _events, result) => {
    const counter = countLive(device)
    const rounds: WorldRound[] = (result.rounds = [])
    result.scenes = SCENES
    for (let i = 0; i < worlds; i++) {
      const scene = SCENES[i % SCENES.length]
      const world = await openBenchWorld(scene, [320, 200], {
        gpuDevice: device,
        importedLights: true,
        temporalAntialiasing: SCENES.indexOf(scene) % 2 === 0,
      })
      world.addLight(SUN)
      await world.awaitPages()
      await settle(world)
      const peak = counter.count()
      world.dispose()
      document.getElementById(scene)?.remove()
      await quiet(counter.count)
      await device.queue.onSubmittedWorkDone()
      rounds.push({ scene, peak, labels: counter.labels(), live: counter.count() })
    }
  })
