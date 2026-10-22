import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { AIR_BUFFER_STRUCT } from './layout.ts'
import { FRAME_WGSL } from './frame.ts'
import { SCATTER_WGSL } from './scatterWgsl.ts'

/** Where every atmosphere program binds what it reads and writes, in group 0: one table of
 *  numbers, so that the passes and their shaders agree. A program binds only what it names. */
export const AIR_BINDING = {
  /** The light buffer's front: the atmosphere's block, the view's block and the haze volume. */
  air: 0,
  /** The table a program writes: a storage texture. */
  table: 1,
  /** The transmittance table, sampled. */
  transmittance: 2,
  /** The multiple-scattering table, sampled. */
  multiScatter: 3,
  /** The tables' sampler: linear, clamped. */
  sampler: 4,
  /** The image's frame (`frame.ts`). */
  frame: 5,
  /** The sky capture's coefficients, a storage buffer. */
  capture: 6,
  /** The sky table seen from the eye, sampled. */
  skyView: 7,
  /** The surface flags, which tell the sky's pixels from a surface's. */
  flags: 8,
} as const

/** What a program binds, by name: its tables are bound as the shader names them. */
export type AirBindings = {
  /** How the light buffer is bound: read-only, or written (the haze volume, the sky's mean). */
  air: 'read' | 'read_write'
  /** The table written, a storage texture. */
  table?: boolean
  /** The tables read. */
  transmittance?: boolean
  multiScatter?: boolean
  skyView?: boolean
  frame?: boolean
  capture?: boolean
  flags?: boolean
}

const b = AIR_BINDING

/** The declarations of a program that binds `bindings`: the buffer's front and the accessors the
 *  march reads the air through (`opticsWgsl.ts`); a table the program does not bind answers as no
 *  air would (nothing scattered, nothing lost). */
const declarations = (bindings: AirBindings) => `
${AIR_BUFFER_STRUCT}
@group(0) @binding(${b.air}) var<storage,${bindings.air}> air:AirBuffer;
fn atmo(slot:u32)->vec4f{return air.atmosphere[slot];}
${bindings.table ? `@group(0) @binding(${b.table}) var table:texture_storage_2d<rgba16float,write>;` : ''}
${bindings.transmittance || bindings.multiScatter || bindings.skyView ? `@group(0) @binding(${b.sampler}) var tableSampler:sampler;` : ''}
${
  bindings.transmittance
    ? `@group(0) @binding(${b.transmittance}) var transmittanceTable:texture_2d<f32>;
fn transmittanceAt(uv:vec2f)->vec3f{return textureSampleLevel(transmittanceTable,tableSampler,uv,0.0).rgb;}`
    : 'fn transmittanceAt(uv:vec2f)->vec3f{return vec3f(1.0);}'
}
${
  bindings.multiScatter
    ? `@group(0) @binding(${b.multiScatter}) var multiScatterTable:texture_2d<f32>;
fn multiScatterAt(uv:vec2f)->vec3f{return textureSampleLevel(multiScatterTable,tableSampler,uv,0.0).rgb;}`
    : 'fn multiScatterAt(uv:vec2f)->vec3f{return vec3f(0.0);}'
}
${bindings.skyView ? `@group(0) @binding(${b.skyView}) var skyViewTable:texture_2d<f32>;` : ''}
${bindings.frame ? `@group(0) @binding(${b.frame}) var<uniform> frame:AirFrame;` : ''}
${bindings.capture ? `@group(0) @binding(${b.capture}) var<storage,read_write> capture:array<f32,32>;` : ''}
${bindings.flags ? `@group(0) @binding(${b.flags}) var flags:texture_2d<u32>;` : ''}
`

/** A whole program: its bindings, and its text — their declarations, the march and the frame, and
 *  its own text. */
export interface AirProgram {
  readonly bindings: AirBindings
  readonly code: string
}

export const airProgram = (
  bindings: AirBindings,
  own: string,
  uses: readonly WgslDecl[] = [],
): AirProgram => ({
  bindings,
  code: wgslProgram(`${declarations(bindings)}\n${own}`, [SCATTER_WGSL, FRAME_WGSL, ...uses]),
})

/** The bind group layout of a program that binds `bindings`, seen by `visibility`: the very
 *  entries its declarations (`declarations`) name, made of the same table. */
export function airLayoutEntries(
  bindings: AirBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: b.air,
      visibility,
      buffer: { type: bindings.air === 'read' ? 'read-only-storage' : 'storage' },
    },
  ]
  const sampled = (binding: number, sampleType: GPUTextureSampleType = 'float') =>
    entries.push({ binding, visibility, texture: { sampleType, viewDimension: '2d' } })
  if (bindings.table)
    entries.push({
      binding: b.table,
      visibility,
      storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' },
    })
  if (bindings.transmittance || bindings.multiScatter || bindings.skyView)
    entries.push({ binding: b.sampler, visibility, sampler: { type: 'filtering' } })
  if (bindings.transmittance) sampled(b.transmittance)
  if (bindings.multiScatter) sampled(b.multiScatter)
  if (bindings.skyView) sampled(b.skyView)
  if (bindings.frame) entries.push({ binding: b.frame, visibility, buffer: { type: 'uniform' } })
  if (bindings.capture)
    entries.push({ binding: b.capture, visibility, buffer: { type: 'storage' } })
  if (bindings.flags) sampled(b.flags, 'uint')
  return entries
}
