// The fog volume's light on one cell, the scatter program run as shipped (`shaderRun`) over a volume of
// 20 × 12 × 8 cells and a view of 160 × 90 pixels (`fogScatter.test.ts`, `fogLights.test.ts`).
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { FOG_SLOT, FOG_SLOTS } from '../../../sdk-core/src/scene/core/fog.ts'
import { SKY_SLOT, SKY_SLOTS } from '../../../sdk-core/src/scene/core/environmentSky.ts'
import { ATMOSPHERE_SLOTS } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import {
  CAM,
  EYE,
  camera,
  emptyLights,
  frameScope,
  image,
  table,
  type V3,
} from './fogVolumeRun.fixture.ts'

/** Settings with no history, no hidden cell skipped, no jitter and the sample left where the cell
 *  puts it: its centre. */
export const PLAIN = {
  volumetricFogMovesSamples: false,
  volumetricFogSkipHidden: false,
  volumetricFogUsesHistory: false,
  volumetricFogSurfaceLift: -1,
}

/** A light's record: its lanes by name. */
export type Light = Record<string, number[]>
/** The sun: a directional light, `rgb` times `intensity`, going down. */
export const SUN: Light = {
  positionRange: [0, 0, 0, 0],
  colorIntensity: [1, 0.5, 0.25, 4],
  directionCone: [0, -1, 0, -2],
  params: [2, -1, 0, -2],
  shape: [0, 0, 0, 0],
  capsule: [0, 0, 0, 0],
}

/** The scatter on the cell `cell`, over the scene `world` describes: its lights, the fog's first
 *  layer's density, what the textures hold. Returns what the program stored at the cell. */
export function scatter(
  cell: V3,
  world: {
    lights?: Light[]
    density?: number
    falloff?: number
    sunRank?: number
    sky?: number[]
    /** Whether the scene has a sky light, where `sky` gives its irradiance: yes by default. */
    skyLight?: boolean
    /** The fog's own colour, for a medium lit by it (`useFogColors`). */
    fogColor?: number[]
    /** What every shadow read gives, 1 by default, and the kinds of the lights it was asked for. */
    shade?: number
    shadowReads?: number[]
    volumetric?: Parameters<typeof image>[1]
    settings?: Parameters<typeof image>[2]
    depth?: (c: number[]) => number
    furthest?: number
    previous?: number[]
    sampled?: number[][]
    second?: number
    before?: boolean
    previousFurthest?: number
    /** The size the view is drawn at where it is smaller than the targets the textures were made for. */
    drawn?: [number, number]
    /** The camera, where it is not the perspective one of the other tests. */
    camera?: ReturnType<typeof camera>
    /** The texels of the previous furthest depth the program loads, kept. */
    loads?: number[][]
    /** Where the camera of the image before stood, where it is not where this one does. */
    previousEye?: V3
  } = {},
) {
  const { lights = [], density = 0.1, falloff = 0 } = world
  // A view drawn smaller than the targets: its camera of that size, the textures' cells those of CAM.
  const cam = world.camera ?? (world.drawn ? camera(EYE, ...world.drawn) : CAM)
  const before = world.previousEye ? camera(world.previousEye, ...(world.drawn ?? [160, 90])) : cam
  const previous = world.before
    ? { viewProj: before.viewProj, width: before.width, height: before.height }
    : undefined
  const img = image(
    cam,
    world.volumetric ?? true,
    { ...PLAIN, ...world.settings },
    { sunRank: world.sunRank ?? -1, previous, resource: image(CAM).grid },
  )
  const block = emptyLights({ fog: FOG_SLOTS, sky: SKY_SLOTS, atmosphere: ATMOSPHERE_SLOTS })
  block.fog[FOG_SLOT.law] = [density, falloff, 0, 1]
  block.fog[FOG_SLOT.second] = [world.second ?? 0, 0, 0, 0]
  if (world.fogColor) block.fog[FOG_SLOT.color] = [...world.fogColor, 0]
  if (world.sky) block.sky[SKY_SLOT.irradiance] = [...world.sky, 0]
  if (world.sky && world.skyLight !== false) block.sky[SKY_SLOT.upper] = [0, 0, 0, 1]
  block.count = lights.length
  block.items = lights
  const out = table()
  const run = shaderRun<{ scatterMain: (c: V3) => void }>(FOG_PROGRAMS.scatter, ['scatterMain'], {
    frame: frameScope(img),
    directLights: block,
    tileLights: [],
    fogDepth: table(world.depth ?? (() => 0)),
    fogFurthest: table(() => [world.furthest ?? 0, 0, 0, 0]),
    fogPreviousFurthest: {
      load: (c: number[]) => (world.loads?.push([...c]), [world.previousFurthest ?? 0, 0, 0, 0]),
    },
    fogPreviousVolume: {},
    fogSampler: {},
    fogCubemap: {},
    fogScattering: out,
    shadowFactor: (_slice: number, light: Light) => (
      world.shadowReads?.push(light.params[0]),
      world.shade ?? 1
    ),
    textureSampleLevel: (_t: unknown, _s: unknown, uvw: number[]) => (
      world.sampled?.push(uvw),
      world.previous ?? [0, 0, 0, 0]
    ),
  })
  run.scatterMain(cell)
  return out.cells.get(cell.join(',')) as number[] | undefined
}

export const CELL: V3 = [3, 4, 2]
export const EXTINCTION = 0.05 // half the density of 0.1, per metre
export const G = 0.2
