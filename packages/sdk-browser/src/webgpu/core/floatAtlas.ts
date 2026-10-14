import { createRecordTexture } from '../../gpu/core/recordTexture.ts'
import { mostRecords, type RecordLayout } from '../../gpu/core/recordLayout.ts'
import { recordTexelWgsl } from '../../gpu/core/recordTextureWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE FLOAT ATLAS: a list of floats the passes read by index — the float pool's normals and
 * tangents, a transparent table's — kept in an `r32float` record table of one float a record
 * (`../../gpu/core/recordLayout.ts`) instead of a storage buffer. A texture is no storage buffer, so
 * the passes that read it (the lighting with bounce, the shadow demand) hold the eight storage
 * buffers WebGPU guarantees per stage; and it is bounded by the texture limits, not by
 * `maxStorageBufferBindingSize`, so it holds at least what a buffer held. Float `i` is record `i`:
 * its column, row and layer the table's shifts and masks, as every record table's — no division a
 * read —, the same bits the buffer held, one texel each. A row holds 8192 floats and a layer 8192
 * rows, the sides every device grants: an atlas pads its last row, under 32 KiB, and one past a
 * layer its last layer; its bytes are the texture's (`bytes`), which the budgets fund.
 */
const floatLayout = (label: string): RecordLayout => ({
  label,
  format: 'r32float',
  fields: { Float: 1 },
  rowShift: 13,
  layerShift: 13,
})
const FLOAT_ATLAS = floatLayout('Trillion3D float atlas')

/** Whether a guaranteed device makes an atlas of `floats` floats. */
export const floatAtlasFits = (floats: number) => floats <= mostRecords(FLOAT_ATLAS)

/** A zeroed atlas of `floats` floats on `device` — its texture, the view the passes bind whole,
 *  its bytes and the floats it holds (`capacity`). */
export const createFloatAtlas = (device: GPUDevice, label: string, floats: number) =>
  createRecordTexture(
    device,
    floatLayout(label),
    floats,
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  )
export type FloatAtlas = ReturnType<typeof createFloatAtlas>

/** Writes `count` floats of `data`, from its float `offset`, at float `at` of `atlas`: whole rows
 *  at once, a partial row alone (`RecordTexture.write`). */
export function writeFloatAtlas(
  atlas: FloatAtlas,
  at: number,
  data: Float32Array<ArrayBuffer>,
  offset: number,
  count: number,
) {
  atlas.write('Float', at, count, data.buffer, data.byteOffset + offset * 4)
}

/** `fn name(i:u32)->f32`: float `i` of the atlas bound as `texture` (`texture_2d_array<f32>`), at
 *  the table's address (`recordTexelWgsl`). */
export const floatAtlasWgsl = (texture: string, name: string) => {
  const { x, at } = recordTexelWgsl(FLOAT_ATLAS, 'Float')
  return wgslBlock(
    `floatAtlasWgsl(${texture}, ${name})`,
    [],
    `fn ${name}(r:u32)->f32{let k=0u;${x}return textureLoad(${texture},${at},0).r;}`,
  )
}
