import { SRGB_LUMINANCE } from '../../../../../math/src/color/color.ts'

/** A value a node keeps beside its wires: a number, a flag, a word or a short list of numbers. */
export type NodeProp = number | boolean | string | readonly number[]

/** What a kind holds: the names of its input wires (those `required` must be wired), the properties
 *  it starts with, and the component masks of its outputs — `''` the whole value, else the letters
 *  of the components the output picks. */
export interface NodeSpec {
  readonly inputs: readonly string[]
  readonly required: readonly string[]
  readonly props: Readonly<Record<string, NodeProp>>
  readonly outputs: readonly string[]
}

const spec = (
  inputs: readonly string[],
  required: readonly string[],
  props: Record<string, NodeProp> = {},
  outputs: readonly string[] = [''],
): NodeSpec => ({ inputs, required, props, outputs })
const unary = spec(['input'], ['input'])
const pair = (constA: number, constB: number) => spec(['a', 'b'], [], { constA, constB })
const both = spec(['a', 'b'], ['a', 'b'])
const COLOUR = ['rgb', 'r', 'g', 'b', 'a', 'rgba']

/** The modes of a sparse volume read's level: the computed one, an absolute one, the computed plus a
 *  bias, or the one the coordinate's derivatives give (`ETextureMipValueMode`,
 *  `MaterialExpressionSparseVolumeTextureSample.h:35-45`). */
export const SPARSE_MIP_MODES = ['none', 'level', 'bias', 'derivative'] as const

/** How a coordinate past the volume's sides reads: the edge, wrapped around, or mirrored
 *  (`SVTADDRESSMODE_*`, `SparseVolumeTextureCommon.ush:14-16`). */
export const SPARSE_ADDRESS_MODES = ['clamp', 'wrap', 'mirror'] as const

/** The noise functions of a `noise` node: gradient noise of a simplex lattice (`simplex`) and of a
 *  cubic one (`gradient`), a gradient noise that repeats every 15 cells (`fastGradient`), a gradient
 *  noise (`gradientAlu`) and a value noise (`valueAlu`) of hashed lattice points, and the distance to
 *  the nearest of the points jittered in each cell (`voronoi`). */
export const NOISE_FUNCTIONS = [
  'simplex',
  'gradient',
  'fastGradient',
  'gradientAlu',
  'valueAlu',
  'voronoi',
] as const

/** The name of a noise function of a `noise` node. */
export type NoiseFunction = (typeof NOISE_FUNCTIONS)[number]

/** Every kind with its inputs and defaults: the constants a node falls back to where an input is not
 *  wired are the properties named `const…`. */
export const NODE_SPECS = {
  constant: spec([], [], { value: [0] }),
  scalarParameter: spec([], [], { name: '', value: 0 }),
  vectorParameter: spec([], [], { name: '', value: [0, 0, 0, 1] }, COLOUR),
  textureObject: spec([], []),
  textureParameter: spec([], [], { name: '' }),
  textureSample: spec(
    ['uv', 'texture', 'mip'],
    [],
    { name: '', mipMode: 'none', constMip: -1, constCoordinate: 0 },
    COLOUR,
  ),
  sparseVolumeTextureObject: spec([], [], { source: -1 }),
  sparseVolumeTextureParameter: spec([], [], { name: '', source: -1 }),
  sparseVolumeTextureSample: spec(
    ['uvw', 'texture', 'mip', 'ddx', 'ddy'],
    [],
    { source: -1, name: '', mipMode: 'none', constMip: 0, address: 'clamp', attributes: 0 },
    COLOUR,
  ),
  texCoord: spec([], [], { index: 0, uTiling: 1, vTiling: 1 }),
  time: spec([], [], { ignorePause: false, overridePeriod: false, period: 0 }),
  panner: spec(['coordinate', 'time', 'speed'], [], {
    speedX: 0,
    speedY: 0,
    constCoordinate: 0,
    fractionalPart: false,
  }),
  rotator: spec(['coordinate', 'time'], [], {
    centerX: 0.5,
    centerY: 0.5,
    speed: 0.25,
    constCoordinate: 0,
  }),
  worldPosition: spec([], [], { cameraRelative: false }, ['rgb', 'rg', 'b']),
  cameraPosition: spec([], []),
  objectPosition: spec([], [], { cameraRelative: false }),
  vertexNormal: spec([], []),
  pixelNormal: spec([], []),
  vertexColor: spec([], [], {}, ['rgb', 'r', 'g', 'b', 'a']),
  cameraVector: spec([], []),
  noise: spec(['position', 'filterWidth'], [], {
    constFilterWidth: 0,
    relativeToCamera: false,
    scale: 1,
    quality: 1,
    noiseFunction: 'simplex',
    turbulence: true,
    levels: 6,
    outputMin: -1,
    outputMax: 1,
    levelScale: 2,
    tiling: false,
    repeatSize: 512,
  }),
  add: pair(0, 1),
  subtract: pair(1, 1),
  multiply: pair(0, 1),
  divide: pair(1, 2),
  power: spec(['base', 'exponent'], ['base'], { constExponent: 2 }),
  abs: unary,
  min: pair(0, 1),
  max: pair(0, 1),
  clamp: spec(['input', 'min', 'max'], ['input'], { mode: 'clamp', constMin: 0, constMax: 1 }),
  saturate: unary,
  lerp: spec(['a', 'b', 'alpha'], [], { constA: 0, constB: 1, constAlpha: 0.5 }),
  oneMinus: unary,
  frac: unary,
  floor: unary,
  ceil: unary,
  sine: spec(['input'], ['input'], { period: 1 }),
  cosine: spec(['input'], ['input'], { period: 1 }),
  tangent: spec(['input'], ['input'], { period: 1 }),
  arctangent2: spec(['y', 'x'], ['y', 'x']),
  fmod: both,
  sqrt: unary,
  exp: unary,
  exp2: unary,
  log: unary,
  log2: spec(['x'], ['x']),
  log10: spec(['x'], ['x']),
  sign: unary,
  round: unary,
  dot: both,
  cross: both,
  normalize: unary,
  length: unary,
  appendVector: both,
  componentMask: spec(['input'], ['input'], { r: false, g: false, b: false, a: false }),
  if: spec(
    ['a', 'b', 'aGreaterThanB', 'aEqualsB', 'aLessThanB'],
    ['a', 'aGreaterThanB', 'aLessThanB'],
    { constB: 0, equalsThreshold: 0.00001 },
  ),
  fresnel: spec(['exponent', 'baseReflectFraction', 'normal'], [], {
    constExponent: 5,
    constBaseReflectFraction: 0.04,
  }),
  desaturation: spec(['input', 'fraction'], ['input'], { luminance: [...SRGB_LUMINANCE] }),
  contrast: spec(['input', 'amount', 'pivot'], ['input'], { constAmount: 1, constPivot: 0.5 }),
} satisfies Record<string, NodeSpec>

/** The kinds of node a material graph holds: the kinds of `NODE_SPECS`. */
export type NodeKind = keyof typeof NODE_SPECS

/** The component masks of the outputs of a node: a constant's whole value then its channels. */
export function outputMasks(kind: NodeKind, props: Readonly<Record<string, NodeProp>>) {
  if (kind !== 'constant') return NODE_SPECS[kind].outputs
  const width = (props.value as readonly number[]).length
  const whole = 'rgba'.slice(0, Math.max(width, 1))
  return width === 1 ? [''] : [whole, ...'rgba'.slice(0, width), ...(width === 4 ? ['rgb'] : [])]
}
