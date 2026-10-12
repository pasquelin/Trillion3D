// Page of the append-in-place proof: a world draws a batch, then a second source wearing another
// material is added to the scene — the same geometry, so the same primitive the session holds —,
// and the image is the one of a world opened on both at once. The session is never opened again.
import { createHash } from 'node:crypto'
import { createWorld } from '../../../packages/sdk-browser/src/world/core/world.ts'
import {
  lastFrameOf,
  sessionOf,
} from '../../../packages/sdk-browser/src/world/core/worldSession.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/index.ts'
import { animationFrame } from '../kit/onDawn.ts'

type World = ReturnType<typeof createWorld>

const ball = geometry.sphere(0.6, 16, 12)
const paints = [0xb04a3a, 0x3a7ab0].map((color) => material.meshStandard({ color, roughness: 0.7 }))

/** `count` meshes of the shared sphere, worn with `paint`, along z at `row`. */
function row(world: World, paint: (typeof paints)[number], row: number, count: number) {
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(ball, paint)
    mesh.position.set((i - (count - 1) / 2) * 1.6, 0.6, row)
    world.scene.add(mesh)
  }
}

async function frame(world: World) {
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
  return createHash('sha256').update(pixels).digest('hex')
}

function open() {
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

export async function run() {
  const grown = open()
  try {
    await grown.world.ready
    row(grown.world, paints[0], 0, 5)
    const before = await frame(grown.world)
    const sessions = grown.world.diagnostic.sessions
    row(grown.world, paints[1], -2, 5)
    // The roots join the cut between two images: frames are drawn until the new batch appears.
    let after = await frame(grown.world)
    for (let wait = 0; wait < 100 && after === before; wait++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      after = await frame(grown.world)
    }
    const reference = open()
    try {
      await reference.world.ready
      row(reference.world, paints[0], 0, 5)
      row(reference.world, paints[1], -2, 5)
      const opened = await frame(reference.world)
      return {
        before,
        after,
        opened,
        sessions: [sessions, grown.world.diagnostic.sessions],
      }
    } finally {
      reference.close()
    }
  } finally {
    grown.close()
  }
}
