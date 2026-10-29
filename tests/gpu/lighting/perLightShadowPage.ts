// A box that casts a hard shadow from one point spot onto a floor, on a real world runtime on Dawn, drawn
// three ways in a fresh world each: with the light's shadow on and the one-pass projection (the default),
// with it on and the per-light path (`shadowOnePassProjection: false`), and with it off (the floor lit
// whole, to show where the shadow falls). The traces are one ray of a point source: a pixel's share is
// 0 or 1, which both masks hold exactly (`perLightShadow.gpu.ts` derives the bound for the rest).
import { createWorld } from '../../../packages/sdk-browser/src/session/world/world.ts'
import { lastFrameOf, sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { math } from '../../../packages/sdk-core/src/world/math/index.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settleBy } from '../world/proofWorld.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { luminance } from '../../../packages/math/src/color/luminance.fixture.ts'

/** The most frames a world is given to open its session: it opens once the quality is decided and the models are loaded, and a frame drawn before draws nothing. */
const OPENING_FRAMES = 1200

/** The device of the world's session, once the first frames have opened it. */
async function openedDevice(world: ReturnType<typeof createWorld>) {
  for (let i = 0; i < OPENING_FRAMES; i++) {
    world.render()
    await animationFrame()
    try {
      return sessionOf(world).gpuDevice
    } catch {
      /* not drawing yet */
    }
  }
  throw new Error(`the world drew nothing after ${OPENING_FRAMES} frames`)
}

/** How a case draws the light's shadow. */
type Case = {
  castShadow: boolean
  shadowOnePassProjection: boolean
  without?: Record<string, unknown>
}

/** How a world's timeline ran before its capture: the images it drew (a held frame draws none) and the image the GPU timings last described. */
type Timeline = {
  drawn: number
  /** The calls of `render()` (0-based) the engine held instead of drawing: a held call still advances the engine's frame number. */
  held: number[]
  /** The last call that drew: the image captured is that one's, its noise the frame number of that call. */
  lastDrawn: number
  lastTimedImage: number | null
  width: number
}

/** One image of the scene in a fresh world (the floor, a box, a point spot above it) and the timeline that led to it. */
async function image({ castShadow, shadowOnePassProjection, without }: Case, label: string) {
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
    // Four fresh worlds are read before any holds: their images are compared on one phase of the noise.
    freezeTemporalSequences: true,
    ...without,
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
    // The view held, by the proofs' own wait (`settleBy`): a world read at a fixed count of calls can be read before its programs are compiled and its shadow maps drawn.
    let drawn = 0,
      lastDrawn = -1,
      call = 0
    const held: number[] = []
    const holding = await settleBy(await openedDevice(world), () => {
      world.render()
      const metrics = lastFrameOf(world)
      if (metrics?.frameHeld) held.push(call)
      else {
        drawn++
        lastDrawn = call
      }
      call++
      return metrics
    })
    if (!holding)
      throw new Error(
        `the view did not hold within the proofs' settle budget: ${JSON.stringify({ world: label, calls: call, drawn, held: held.length, lastDrawn, castShadow, shadowOnePassProjection, without })}`,
      )
    await world.awaitPages()
    const timeline: Timeline = {
      drawn,
      held,
      lastDrawn,
      lastTimedImage: lastFrameOf(world)?.gpuPassMs?.frame ?? null,
      width: canvas.width,
    }
    return { pixels: Uint8Array.from(await sessionOf(world).capture()), timeline }
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
  /** Where the two images differ: pixels the per-light one draws darker and brighter, and the pixels that differ where neither
   *  image is darkened by the shadow (the light's term itself, not its edge), with the greatest channel difference among them. */
  where: { darker: number; brighter: number; outsideShadow: number; outsideMaxChannelError: number }
  /** Two fresh worlds of the one-pass configuration against each other: what the frames' own noise puts between two images that
   *  differ in no setting, which no path can be asked to beat. */
  sameConfiguration: { differing: number; maxChannelError: number }
  /** The pixels the two paths differ on by more than the noise of the world itself (`NOISE_LEVELS`): their count, their bounding box, how many lie
   *  in the shadow (darkened by it in either image) and how many in the light's lit cone (`open` brighter than the ambient floor), and
   *  `SAMPLES` of them with the three images' colours. */
  beyondNoise: {
    count: number
    box: [number, number, number, number] | null
    inShadow: number
    inCone: number
    samples: { x: number; y: number; onePass: number[]; perLight: number[]; open: number[] }[]
  }
  /** Each world's timeline before its capture: a different count of drawn images is a different phase of every frame-driven noise. */
  timelines: { open: Timeline; onePass: Timeline; perLight: Timeline; again: Timeline }
  /** The per-light configuration drawn a second time, after the first compiled its programs: that second world against the one-pass
   *  image, and against the first per-light world, with its timeline. */
  warmPerLight: {
    againstOnePass: { differing: number; maxChannelError: number }
    againstFirst: { differing: number; maxChannelError: number }
    timeline: Timeline
  }
  /** The one-pass configuration twice with one effect left out at a time (`EFFECTS`): the pixels the two worlds still differ on, or the error that
   *  refused the setting. The effect whose count falls to 0 carries the difference between two identical worlds. */
  withoutEffect: Record<string, number | string>
  pixels: number
}

/** Levels two worlds of one configuration may differ by from the frames' own noise, and the samples a reading keeps. */
const NOISE_LEVELS = 3
const SAMPLES = 8
/** A pixel that `open` (no shadow) draws brighter than this is in the spot's cone, the hemisphere light alone drawing the rest. */
const CONE_LUMINANCE = 40

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

/** The differences of `perLight` from `onePass`, by sign and by whether the shadow darkens the pixel in either (against `open`). */
const whereTheyDiffer = (onePass: Uint8Array, perLight: Uint8Array, open: Uint8Array) => {
  const where = { darker: 0, brighter: 0, outsideShadow: 0, outsideMaxChannelError: 0 }
  const shadowed = (image: Uint8Array, i: number) =>
    luminance(open[i], open[i + 1], open[i + 2]) - luminance(image[i], image[i + 1], image[i + 2]) >
    40
  for (let i = 0; i < onePass.length; i += 4) {
    const dr = perLight[i] - onePass[i],
      dg = perLight[i + 1] - onePass[i + 1],
      db = perLight[i + 2] - onePass[i + 2]
    const most = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db))
    if (!most) continue
    if (dr + dg + db < 0) where.darker++
    else where.brighter++
    if (!shadowed(onePass, i) && !shadowed(perLight, i)) {
      where.outsideShadow++
      where.outsideMaxChannelError = Math.max(where.outsideMaxChannelError, most)
    }
  }
  return where
}

/** The pixels where `perLight` is more than `NOISE_LEVELS` from `onePass`, `width` pixels to a row. */
const beyondNoiseOf = (
  onePass: Uint8Array,
  perLight: Uint8Array,
  open: Uint8Array,
  width: number,
): Reading['beyondNoise'] => {
  const found: Reading['beyondNoise'] = { count: 0, box: null, inShadow: 0, inCone: 0, samples: [] }
  const rgb = (image: Uint8Array, i: number) => [image[i], image[i + 1], image[i + 2]]
  const darkened = (image: Uint8Array, i: number) =>
    luminance(open[i], open[i + 1], open[i + 2]) - luminance(image[i], image[i + 1], image[i + 2]) >
    40
  for (let i = 0; i < onePass.length; i += 4) {
    const most = Math.max(
      Math.abs(perLight[i] - onePass[i]),
      Math.abs(perLight[i + 1] - onePass[i + 1]),
      Math.abs(perLight[i + 2] - onePass[i + 2]),
    )
    if (most <= NOISE_LEVELS) continue
    const [x, y] = [(i / 4) % width, Math.floor(i / 4 / width)]
    found.count++
    const box = (found.box ??= [x, y, x, y])
    box[0] = Math.min(box[0], x)
    box[1] = Math.min(box[1], y)
    box[2] = Math.max(box[2], x)
    box[3] = Math.max(box[3], y)
    if (darkened(onePass, i) || darkened(perLight, i)) found.inShadow++
    if (luminance(open[i], open[i + 1], open[i + 2]) > CONE_LUMINANCE) found.inCone++
    // Every few-th pixel found, so that the samples spread over the pixels rather than sit at the first row.
    if (found.samples.length < SAMPLES && found.count % 50 === 1)
      found.samples.push({
        x,
        y,
        onePass: rgb(onePass, i),
        perLight: rgb(perLight, i),
        open: rgb(open, i),
      })
  }
  return found
}

/** The public settings that leave one effect out, by the name the reading gives it. */
const EFFECTS: Record<string, Record<string, unknown>> = {
  ambientOcclusion: { ambientOcclusionIntensity: 0 },
  screenProbes: { screenProbes: false },
  reflections: { reflectionQuality: 'off' },
  contactShadows: { contactShadowLength: 0 },
}

/** Two worlds of the one-pass configuration with `without` set, against each other, after a first world of the same settings that
 *  compiles what they share: the first world of a configuration waits for its programs and draws a different number of images, the
 *  histories (occlusion, screen probes) then hold a different number of them. */
async function differingWithout(without: Record<string, unknown>) {
  const options = { castShadow: true, shadowOnePassProjection: true, without }
  await image(options, 'withoutEffect')
  const [a, b] = [await image(options, 'withoutEffect'), await image(options, 'withoutEffect')]
  return compareImages(a.pixels, b.pixels, { alpha: false }).differentPixels
}

export async function run(): Promise<Reading> {
  const { pixels: open, timeline: openTimeline } = await image(
    {
      castShadow: false,
      shadowOnePassProjection: true,
    },
    'open',
  )
  const { pixels: onePass, timeline: onePassTimeline } = await image(
    {
      castShadow: true,
      shadowOnePassProjection: true,
    },
    'onePass',
  )
  const { pixels: perLight, timeline: perLightTimeline } = await image(
    {
      castShadow: true,
      shadowOnePassProjection: false,
    },
    'perLight',
  )
  const { differentPixels, maxChannelError } = compareImages(onePass, perLight, { alpha: false })
  const { pixels: warm, timeline: warmTimeline } = await image(
    {
      castShadow: true,
      shadowOnePassProjection: false,
    },
    'warmPerLight',
  )
  const warmAgainstOnePass = compareImages(onePass, warm, { alpha: false })
  const warmAgainstFirst = compareImages(perLight, warm, { alpha: false })
  const { pixels: again, timeline: againTimeline } = await image(
    {
      castShadow: true,
      shadowOnePassProjection: true,
    },
    'again',
  )
  const same = compareImages(onePass, again, { alpha: false })
  const withoutEffect: Reading['withoutEffect'] = {}
  for (const [name, settings] of Object.entries(EFFECTS))
    withoutEffect[name] = await differingWithout(settings).catch((error: unknown) => String(error))
  return {
    errors: [],
    darkened: { onePass: darkenedBy(onePass, open), perLight: darkenedBy(perLight, open) },
    against: { differing: differentPixels, maxChannelError },
    where: whereTheyDiffer(onePass, perLight, open),
    warmPerLight: {
      againstOnePass: {
        differing: warmAgainstOnePass.differentPixels,
        maxChannelError: warmAgainstOnePass.maxChannelError,
      },
      againstFirst: {
        differing: warmAgainstFirst.differentPixels,
        maxChannelError: warmAgainstFirst.maxChannelError,
      },
      timeline: warmTimeline,
    },
    sameConfiguration: { differing: same.differentPixels, maxChannelError: same.maxChannelError },
    beyondNoise: beyondNoiseOf(onePass, perLight, open, onePassTimeline.width),
    timelines: {
      open: openTimeline,
      onePass: onePassTimeline,
      perLight: perLightTimeline,
      again: againTimeline,
    },
    withoutEffect,
    pixels: open.length / 4,
  }
}
