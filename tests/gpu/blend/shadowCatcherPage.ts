// Page of the shadow-catcher proof: a ground worn with `material.shadow` under a box a shadowed sun
// lights, over a blue background. Generated scene: no file of the site.
import { HALF_PI } from '../../../packages/math/src/constants.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { changed } from '../world/appendProof.ts'

export const BACKGROUND = '#5b8fd0'

/** The image of the scene, RGBA rows from the top, `width` pixels wide. */
export async function run() {
  const errors: string[] = []
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:240px;display:block'
  document.body.append(canvas)
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
  })
  try {
    await world.ready
    world.scene.background = math.color(BACKGROUND)
    const sun = light.directional({ intensity: 3, castShadow: true })
    sun.position.set(-3, 8, -2)
    world.scene.add(sun)
    world.scene.add(
      object.mesh(geometry.plane(20, 20).rotateX(-HALF_PI), material.shadow({ opacity: 0.5 })),
    )
    const box = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ color: 0xc04030 }))
    box.position.set(0, 1.2, 0)
    world.scene.add(box)
    await changed(world, '')
    const pixels = new Uint8Array(await sessionOf(world).capture())
    return { pixels, width: canvas.width, errors }
  } catch (error) {
    return { error: error instanceof Error ? error.stack : String(error), errors }
  } finally {
    world.dispose()
    canvas.remove()
  }
}
