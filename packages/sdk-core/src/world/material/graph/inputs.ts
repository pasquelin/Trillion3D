import type { Texture } from '../../texture/texture.ts'
import type { Pin } from './graph.ts'
import type {
  NodeProp,
  NoiseFunction,
  SPARSE_ADDRESS_MODES,
  SPARSE_MIP_MODES,
} from './nodeSpecs.ts'
import { MathGraph } from './math.ts'
import type { SceneTextureId } from '../postProcessMaterial.ts'
import { given, type Wire } from './wired.ts'

/** How a sample picks its level: the computed one, an absolute one, or the computed plus a bias. */
export type MipMode = 'none' | 'level' | 'bias'

/** The options of a texture sample. */
export interface TextureSampleOptions {
  /** The coordinate; the texture coordinate set `constCoordinate` when not wired. */
  uv?: Pin
  /** A texture object wired in place of the node's own. */
  texture?: Pin
  /** The level or the bias (by `mipMode`), wired or a number. */
  mip?: Wire
  /** The name of a texture parameter replacing the node's texture (`set`). */
  name?: string
  mipMode?: MipMode
  constCoordinate?: number
}

/** The options of a sparse volume texture sample. */
export interface SparseVolumeSampleOptions {
  /** The coordinate in the volume, 0 to 1 on each side; the point's place in the object's bounds
   *  when not wired. */
  uvw?: Pin
  /** A sparse volume texture object wired in place of the node's own. */
  texture?: Pin
  /** The level (`level`) or the bias (`bias`) by `mipMode`, wired or a number. */
  mip?: Wire
  /** The derivatives of the coordinate, read by the mode `derivative`. */
  ddx?: Pin
  ddy?: Pin
  /** The name of a sparse volume parameter replacing the node's volume (`set`). */
  name?: string
  mipMode?: (typeof SPARSE_MIP_MODES)[number]
  address?: (typeof SPARSE_ADDRESS_MODES)[number]
  /** The attribute texture the read gives, 0 or 1. */
  attributes?: 0 | 1
}

/** The nodes that bring a value in: parameters, textures, coordinates, time, positions. */
export class InputGraph extends MathGraph {
  /** A scalar parameter, named, with its default value. */
  scalarParameter(name: string, value = 0) {
    return this.addNode('scalarParameter', { name, value })
  }
  /** A vector or colour parameter, named, with its default value. */
  vectorParameter(name: string, value: readonly number[] = [0, 0, 0, 1]) {
    return this.addNode('vectorParameter', { name, value: [...value] })
  }
  /** A texture as an object, to wire into the `texture` input of samples. */
  textureObject(texture: Texture) {
    return this.addNode('textureObject', {}, {}, texture)
  }
  /** A texture object that a parameter of this name replaces (`set`). */
  textureParameter(name: string, texture: Texture) {
    return this.addNode('textureParameter', { name }, {}, texture)
  }
  /** Reads `texture` (or the texture wired to `texture`) at `uv`. Its outputs are rgb, r, g, b,
   *  a and rgba. */
  textureSample(texture: Texture | undefined, options: TextureSampleOptions = {}) {
    const { uv, texture: object, mip, ...props } = options
    const inputs: Record<string, Pin> = {}
    if (uv) inputs.uv = uv
    if (object) inputs.texture = object
    const held: Record<string, NodeProp> = given(props)
    if (typeof mip === 'number') held.constMip = mip
    else if (mip) inputs.mip = mip
    return this.addNode('textureSample', held, inputs, texture)
  }
  /** A sparse volume texture as an object: the volume the node `source` of the scene cites, to wire
   *  into the `texture` input of samples. */
  sparseVolumeTextureObject(source: number) {
    return this.addNode('sparseVolumeTextureObject', { source })
  }
  /** A sparse volume texture object that a parameter of this name replaces: `set(name, node)`
   *  gives it the volume another node cites. */
  sparseVolumeTextureParameter(name: string, source: number) {
    return this.addNode('sparseVolumeTextureParameter', { name, source })
  }
  /** Reads the volume the node `source` cites (or the one wired to `texture`) at `uvw`. Its outputs
   *  are rgb, r, g, b, a and rgba of the attribute texture `attributes`. */
  sparseVolumeTextureSample(source: number | undefined, options: SparseVolumeSampleOptions = {}) {
    const { uvw, texture, mip, ddx, ddy, ...props } = options
    const inputs: Record<string, Pin> = {}
    for (const [name, pin] of Object.entries({ uvw, texture, ddx, ddy }))
      if (pin) inputs[name] = pin
    const held: Record<string, NodeProp> = given(props)
    if (source !== undefined) held.source = source
    if (typeof mip === 'number') held.constMip = mip
    else if (mip) inputs.mip = mip
    return this.addNode('sparseVolumeTextureSample', held, inputs)
  }
  /** Texture coordinate set `index` times the tiling. */
  texCoord(index = 0, uTiling = 1, vTiling = 1) {
    return this.addNode('texCoord', { index, uTiling, vTiling })
  }
  /** The time in seconds; with `period`, it repeats every `period` (0 holds it still). */
  time(period?: number, ignorePause = false) {
    const periodic: Record<string, NodeProp> =
      period === undefined ? {} : { overridePeriod: true, period }
    return this.addNode('time', { ignorePause, ...periodic })
  }
  /** Slides `coordinate` (set `constCoordinate` when not wired) by `speed` times `time`. */
  panner(o: PannerOptions = {}) {
    const { speed, coordinate, time, ...rest } = o
    const fixed = Array.isArray(speed) ? speed : undefined
    const props = given({ ...rest, speedX: fixed?.[0], speedY: fixed?.[1] })
    return this.wire(
      'panner',
      { coordinate, time, speed: fixed ? undefined : (speed as Pin) },
      props,
    )
  }
  /** Turns `coordinate` about (centerX, centerY) at `speed` radians per second. */
  rotator(o: RotatorOptions = {}) {
    const { coordinate, time, ...props } = o
    return this.wire('rotator', { coordinate, time }, given(props))
  }
  /** The world position of the point shaded. */
  worldPosition(cameraRelative = false) {
    return this.addNode('worldPosition', { cameraRelative })
  }
  /** The position of the camera. */
  cameraPosition() {
    return this.addNode('cameraPosition')
  }
  /** The position of the object (of the light, in a light function). */
  objectPosition(cameraRelative = false) {
    return this.addNode('objectPosition', { cameraRelative })
  }
  /** The normal of the vertex, in the world. */
  vertexNormal() {
    return this.addNode('vertexNormal')
  }
  /** The normal of the pixel, in the world. */
  pixelNormal() {
    return this.addNode('pixelNormal')
  }
  /** The colour painted on the vertices, interpolated: its outputs are rgb, r, g, b and a. */
  vertexColor() {
    return this.addNode('vertexColor')
  }
  /** The unit vector from the point shaded to the camera, in the world. */
  cameraVector() {
    return this.addNode('cameraVector')
  }
  /** The scene texture `id` — `sceneColor`, `sceneDepth`, `customDepth`, `customStencil` or `postProcessInput0` (the image so far) — read at `uv`
   *  (the pixel's place in the image, 0 to 1, where not wired), `filtered` with bilinear weights; its outputs are rgba, r, g, b and a. The depths
   *  are in metres along the view axis, the stencil the value written by the object. Only a post-process material has scene textures. */
  sceneTexture(id: SceneTextureId = 'postProcessInput0', uv?: Pin, filtered = false) {
    return this.wire('sceneTexture', { uv }, { id, filtered })
  }
  /** The size in pixels of the scene texture `id` (`inverse`: one over it). */
  sceneTextureSize(id: SceneTextureId = 'postProcessInput0', inverse = false) {
    return this.addNode('sceneTextureSize', { id, inverse })
  }
  /** A noise of `position` (the world position where not wired), the sum of `levels` noises each
   *  `levelScale` times finer and weaker than the one before, mapped from 0 to 1 to `outputMin` to
   *  `outputMax`. `filterWidth` (0) fades the levels finer than it away. */
  noise(options: NoiseOptions = {}) {
    const { position, filterWidth, ...props } = options
    return this.wire('noise', { position, filterWidth }, given(props))
  }
}

/** The options of a noise: what the node's properties are (`NODE_SPECS.noise`). */
export interface NoiseOptions {
  position?: Pin
  filterWidth?: Wire
  /** Whether a wired `position` is relative to the camera (`false`: in the world). */
  relativeToCamera?: boolean
  /** The factor the position is multiplied by (1). */
  scale?: number
  /** The function (`'simplex'`). */
  noiseFunction?: NoiseFunction
  /** Whether the levels add the absolute value of the noise, which makes creases (`true`), or the noise
   *  itself, brought from -1 to 1 into 0 to 1 at the end. */
  turbulence?: boolean
  /** How many noises are added, 1 to 10 (6). */
  levels?: number
  outputMin?: number
  outputMax?: number
  /** The factor each level's frequency grows by (2). */
  levelScale?: number
  /** Whether `gradient`, `gradientAlu`, `valueAlu` and `voronoi` repeat every `repeatSize` cells. */
  tiling?: boolean
  repeatSize?: number
  /** How many cells `voronoi` searches, 1 to 4: 8, 16, 27 and 32 (1). */
  quality?: number
}

/** The options of a panner. */
export interface PannerOptions {
  coordinate?: Pin
  time?: Pin
  /** The speed along u and v, per second: two numbers, or a wire of a vector whose x and y it is. */
  speed?: readonly [number, number] | Pin
  constCoordinate?: number
  fractionalPart?: boolean
}

/** The options of a rotator. */
export interface RotatorOptions {
  coordinate?: Pin
  time?: Pin
  centerX?: number
  centerY?: number
  speed?: number
  constCoordinate?: number
}
