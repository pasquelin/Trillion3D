// A box that casts a hard shadow from one point spot onto a floor, on a real world runtime on Dawn, drawn
// three ways in a fresh world each: with the light's shadow on and the one-pass projection (the default),
// with it on and the per-light path (`shadowOnePassProjection: false`), and with it off (the floor lit
// whole, to show where the shadow falls). The traces are one ray of a point source: a pixel's share is
// 0 or 1, which both masks hold exactly (`perLightShadow.gpu.ts` derives the bound for the rest).
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { luminance } from '../../../packages/math/src/color/luminance.fixture.ts'

const SETTLE_FRAMES = 90

/** How a case draws the light's shadow. */
type Case = { castShadow: boolean; shadowOnePassProjection: boolean }

/** One image of the scene in a fresh world: the floor, a box, a point spot above it. */
async function image({ castShadow, shadowOnePassProjection }: Case) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:320px;height:180px;display:block'
  document.body.append(canvas)
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
    exposureMethod: 'manual',
    exposureApplyPhysicalCamera: false,
    shadowOnePassProjection,
    shadowRayCountLocal: 1,
  } as Parameters<typeof createWorld>[1])
  try {
    await world.ready
    world.exposure = 1
    world.scene.background = math.color('#15171d')
    const floor = object.mesh(geometry.box(12, 0.2, 8), material.meshStandard({ color: '#c9bba5' }))
    floor.position.set(0, -0.1, 0)
    const block = object.mesh(
      geometry.box(1.2, 1.2, 1.2),
      material.meshStandard({ color: '#a8784c' }),
    )
    block.position.set(0, 0.6, 0)
    world.scene.add(floor, block)
    world.scene.add(
      light.spot({
        color: '#ffd4a3',
        intensity: 900,
        intensityUnits: 'candelas',
        distance: 30,
        outerConeAngle: 0.7,
        innerConeAngle: 0.3,
        position: [-3, 6, 3],
        castShadow,
      }),
      light.hemisphere({ color: '#8aa4ff', groundColor: '#3b2c22', intensity: 0.5 }),
    )
    world.camera.position.set(1.5, 4.2, 7.5)
    world.camera.lookAt(0, 0.3, 0)
    world.camera.updateMatrixWorld(true)
    for (let i = 0; i < SETTLE_FRAMES; i++) {
      await animationFrame()
      world.render()
    }
    await world.awaitPages()
    return Uint8Array.from(await sessionOf(world).capture())
  } finally {
    world.dispose()
    canvas.remove()
  }
}

export type Reading = {
  errors: string[]
  /** Pixels the shadow darkens by more than 40 levels of luminance, in each path. */
  darkened: { onePass: number; perLight: number }
  /** The one-pass image against the per-light one: differing pixels and the greatest channel difference. */
  against: { differing: number; maxChannelError: number }
  pixels: number
}

const darkenedBy = (shadowed: Uint8Array, open: Uint8Array) => {
  let n = 0
  for (let i = 0; i < open.length; i += 4)
    if (
      luminance(open[i], open[i + 1], open[i + 2]) -
        luminance(shadowed[i], shadowed[i + 1], shadowed[i + 2]) >
      40
    )
      n++
  return n
}

export async function run(): Promise<Reading> {
  const open = await image({ castShadow: false, shadowOnePassProjection: true })
  const onePass = await image({ castShadow: true, shadowOnePassProjection: true })
  const perLight = await image({ castShadow: true, shadowOnePassProjection: false })
  const { differentPixels, maxChannelError } = compareImages(onePass, perLight, { alpha: false })
  return {
    errors: [],
    darkened: { onePass: darkenedBy(onePass, open), perLight: darkenedBy(perLight, open) },
    against: { differing: differentPixels, maxChannelError },
    pixels: open.length / 4,
  }
}
