// What the append-in-place proofs share: a world opened on the proofs' canvas and lights, the image
// it draws, and the comparison of a world a source joins while it runs with a world opened on all of
// its sources at once.
import { createHash } from 'node:crypto'
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { lastFrameOf, sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { gaps } from '../../kit/device/patternImage.ts'
import { settleBy } from './proofWorld.ts'

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

/** The image `world` holds, as the digest of its pixels: an image cut off before the engine held it
 *  depends on when the view's last change fell, so a world that never holds fails. */
export async function frame(world: World) {
  await world.awaitPages()
  world.camera.position.set(0, 6, 9)
  world.camera.lookAt(0, 0, 0)
  world.camera.updateMatrixWorld(true)
  // The session opens on the first frames: its device is read once a frame has been drawn.
  const device = () => (lastFrameOf(world) ? sessionOf(world).gpuDevice : undefined)
  const held = await settleBy(device, () => {
    world.render()
    return lastFrameOf(world)
  })
  if (!held) throw new Error('the world was never held')
  const pixels = await sessionOf(world).capture()
  return createHash('sha256').update(pixels).digest('hex')
}

/** A world on the proofs' canvas and lights, at an exposure of one: the subject is the session a
 *  source joins, not the meter — an automatic exposure settles within 1/256 of a stop of the image's
 *  mean, so two worlds that reach the same mean from two sides keep exposures a hair apart and every
 *  pixel one or two steps apart. */
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
  world.exposure = 1
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

/** How far apart the images two worlds hold lie, channel by channel (`gaps`), and their sizes: what
 *  `appendCases` bounds by `ONE_STEP`. */
export async function apartOf(grown: World, opened: World) {
  const grownPixels = new Uint8Array(await sessionOf(grown).capture()),
    openedPixels = new Uint8Array(await sessionOf(opened).capture())
  return { ...gaps(grownPixels, openedPixels), sizes: [grownPixels.length, openedPixels.length] }
}

/** A world opened on `held`, then `added` joining it while it runs, against a world opened on
 *  both — their models loaded in one burst, one session opened on them all —: the images, how far
 *  apart the two settled images lie channel by channel (`gaps`), and the sessions the first was
 *  opened with, before and after. */
export async function joined(held: Content, added: Content) {
  const grown = open()
  try {
    await grown.world.ready
    await held(grown.world)
    const before = await frame(grown.world)
    const sessions = grown.world.diagnostic.sessions
    await added(grown.world)
    const after = await changed(grown.world, before)
    const reference = open()
    try {
      await reference.world.ready
      await Promise.all([held(reference.world), added(reference.world)])
      const opened = await changed(reference.world, '')
      const apart = await apartOf(grown.world, reference.world)
      return {
        before,
        after,
        opened,
        apart,
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
