// The fog volume tests' common ground (`fogVolume.test.ts`): a camera — the engine's own reversed
// projection looking down −z —, the frame the volume's passes read as `writeFogVolumeFrame` writes it,
// turned into the values `shaderRun` runs the shipped programs with, and the textures those programs
// load from and store to, as plain tables.
import { newFogStaticLight } from './fog/staticLight.ts'
import {
  orthographicProjection,
  perspectiveProjection,
} from '../../../math/src/projection/camera.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { builtins } from '../materials/texture/shaderRunBuiltins.fixture.ts'
import { resolveVolumetricFog } from '../../../sdk-core/src/scene/core/fogVolumetric.ts'
import {
  VOLUMETRIC_FOG_RULES,
  type VolumetricFogValues,
} from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { dotVector3 } from '../../../math/src/vector/vector.ts'
import type { Vec3 as V3 } from '../../../math/src/vector/vectorTuple.ts'
import { cellGrid, FOG_VOLUME_FRAME_AT, FOG_VOLUME_FRAME_WORDS, sliceParams } from './fog/layout.ts'
import type { ResolvedHeightFog } from '../../../sdk-core/src/scene/core/fogHeight.ts'
import { writeFogViewBlock } from './fog/viewBlock.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOTS } from './fog/viewSlots.ts'
import { LOCAL_FOG_SLOTS } from './fog/localLayout.ts'
import { writeFogVolumeFrame, type FogVolumeImage, type FogVolumePrevious } from './fog/frame.ts'

type FogVolumeCamera = FogVolumeImage['camera']

/** A frame's worth of words, to write into (`writeFogVolumeFrame`). */
export const newFogVolumeFrame = () => new Float32Array(FOG_VOLUME_FRAME_WORDS)

/** The settings every field at its default. */
export const DEFAULT_SETTINGS = Object.fromEntries(
  Object.entries(VOLUMETRIC_FOG_RULES).map(([field, rule]) => [field, rule.default]),
) as unknown as VolumetricFogValues

/** The view depth a slice starts at, from its description: the slice is `log2(depth · B + O) · S`. */
export const depthAtSlice = (slice: number, p: { b: number; o: number; s: number }) =>
  (2 ** (slice / p.s) - p.o) / p.b
/** The slice a view depth falls in, the same description read the other way. */
export const sliceAtDepth = (depth: number, p: { b: number; o: number; s: number }) =>
  Math.log2(depth * p.b + p.o) * p.s

/** A camera at `eye` looking down −z, a vertical field of view of 60°, the engine's projection:
 *  `viewProj` and its inverse as column-major numbers, the pixels of the view. */
export function camera(eye: [number, number, number], width = 160, height = 90, near = 0.1) {
  const projection = perspectiveProjection(new Float64Array(16), 60, width / height, near, 1)
  // The ray through a pixel at ndc (x, y) is (x · half[0], y · half[1], −1) per unit of depth.
  return cameraOf(eye, projection, [width, height], near, true, [
    1 / projection[0],
    1 / projection[5],
  ])
}

/** An orthographic camera at `eye` looking down −z over a box of `box` half width and half height,
 *  between `near` and 100 m: the engine's reversed depth, linear in the view depth. */
export function orthoCamera(
  eye: [number, number, number],
  [width, height] = [160, 90],
  box: [number, number] = [8, 4.5],
) {
  const projection = orthographicProjection(
    new Float64Array(16),
    -box[0],
    box[0],
    -box[1],
    box[1],
    0.1,
    100,
  )
  return cameraOf(eye, projection, [width, height], 0.1, false, box)
}

function cameraOf(
  eye: [number, number, number],
  projection: Float64Array,
  [width, height]: number[],
  near: number,
  perspective: boolean,
  half: [number, number],
): FogVolumeCamera & { half: [number, number]; viewProj: Float64Array } {
  const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1])
  const viewProj = multiplyMatrix4(new Float64Array(16), projection, view)
  return {
    eye,
    forward: [0, 0, -1],
    projection,
    viewProj,
    inverseViewProj: invertMatrix4(new Float64Array(16), viewProj),
    depthViewProj: viewProj,
    world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1],
    near,
    width,
    height,
    perspective,
    half,
  }
}

/** What the volume kept of an image drawn from `cam` (the size of the view, or `width` by `height`), written with the
 *  pre-exposure `image` gives: the image before, as the history reads it. */
export const previousOf = (
  cam: FogVolumeCamera,
  width = cam.width,
  height = cam.height,
): FogVolumePrevious => ({ viewProj: cam.viewProj, width, height, preExposure: 1 })

/** An image of the volume over `camera`: the medium `volumetric` names, the defaults but for `settings`. */
export function image(
  cam: FogVolumeCamera,
  volumetric: Parameters<typeof resolveVolumetricFog>[0] = true,
  settings: Partial<VolumetricFogValues> = {},
  more: Partial<FogVolumeImage> = {},
): FogVolumeImage {
  const all = { ...DEFAULT_SETTINGS, ...settings }
  const grid = cellGrid(cam.width, cam.height, 8, 8)
  return {
    camera: cam,
    grid,
    resource: grid,
    medium: resolveVolumetricFog(volumetric)!,
    settings: all,
    rebuildSamples: 4,
    skipHidden: !!all.volumetricFogSkipHidden,
    sunRank: 0,
    lightCells: [0, 0],
    frameIndex: 0,
    voxels: false,
    // No baked light; the sky light lights the volume by its harmonics, as a movable one does.
    staticLight: { ...newFogStaticLight(), skyDiffuse: true },
    staticBuilt: false,
    preExposure: 1,
    exposure: 1,
    ...more,
  }
}

/** The frame of an image as `shaderRun` reads it: every field a JavaScript value, matrices as the
 *  run's `Mat`. */
export function frameScope(img: FogVolumeImage) {
  const words = writeFogVolumeFrame(newFogVolumeFrame(), img)
  const at = FOG_VOLUME_FRAME_AT
  const vec = (field: number) => Array.from(words.subarray(field, field + 4))
  const mat = (field: number) => builtins.mat4x4f(...Array.from(words.subarray(field, field + 16)))
  return {
    inverseViewProj: mat(at.inverseViewProj),
    viewProj: mat(at.viewProj),
    depthViewProj: mat(at.depthViewProj),
    prevViewProj: mat(at.prevViewProj),
    ...Object.fromEntries(
      (
        [
          'eye',
          'forward',
          'view',
          'grid',
          'texture',
          'sliceMap',
          'depthMap',
          'uv',
          'previous',
          'history',
          'blend',
          'lighting',
          'tune',
          'medium',
          'particleColor',
          'glow',
          'staticLight',
          'exposure',
          'giGrid',
          'giZ',
        ] as const
      ).map((name) => [name, vec(at[name])]),
    ),
    offsets: Array.from({ length: 16 }, (_, k) => vec(at.offsets + 4 * k)),
    frame: Array.from(new Uint32Array(words.buffer, at.frame * 4, 4)),
  }
}

/** The view block of an image as `directLights.fogView` holds it (`writeFogViewBlock`): its `vec4f`
 *  slots, or all zero where `built` is false. */
export function viewBlockOf(img: FogVolumeImage, built = true) {
  const words = built ? writeFogVolumeFrame(newFogVolumeFrame(), img) : undefined
  const look = { perspective: true, eyeHeight: img.camera.eye[1], fog: {} as ResolvedHeightFog }
  const out = writeFogViewBlock(new Float32Array(FOG_VIEW_FLOATS), words, img.settings, look)
  return Array.from({ length: FOG_VIEW_SLOTS }, (_, k) =>
    Array.from(out.subarray(4 * k, 4 * k + 4)),
  )
}

/** A texture the programs load from and store to: a table by cell, `value` giving a cell its first
 *  content, every store kept. */
export function table(value: (coords: number[]) => number | number[] = () => [0, 0, 0, 0]) {
  const cells = new Map<string, number | number[]>()
  const key = (coords: number[]) => coords.join(',')
  return {
    cells,
    load: (coords: number[]) => cells.get(key(coords)) ?? value(coords),
    // A store of a texture with no layers: its value is the third argument, read as the layer's.
    store: (coords: number[], layer: unknown, stored?: number[]) =>
      void cells.set(key(coords), (stored ?? layer) as number[]),
  }
}

/** The light buffer's block a program reads, every slot zero: the fog and the air. */
export const emptyLights = (slots: { fog: number; atmosphere: number }) => ({
  count: 0,
  // The simple lights follow the scene's in rank (none here), and the hair strands take them.
  simple: 0,
  simpleBits: 1,
  fog: Array.from({ length: slots.fog }, () => [0, 0, 0, 0]),
  atmosphere: Array.from({ length: slots.atmosphere }, () => [0, 0, 0, 0]),
  fogView: Array.from({ length: FOG_VIEW_SLOTS }, () => [0, 0, 0, 0]),
  localFog: Array.from({ length: LOCAL_FOG_SLOTS }, () => [0, 0, 0, 0]),
  items: [] as Record<string, number[]>[],
})

export type { V3 }
export const EYE: V3 = [0, 2, 0]
export const CAM = camera(EYE)
/** The grid of the images below: 8-pixel cells over 160 × 90, eight slices. */
export const GRID = { x: 20, y: 12, z: 8 }
/** The point of a cell at `offset`, from the camera's own geometry: the ray through its pixel, its
 *  view depth along it (the slices of `sliceParams`, the volume's far end 60 m). */
export function pointOf(cell: V3, offset: V3 = [0.5, 0.5, 0.5], start = 0): V3 {
  const p = sliceParams(Math.max(0.1, start), 60 + start, 32, GRID.z)
  const depth = depthAtSlice(cell[2] + offset[2], p)
  const ndc = [((cell[0] + offset[0]) / GRID.x) * 2 - 1, 1 - ((cell[1] + offset[1]) / GRID.y) * 2]
  return [
    EYE[0] + ndc[0] * CAM.half[0] * depth,
    EYE[1] + ndc[1] * CAM.half[1] * depth,
    EYE[2] - depth,
  ]
}
/** The phase function toward the eye of the light in the unit direction `toLight`. */
export const phase = (g: number, toLight: number[], toEye: number[]) =>
  (1 - g * g) / (4 * Math.PI * (1 + g * g + 2 * g * dotVector3(toLight, toEye)) ** 1.5)
