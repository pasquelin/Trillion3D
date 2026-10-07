// What the shadow proofs share: a bench scene opened the way they read it, and how a frame shades
// otherwise than another away from every edge (its canvas read back with `kit/patternImage.ts`).
import type { FakeCanvas } from '../../../bench/dawn/canvas.ts'
import type { MeasuredWorldOptions } from '../../../packages/sdk-browser/src/world/session/options.ts'
import { openEngineWorld, proofCanvas } from '../kit/renderHarness.ts'
import { benchManifest } from '../world/proofWorld.ts'

/**
 * Opens the bench scene `scene` in a canvas of its own whose images can be read back: this tree's
 * engine, one pixel of error, no antialiasing, every page it asks for admitted. `options` adds to
 * or overrides these.
 */
export async function openBenchWorld(
  scene: string,
  [width, height]: [number, number],
  options: Partial<Omit<MeasuredWorldOptions, 'engine'>> = {},
) {
  const canvas = proofCanvas(scene) as unknown as FakeCanvas
  // Before the engine configures it: a texture the bench reads back carries COPY_SRC from the start.
  canvas.readable = true
  return openEngineWorld(canvas as unknown as HTMLCanvasElement, {
    manifestUrl: benchManifest(scene),
    scope: 'full',
    interactive: false,
    width,
    height,
    pixelRatio: 1,
    pixelError: 1,
    maxResidentPages: 100000,
    textureSource: 'cache',
    temporalAntialiasing: false,
    ...options,
  })
}

/** The luminance of pixel `i` of an RGBA image. */
export const luminance = (p: Uint8Array, i: number) =>
  0.2126 * p[4 * i] + 0.7152 * p[4 * i + 1] + 0.0722 * p[4 * i + 2]

/**
 * How `stopped` shades otherwise than `settled`, the same pose at rest, `open` being that pose
 * without the shadow. The step a pixel must move by to count is half the median darkening the
 * shadow brings to the pixels it darkens at all: a shadow that drops out moves a pixel by that
 * median, noise and texture detail by less. An edge pixel has a neighbour within `radius` that
 * differs from it by that step in the settled image; a cut that stands `radius` pixels from its
 * settled place changes edge pixels only.
 */
export function shadingGap(
  stopped: Uint8Array,
  settled: Uint8Array,
  open: Uint8Array,
  width: number,
  radius: number,
) {
  const pixels = settled.length / 4,
    height = pixels / width
  const darkening: number[] = []
  for (let i = 0; i < pixels; i++) {
    const d = luminance(open, i) - luminance(settled, i)
    if (d > 0) darkening.push(d)
  }
  darkening.sort((a, b) => a - b)
  // The factor 1/2 is not derived: it is the midpoint between "unchanged" (0) and "shadowed" (the
  // median darkening), so a pixel counts on the side it is nearer to; it stands for a noise level
  // the frame cannot measure on its own. Sensitivity: every count below is monotone in it — a
  // smaller factor lets texture and 8-bit noise in as "moved", a larger one drops penumbra pixels.
  // With nothing darkened the step is 0 and `shadowedOffEdge` stays 0: the proof fails, as it should.
  const step = (darkening[darkening.length >> 1] ?? 0) / 2
  const edge = (i: number) => {
    const x = i % width,
      y = (i - x) / width,
      own = luminance(settled, i)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx,
          ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (Math.abs(luminance(settled, ny * width + nx) - own) > step) return true
      }
    return false
  }
  let differing = 0,
    offEdge = 0,
    shadowed = 0,
    shadowedOffEdge = 0
  for (let i = 0; i < pixels; i++) {
    const moved = Math.abs(luminance(stopped, i) - luminance(settled, i)) > step
    const shade = luminance(open, i) - luminance(settled, i) > step
    if (!moved && !shade) continue
    const inside = !edge(i)
    if (moved) differing++
    if (moved && inside) offEdge++
    if (shade) shadowed++
    if (shade && inside) shadowedOffEdge++
  }
  return { step, pixels, shadowed, shadowedOffEdge, differing, offEdge }
}
