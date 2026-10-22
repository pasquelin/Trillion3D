import type { Texture } from '../../texture/texture.ts'
import type { Pin } from './graph.ts'
import type { NodeProp } from './nodeSpecs.ts'
import { MathGraph } from './math.ts'
import { given, type Wire } from './wired.ts'

/** How a sample picks its level: the computed one, an absolute one, or the computed plus a bias. */
type MipMode = 'none' | 'level' | 'bias'

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
