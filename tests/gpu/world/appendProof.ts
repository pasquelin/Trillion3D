// What the append-in-place proofs share: a world opened on the proofs' canvas and lights, the image
// it draws, and the comparison of a world a source joins while it runs with a world opened on all of
// its sources at once.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
let lastPixels = new Uint8Array(0)
import { createWorld } from '../../../packages/sdk-browser/src/world/core/world.ts'
import {
  lastFrameOf,
  sessionOf,
} from '../../../packages/sdk-browser/src/world/core/worldSession.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/index.ts'
import { animationFrame } from '../kit/onDawn.ts'

export type World = ReturnType<typeof createWorld>

/** `count` meshes of `shape` worn with `paint`, along x at depth `z`. */
export function row(
  world: World,
  shape: Parameters<typeof object.mesh>[0],
  paint: Parameters<typeof object.mesh>[1],
  z: number,
  count = 3,
) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(shape, paint)
    mesh.position.set((i - (count - 1) / 2) * 1.6, 0.6, z)
    world.scene.add(mesh)
  }
}

/** The image `world` holds, as the digest of its pixels. */
export async function frame(world: World) {
  await world.awaitPages()
  world.camera.position.set(0, 6, 9)
  world.camera.lookAt(0, 0, 0)
  world.camera.updateMatrixWorld(true)
  for (let i = 0; i < 160; i++) {
    await animationFrame()
    world.render()
    if (lastFrameOf(world)?.frameHeld) break
  }
  const pixels = await sessionOf(world).capture()
  lastPixels = pixels
  return createHash('sha256').update(pixels).digest('hex')
}

/** A world on the proofs' canvas and lights. */
export function open() {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:240px;display:block'
  document.body.append(canvas)
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
  })
  world.scene.add(
    light.ambient({ intensity: 0.6 }),
    light.directional({ intensity: 2, position: [4, 9, 6] }),
  )
  return { world, close: () => (world.dispose(), canvas.remove()) }
}

/** The image `world` holds once a change made to it has appeared — drawn until it differs from
 *  `before` and stops changing: the roots join the cut between two images, several sources one after
 *  the other. */
export async function changed(world: World, before: string) {
  let after = await frame(world),
    stable = 0
  for (let wait = 0; wait < 150 && (after === before || stable < 6); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const next = await frame(world)
    stable = next === after ? stable + 1 : 0
    after = next
  }
  return after
}

/** What a case adds to a world: meshes at once, models once they are loaded. */
type Content = (world: World) => void | Promise<void>

/** A world opened on `held`, then `added` joining it while it runs, against a world opened on
 *  both — their models loaded in one burst, one session opened on them all —: the images, and the
 *  sessions the first was opened with, before and after. */
export async function joined(held: Content, added: Content) {
  const grown = open()
  try {
    await grown.world.ready
    await held(grown.world)
    const before = await frame(grown.world)
    const sessions = grown.world.diagnostic.sessions
    await added(grown.world)
    const after = await changed(grown.world, before)
    if (process.env.APPEND_DUMP) writeFileSync(`${process.env.APPEND_DUMP}-joined.rgba`, lastPixels)
    const reference = open()
    try {
      await reference.world.ready
      await Promise.all([held(reference.world), added(reference.world)])
      const opened = await changed(reference.world, '')
      if (process.env.APPEND_DUMP)
        writeFileSync(`${process.env.APPEND_DUMP}-fresh.rgba`, lastPixels)
      return {
        before,
        after,
        opened,
        sessions: [sessions, grown.world.diagnostic.sessions],
        clusters: [lastFrameOf(grown.world)?.clusters, lastFrameOf(reference.world)?.clusters],
      }
    } finally {
      reference.close()
    }
  } finally {
    grown.close()
  }
}
