// The engine side of the anisotropy and clear-coat proofs (`anisotropy.gpu.ts`, `clearcoat.gpu.ts`,
// `clearcoat-maps.gpu.ts`, and the transparent and second-UV-set pages `../blend/lobesBlendPage.ts`,
// `secondUvPage.ts`): one physical plane face-on to the camera, a point light between them — its
// mirror highlight at the plane's centre —, rendered by the real WebGPU engine until held. Its
// geometry, its maps and its material go through the engine's page rows, atlases, resolve or blend
// pass, and lighting; no shader is substituted.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { HALF_PI, createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { runOnDevice as withDevice } from '../kit/deviceProof.ts'
import { colorAt, untilHeld } from '../kit/sceneImageProof.ts'
import { VIEWPORT, batisseur, cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { compilePages } from './compiledPages.ts'
import { mean } from '../../../packages/math/src/scalar/quantile.ts'

const camera = cameraFace()

/** A one-texel data map of `rgba` (0–255), linear, as a glTF stores its data maps. */
export const texel = (...rgba: number[]) => G.dataTexture(new Uint8Array(rgba), 1, 1)

/** How a proof's plane is drawn: `blend`, a transparent surface the blend pass lights; its
 *  `geometry`; `compiled`, read from quantized geometry pages (`compiledPages.ts`); its
 *  `sceneLights`, one lamp before its centre by default; `trace`, the engine's traces on. */
export type PlaneOptions = {
  blend?: boolean
  trace?: boolean
  geometry?: G.Geometry
  compiled?: boolean
  sceneLights?: ReturnType<typeof createSceneLightStore>
}

/** The lamp between the plane and the eye: its mirror highlight at the plane's centre. */
function centreLamp() {
  const sceneLights = createSceneLightStore()
  sceneLights.add({
    id: 'lamp',
    kind: 'point',
    position: [0, 0, 1.2],
    color: [1, 1, 1],
    intensity: 4,
    range: 20,
    castsShadow: false,
  })
  return sceneLights
}

/** The plane drawn with `surface` until held, its pixels bottom row first. */
export async function plane(
  device: GPUDevice,
  events: unknown[],
  surface: G.SurfaceParameters,
  {
    blend = false,
    trace = false,
    geometry = G.planeGeometry(2.4, 2.4),
    compiled = false,
    sceneLights = centreLamp(),
  }: PlaneOptions = {},
) {
  const builder = batisseur()
  const shown = blend ? { ...surface, transparent: true, opacity: 0.6 } : surface
  const mesh = G.mesh(geometry, G.physicalSurface(shown))
  builder.source.add(mesh)
  builder.add(mesh, blend ? 'clustered-blend' : 'exact-clusters', 1.2)
  const scene = builder.fini()
  const readGeometryPage = compiled ? compilePages(scene) : undefined
  const { backend, canvas } = engine(scene, device, (event) => void events.push(event), {
    sceneLights,
    ...(readGeometryPage && { readGeometryPage }),
    ...(trace && { diagnosticDetail: 'trace' as const }),
  })
  try {
    await backend.prepare()
    let last: object = {}
    const { held, count } = await untilHeld(backend, camera, (f) => void (last = f.metrics))
    if (!held) throw new Error(`the plane never held: ${count} images, ${stillness(last, events)}`)
    return held
  } finally {
    release(backend, canvas, scene)
  }
}

/** A view that never held: its size, draws, pending tiles, why its last frames were drawn. */
const stillness = (metrics: object, events: unknown[], m = metrics as Record<string, unknown>) =>
  JSON.stringify({
    size: [m.renderWidth, m.renderHeight],
    draws: m.transparentDrawCalls,
    tiles: m.textureTilesPending,
    drawn: events.filter((e) => (e as { phase: string }).phase === 'frame-drawn').slice(-2),
  })

/** A pixel's brightness where world point `(x, y, 0)` lands. */
export const level = (pixels: number[], x: number, y: number) =>
  mean(colorAt(new Uint8Array(pixels), camera, x, y))

/** Where an image is brightest: the centroid of the pixels within 2 % of its brightest one — a
 *  saturated highlight is a plateau, whose first pixel says nothing of where it lies. */
function brightest(pixels: number[]) {
  const sums: number[] = []
  for (let i = 0; i < pixels.length; i += 4) sums.push(pixels[i] + pixels[i + 1] + pixels[i + 2])
  const top = Math.max(...sums)
  let x = 0,
    y = 0,
    n = 0
  sums.forEach((value, k) => {
    if (value < top * 0.98) return
    x += k % VIEWPORT[0]
    y += Math.floor(k / VIEWPORT[0])
    n++
  })
  return [Math.round(x / n), Math.round(y / n)]
}

/** What a proof reads of an image: the highlight's centre, a point along x and one along y at
 *  `reach`, a far corner, the brightest pixel; and the image itself, to compare two exactly. */
export const reading = (pixels: number[], reach: number) => ({
  centre: level(pixels, 0, 0),
  alongX: level(pixels, reach, 0),
  alongY: level(pixels, 0, reach),
  corner: level(pixels, 0.9, 0.9),
  brightest: brightest(pixels),
  pixels,
})
export type LobeReading = ReturnType<typeof reading>

/** A brushed metal: white, rough enough for a highlight wider than a pixel. */
export const METAL = { color: 0xffffff, metalness: 1, roughness: 0.35 }
/** A rough grey dielectric: no highlight of its own. */
export const MATTE = { color: 0x808080, metalness: 0, roughness: 1 }

/** How a runner reads its cases: the plane's options, `shown` turning each case's surface into the
 *  one drawn, and `after`, run once each is read (a runner's own check of how it was drawn). */
type ReadOptions = PlaneOptions & {
  shown?: (surface: G.SurfaceParameters) => G.SurfaceParameters
  after?: (name: string) => void
}

/** Each case's plane read into `result.readings` as it goes, so what ran before a failure is
 *  still reported. */
export async function readCases(
  device: GPUDevice,
  events: unknown[],
  result: { readings?: Record<string, LobeReading> },
  cases: Record<string, G.SurfaceParameters>,
  { shown = (surface) => surface, after, ...options }: ReadOptions = {},
) {
  const readings: Record<string, LobeReading> = (result.readings = {})
  for (const [name, surface] of Object.entries(cases)) {
    readings[name] = reading(await plane(device, events, shown(surface), options), 0.45)
    after?.(name)
  }
}

/** The clear coat over a matte base: none, a sharp coat, and a coat its map zeroes. */
export const CLEARCOAT_CASES: Record<string, G.SurfaceParameters> = {
  none: MATTE,
  coat: { ...MATTE, clearcoat: 1, clearcoatRoughness: 0.08 },
  coatMapZero: {
    ...MATTE,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    clearcoatMap: texel(0, 0, 0, 255),
  },
}

/** The anisotropic lobe of a metal: none, along the tangent, turned a quarter, and a strength map
 *  at zero. */
export const ANISOTROPY_CASES: Record<string, G.SurfaceParameters> = {
  none: METAL,
  along: { ...METAL, anisotropy: 0.8 },
  turned: { ...METAL, anisotropy: 0.8, anisotropyRotation: HALF_PI },
  strengthMapZero: { ...METAL, anisotropy: 0.8, anisotropyMap: texel(255, 128, 0, 255) },
}

/** Each case's opaque plane, read. */
const opaque = (cases: Record<string, G.SurfaceParameters>) =>
  withDevice<{ readings: Record<string, LobeReading> }>((device, events, result) =>
    readCases(device, events, result, cases),
  )

/** The anisotropic lobe's cases, and a direction map that turns it a quarter. */
export const anisotropy = () =>
  opaque({
    ...ANISOTROPY_CASES,
    directionMap: { ...METAL, anisotropy: 0.8, anisotropyMap: texel(128, 255, 255, 255) },
  })

/** The clear coat's cases over the opaque matte base. */
export const clearcoat = () => opaque(CLEARCOAT_CASES)

/** The coat's roughness map, sharp and rough, and its normal map, flat and tilted along x. */
export const coatMaps = () => {
  const coat = { ...MATTE, clearcoat: 1, clearcoatRoughness: 1 }
  const sharp = { ...coat, clearcoatRoughnessMap: texel(0, 20, 0, 255) }
  return opaque({
    sharp,
    rough: { ...coat, clearcoatRoughnessMap: texel(0, 255, 0, 255) },
    flat: { ...sharp, clearcoatNormalMap: texel(128, 128, 255, 255) },
    tilted: { ...sharp, clearcoatNormalMap: texel(172, 128, 247, 255) },
  })
}
