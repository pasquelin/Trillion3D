// A displaced surface's shadow, on a real world runtime on Dawn: a sheet 4 m square, 1.2 m over a floor, whose `displacement` output
// (a graph: ridges along the sheet's second texture axis, three of them, `0.5 + 0.5 sin`) pushes it up and down by 0.3 m along its normal. The
// tessellation cuts the sheet into micro-triangles and displaces them in the shadow maps too; the very geometry displaced
// on the CPU into a dense mesh of static triangles (`baked`) is what it must cast the shadow of. Lit by a sun, or by a spot hanging in the
// slab the sheet is displaced through, so that the light's near plane cuts the sheet along a line.
//   - tess:  the graph's sheet, tessellated;
//   - baked: the same heights written into the vertices of a dense plane, no tessellation;
//   - open:  no sheet, the floor alone (the lit reference).
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { lastFrameOf, sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settleBy } from '../world/proofWorld.ts'
import { CAMERA, SHEET, SPOT, heightAt } from './tessShadowScene.ts'

export { SHEET, CAMERA, heightAt }

/** The most frames drawn on, once held, for the tessellation's losses to be read back (a sample is one image in fifteen). */
const LOSS_FRAMES = 120
/** The most frames a world is given to open its session (its meshes are resolved asynchronously). */
const OPENING_FRAMES = 1200
/** The image's size. */
const SIZE = { width: 320, height: 180 }
/** The size of the last image captured: the canvas' own, read from it, which the proof indexes its images by. */
const captured = { width: SIZE.width, height: SIZE.height }
/** `tessFlat` and `bakedFlat` are the diagnostic's: the sheet tessellated with a null displacement, and the flat plane drawn as triangles. */
export type Kind = 'tess' | 'baked' | 'open' | 'tessFlat' | 'bakedFlat'
export type Source = 'sun' | 'spot'

/** The sheet's material: a graph whose `displacement` is the ridges, over the material's magnitude and centre. */
function tessellatedSheet(flat = false) {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(0.8, 0.8, 0.8))
  const v = g.componentMask(g.texCoord(), 'g')
  const ridge = g.sine(g.multiply(v, g.constant(SHEET.ridges)))
  g.output(
    'displacement',
    flat ? g.constant(0.5) : g.add(g.multiply(ridge, g.constant(0.5)), g.constant(0.5)),
  )
  const sheet = material.meshStandard({
    color: '#cccccc',
    roughness: 0.9,
    displacementMagnitude: SHEET.magnitude,
    displacementCenter: 0.5,
  })
  sheet.graph = g
  return sheet
}

/** The sheet's plane: coarse where the tessellation cuts it, dense where the ridges are written into the vertices. */
function plane(baked: boolean) {
  const shape = baked
    ? geometry.plane(SHEET.side, SHEET.side, 8, 384)
    : geometry.plane(SHEET.side, SHEET.side, 2, 2)
  if (baked) {
    const place = shape.getAttribute('position')!,
      uv = shape.getAttribute('uv')!
    for (let i = 0; i < place.count; i++)
      place.array[i * 3 + 2] += (heightAt(uv.array[i * 2 + 1]) - 0.5) * SHEET.magnitude
    place.needsUpdate = true
    shape.computeVertexNormals()
  }
  return shape.rotateX(-Math.PI / 2)
}

async function open(canvas: HTMLCanvasElement) {
  const world = createWorld(canvas, {
    interactive: false,
    pixelRatio: 1,
    temporalAntialiasing: false,
    renderScale: 1,
    exposureMethod: 'manual',
    exposureApplyPhysicalCamera: false,
  } as Parameters<typeof createWorld>[1])
  await world.ready
  world.exposure = 1
  world.scene.background = math.color('#15171d')
  return world
}

/** What the world's last image says of the patches the tessellation lost (`FrameMetrics.tessellationLoss`), by `kind-source`: null before a sample came back. */
const losses: Record<string, unknown> = {}

/** One image of the scene `kind` under `source`, held and read back. */
export async function shot(kind: Kind, source: Source) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = `width:${SIZE.width}px;height:${SIZE.height}px;display:block`
  document.body.append(canvas)
  const world = await open(canvas)
  try {
    const floor = object.mesh(
      geometry.box(14, 0.1, 14),
      material.meshStandard({ color: '#e8e8e8', roughness: 1 }),
    )
    floor.position.set(0, -0.05, 0)
    world.scene.add(floor)
    if (kind !== 'open') {
      const plain = kind === 'baked' || kind === 'bakedFlat'
      const sheet = object.mesh(
        plane(kind === 'baked'),
        plain
          ? material.meshStandard({ color: '#cccccc', roughness: 0.9 })
          : tessellatedSheet(kind === 'tessFlat'),
      )
      sheet.position.set(0, SHEET.height, 0)
      world.scene.add(sheet)
    }
    if (source === 'sun') {
      const sun = light.directional({ intensity: 3, color: '#ffffff', castShadow: true })
      // From the -x side, 45 degrees up: the sheet's shadow lands a metre and a fifth beyond its edge, shifted by the height of each ridge.
      sun.position.set(-8, 8, 0)
      world.scene.add(sun)
    } else {
      // Hanging in the slab the sheet is displaced through, over its middle, looking down: its near plane cuts the ridges that rise to it.
      world.scene.add(
        light.spot({
          color: '#ffffff',
          intensity: 400,
          intensityUnits: 'candelas',
          distance: SPOT.distance,
          outerConeAngle: SPOT.outerConeAngle,
          innerConeAngle: SPOT.innerConeAngle,
          position: [0, SHEET.height, 0],
          target: [0, 0, 0],
          castShadow: true,
        }),
      )
    }
    world.scene.add(light.hemisphere({ color: '#8aa4ff', groundColor: '#3b2c22', intensity: 0.15 }))
    world.camera.fov = CAMERA.fov
    world.camera.position.set(0, CAMERA.height, 0.001)
    world.camera.lookAt(0, 0, 0)
    world.camera.updateMatrixWorld(true)
    // The scene's meshes are resolved off the frame (`createWorldContents`): the session opens when the first is seated, some frames in.
    let opened = false
    for (let i = 0; i < OPENING_FRAMES && !opened; i++) {
      await animationFrame()
      world.render()
      try {
        sessionOf(world)
        opened = true
      } catch {
        /* not drawing yet */
      }
    }
    if (!opened)
      throw new Error(
        `${kind} under the ${source}: the world drew nothing after ${OPENING_FRAMES} frames`,
      )
    await world.awaitPages()
    // Drawn until the world holds three frames in a row (every pass settled, the pipelines compiled), never for a fixed count: two worlds opened apart meet the same image.
    const held = await settleBy(
      sessionOf(world).gpuDevice,
      () => {
        world.render()
        return lastFrameOf(world)
      },
      3,
    )
    if (!held) throw new Error(`${kind} under the ${source}: the world did not hold`)
    // The losses are sampled one image in fifteen and read back later: drawn on, the view invalidated, until a reading is in.
    for (let i = 0; i < LOSS_FRAMES && !lastFrameOf(world)?.tessellationLoss; i++) {
      world.invalidate()
      await animationFrame()
      world.render()
    }
    const lost = lastFrameOf(world)?.tessellationLoss
    losses[`${kind}-${source}`] = lost ? { ...lost } : null
    const image = Uint8Array.from(await sessionOf(world).capture())
    captured.width = canvas.width
    captured.height = canvas.height
    if (image.length !== 4 * canvas.width * canvas.height)
      throw new Error(
        `the capture holds ${image.length / 4} pixels for a canvas of ${canvas.width} x ${canvas.height}`,
      )
    return image
  } finally {
    world.dispose()
    canvas.remove()
  }
}

export type Reading = {
  errors: string[]
  /** The images, by source: the tessellated sheet, its baked twin, the floor alone, and the tessellated sheet again, and once more (A/A, and whether the first world of the process differs). */
  images: Record<
    Source,
    Record<'tess' | 'baked' | 'open' | 'again' | 'again2', Uint8Array> &
      Partial<Record<'tessFlat' | 'bakedFlat', Uint8Array>>
  >
  /** The patches the tessellation lost, by `kind-source` (`losses`). */
  losses: Record<string, unknown>
  /** The metres a pixel of the floor spans in the image's width. */
  metresPerPixel: number
  /** The images' width and height in pixels: the canvas' own. */
  size: { width: number; height: number }
}

/** With `flats`, the sheet with no displacement is drawn too, tessellated and as triangles (the dump of `TESS_DUMP`). */
export async function run(options?: { flats?: boolean }): Promise<Reading> {
  const images = {} as Reading['images']
  for (const source of ['sun', 'spot'] as const) {
    images[source] = {
      tess: await shot('tess', source),
      baked: await shot('baked', source),
      open: await shot('open', source),
      again: await shot('tess', source),
      again2: await shot('tess', source),
      ...(options?.flats && {
        tessFlat: await shot('tessFlat', source),
        bakedFlat: await shot('bakedFlat', source),
      }),
    }
  }
  const across = 2 * CAMERA.height * Math.tan((CAMERA.fov * Math.PI) / 360)
  return {
    errors: [],
    images,
    losses: { ...losses },
    metresPerPixel: across / captured.height,
    size: { ...captured },
  }
}

/** The diagnostic's images under the sun (`.mesure/chef/tess-trace.ts`): the floor alone, the sheet flat (tessellated, then as triangles) and displaced (tessellated, then baked). */
export async function trace() {
  // In the proof's own order (`run`): tessellated, baked, the floor alone; the flat pair after.
  const kinds = ['tess', 'baked', 'open', 'tessFlat', 'bakedFlat'] as const
  const images = {} as Record<(typeof kinds)[number], Uint8Array>
  for (const kind of kinds) images[kind] = await shot(kind, 'sun')
  const across = 2 * CAMERA.height * Math.tan((CAMERA.fov * Math.PI) / 360)
  return { images, metresPerPixel: across / captured.height, size: { ...captured } }
}
