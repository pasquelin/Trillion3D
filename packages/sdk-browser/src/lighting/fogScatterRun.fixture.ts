// The fog volume's light on one cell, the scatter program run as shipped (`shaderRun`) over a volume of
// 20 × 12 × 8 cells and a view of 160 × 90 pixels (`fogScatter.test.ts`, `fogLights.test.ts`, `fogLightShare.test.ts`, `fogSkyLight.test.ts`).
import { kindLane } from '../../../sdk-core/src/scene/light/lanes.fixture.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { FOG_SLOT, FOG_SLOTS } from '../../../sdk-core/src/scene/core/fog.ts'
import { ATMOSPHERE_SLOTS } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import {
  CAM,
  EYE,
  camera,
  emptyLights,
  frameScope,
  image,
  previousOf,
  table,
  type V3,
} from './fogVolumeRun.fixture.ts'

/** Settings with no history, no hidden cell skipped, no jitter and the sample left where the cell
 *  puts it: its centre. */
const PLAIN = {
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
  // The record's lanes: kind word (a sun: rank 2 and its shadows-the-fog flag), shadow slot, the share the fog scatters, inner cone.
  params: [kindLane(10), -1, 1, -2],
  shape: [0, 0, 0, 0],
  capsule: [0, 0, 0, 0],
  traits: [0, 0, 0, 0],
}

/** A white lamp of intensity 50 at `centre`, reaching `range` metres: no cone, no shape. */
export const lampOf = (centre: readonly number[], range = 40): Light => ({
  positionRange: [...centre, range],
  colorIntensity: [1, 1, 1, 50],
  directionCone: [0, 0, 0, -2],
  params: [0, -1, 1, -2],
  shape: [0, 0, 0, 0],
  capsule: [0, 0, 0, 0],
  traits: [0, 0, 0, 0],
})

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
    /** The share of the sky light the fog scatters (the sky block's first `w`): 1 unless given. */
    skyShare?: number
    /** Whether the scene has a sky light, where `sky` gives its irradiance: yes by default. */
    skyLight?: boolean
    /** The fog's own colour, for a medium lit by it (`useFogColors`). */
    fogColor?: number[]
    /** What every shadow read gives, 1 by default, and the lane 0 of the lights it was asked for. */
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
    /** The local fog volumes' block of the light buffer (`directLights.localFog`), zero where none. */
    localFog?: number[][]
    /** The translucency volume the image made (its cells with a last word of 1, the slices' law): the cells then read
     *  `giTexels` — the ambient light in the first half of the slices, the three linear bands' weights in the second —
     *  at the places `giTaps` keeps. */
    translucencyGi?: NonNullable<Parameters<typeof image>[3]>['translucencyGi']
    giTexels?: [number[], number[]]
    giTaps?: number[][]
    /** The lights (a bit a rank, 32 ranks a word) whose ray traced shadow the volume holds, and the words of the cell as they read: a bit set where the ray reached the light (the volume holds the blocked ones). A number is the first word. */
    traced?: { lights: number | number[]; seen: number | number[] }
  } = {},
) {
  const { lights = [], density = 0.1, falloff = 0 } = world
  // A view drawn smaller than the targets: its camera of that size, the textures' cells those of CAM.
  const cam = world.camera ?? (world.drawn ? camera(EYE, ...world.drawn) : CAM)
  const before = world.previousEye ? camera(world.previousEye, ...(world.drawn ?? [160, 90])) : cam
  const previous = world.before ? previousOf(before) : undefined
  const heldWords = [world.traced?.lights ?? 0].flat()
  const seenWords = [world.traced?.seen ?? 0xffffffff].flat()
  const img = image(
    cam,
    world.volumetric ?? true,
    { ...PLAIN, ...world.settings },
    {
      sunRank: world.sunRank ?? -1,
      previous,
      resource: image(CAM).grid,
      translucencyGi: world.translucencyGi,
      tracedWords: heldWords.length,
    },
  )
  const block = emptyLights({ fog: FOG_SLOTS, atmosphere: ATMOSPHERE_SLOTS })
  block.fog[FOG_SLOT.law] = [density, falloff, 0, 1]
  block.fog[FOG_SLOT.second] = [world.second ?? 0, 0, 0, 0]
  if (world.fogColor) block.fog[FOG_SLOT.color] = [...world.fogColor, 0]
  if (world.localFog) block.localFog = world.localFog
  block.count = lights.length
  block.items = lights
  const out = table()
  const giVolume = {}
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
    fogVoxelIn: table(),
    fogVoxelEmitIn: table(),
    // The static term's volume is not read: the frame says no pass wrote it.
    fogStaticIn: table(),
    // The lights the volume holds a shadow of, and the words of them the cell holds (one above the other, the textures' depth apart).
    fogTracedHeldWords: heldWords,
    fogTracedIn: table((at) => [
      ~(seenWords[Math.floor(at[2]! / img.resource.z)] ?? 0xffffffff) >>> 0,
      0,
      0,
      0,
    ]),
    fogGiVolume: giVolume,
    mat2x3f: (ambient: number[], directional: number[]) => [ambient, directional],
    shadowFactor: (_slice: number, light: Light) => (
      world.shadowReads?.push(light.params[0]),
      world.shade ?? 1
    ),
    // No light function in the cell: every light as it is (`lightFunctionReadWgsl` has its own proofs).
    lightFunctionOf: () => [1, 1, 1],
    // The sky light: its diffuse light along any direction (`skyLightDiffuseSimple`), the scattering intensity it
    // lights the volume by (none where the scene has no sky light), whether one shines.
    skyLightApplied: () => !!world.sky && world.skyLight !== false,
    skyLightScattering: () => (world.skyLight === false ? 0 : (world.skyShare ?? 1)),
    skyLightDiffuseSimple: () => world.sky ?? [0, 0, 0],
    // No clouds' shade over the sun.
    cloudShadowOnSurface: () => 1,
    lightFunctionFogLocalOf: () => [1, 1, 1],
    // Nor does the sun (`sunFunction/readWgsl.ts` has its own proofs).
    fogSunFunctionOf: () => [1, 1, 1],
    textureSampleLevel: (texture: unknown, _s: unknown, uvw: number[]) =>
      texture === giVolume
        ? (world.giTaps?.push(uvw), [...world.giTexels![uvw[2] < 0.5 ? 0 : 1], 0])
        : (world.sampled?.push(uvw), world.previous ?? [0, 0, 0, 0]),
  })
  run.scatterMain(cell)
  return out.cells.get(cell.join(',')) as number[] | undefined
}

export const CELL: V3 = [3, 4, 2]
export const EXTINCTION = 0.05 // half the density of 0.1, per metre
export const G = 0.2

/** A lamp five metres off the cell's point, whole in its range: lit by its inverse square. */
export const lampAt = (P: V3): Light => lampOf([P[0] + 3, P[1] + 4, P[2]])
/** The red word the program stored at the cell `CELL` over the scene `world` describes. */
export const lit = (world: Parameters<typeof scatter>[1]) => scatter(CELL, world)![0]
