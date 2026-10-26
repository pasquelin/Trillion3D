import { postSamplers } from '../gpu/core/postSamplers.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import {
  COLOR_GRADING_RULES,
  type ColorGradingValues,
} from '../../../sdk-core/src/contracts/colorGradingOptions.ts'
import { settingsDiffer } from '../../../sdk-core/src/contracts/settingRules.ts'
import { TONE_TABLE_PASS } from '../diagnostic/stage/passLabels.ts'
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../gpu/core/computeStages.ts'
import { ledgerAdmitted, ledgerRoom } from '../gpu/core/deviceLedger.ts'
import { retire } from '../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { uniformBlock } from '../gpu/core/uniformBlock.ts'
import { writeBake } from './toneBakeParams.ts'
import {
  BAKE_BYTES,
  BAKE_GROUP,
  BAKE_LAYOUT,
  toneBakeShader,
  toneTableFormat,
  type ToneTableFormat,
} from './toneBakeWgsl.ts'
import { TONE_READ_WORDS } from './toneLutRead.ts'

const PASS: GPUComputePassDescriptor = { label: TONE_TABLE_PASS }

/** The baking's program once a device, prepared off the thread: its layout and its compute stage. */
const bakePrograms = oncePerDevice((device: GPUDevice) => {
  const format = toneTableFormat(device.features)
  const layout = device.createBindGroupLayout({
    label: TONE_TABLE_PASS,
    entries: [
      computeUniformEntry(0, { minBindingSize: BAKE_BYTES }, COMPUTE),
      computeStorageTextureEntry(1, format, 'write-only', '3d', COMPUTE),
    ],
  })
  return {
    layout,
    stage: preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({ label: TONE_TABLE_PASS, code: toneBakeShader(format) }),
      'bakeTable',
      undefined,
      TONE_TABLE_PASS,
    ),
  }
})

/** The cube's side for `values`: the setting, held to the largest 3D texture the device makes. */
const sideOf = (device: GPUDevice, values: ColorGradingValues) =>
  Math.min(values.lutSize, device.limits?.maxTextureDimension3D ?? Infinity)

/** The texels a side of a table made before any setting is read: the setting's default. */
const DEFAULT_SIZE = COLOR_GRADING_RULES.lutSize.default
/** The least cube there is: the setting's own least. */
const LEAST_SIZE = COLOR_GRADING_RULES.lutSize.range[0]

/** The bytes of a cube of `side` texels a side in `format`. */
const cubeBytes = (format: ToneTableFormat, side: number) => side ** 3 * texelBytesOf(format)
/** The largest side whose cube of `format` `room` bytes hold, the least cube at least. */
const sideHolding = (format: ToneTableFormat, room: number) =>
  Math.max(LEAST_SIZE, Math.floor(Math.cbrt(Math.max(room, 0) / texelBytesOf(format))))

/** Asks the baking's program of `device` off the frame, the frames held until it landed
 *  (`../frame/loop/framePipelines.ts`). */
export const askToneBake = (device: GPUDevice) => void bakePrograms(device).stage.ask()

/** What a table needs beside its texture: the baking's program, its uniform, the reading's
 *  uniform and the sampler that interpolates the cube. */
function tableParts(device: GPUDevice) {
  return {
    programs: bakePrograms(device),
    params: uniformBlock(device, 'Trillion3D tone table bake', BAKE_BYTES),
    reading: uniformBlock(device, 'Trillion3D tone table read', TONE_READ_WORDS * 4),
    sampler: postSamplers(device).clamped,
  }
}
type TableParts = ReturnType<typeof tableParts>

/** The cube of `size` texels a side and the group the baking writes it through. */
function makeTable(
  device: GPUDevice,
  { programs, params }: TableParts,
  size: number,
  format: ToneTableFormat,
) {
  const texture = device.createTexture({
    label: TONE_TABLE_PASS,
    size: { width: size, height: size, depthOrArrayLayers: size },
    dimension: '3d',
    format,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const view = texture.createView({ dimension: '3d' })
  const group = device.createBindGroup({
    layout: programs.layout,
    entries: sequentialEntries([{ buffer: params.buffer, size: BAKE_BYTES }, view]),
  })
  return { texture, view, group, size }
}

/** Writes the baking's uniform and the reading's for `values` and the display curve's rank `rank`,
 *  and bakes `table` in one compute pass over the cube. */
function bakeInto(
  encoder: GPUCommandEncoder,
  { programs, params, reading }: TableParts,
  { group, size }: Table,
  values: ColorGradingValues,
  rank: number,
  pipeline: GPUComputePipeline,
) {
  writeBake(params.words.f, values, rank)
  params.send()
  const shaper = values.lutShaper === 'pq' ? 1 : 0
  // The scale the baking divided by (`device.w`): the reader multiplies it back.
  reading.words.f.set([
    (size - 1) / size,
    0.5 / size,
    shaper,
    params.words.f[BAKE_LAYOUT.at.device + 3],
  ])
  reading.send()
  const pass = encoder.beginComputePass(PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  const groups = ceilDiv(size, BAKE_GROUP)
  pass.dispatchWorkgroups(groups, groups, groups)
  pass.end()
}

type Table = ReturnType<typeof makeTable>

/**
 * The table a view keeps, at the size asked: kept while the size holds, else made again, the one it
 * replaces retired (an image's commands may still name it). The cube is admitted by the device's
 * budget (`ledgerAdmitted`, its bytes known before): where the room holds fewer texels it is the
 * largest side the room holds, and `why` says so — the setting has no limit but the memory. Not even
 * the least cube is optional: a lit image reads a table, so that one is made as any resource that
 * cannot be left out.
 */
function tableKeeper(device: GPUDevice, own: () => TableParts) {
  const format = toneTableFormat(device.features)
  let table: Table | undefined, why: string | undefined
  return {
    format,
    get table() {
      return table
    },
    get why() {
      return why
    },
    of(size: number) {
      if (table?.size === size) return table
      const held = table && {
        bytes: cubeBytes(format, table.size),
        dispose: () => retire(device, table!.texture),
      }
      const side = Math.min(size, sideHolding(format, ledgerRoom(device) + (held?.bytes ?? 0)))
      const admitted = ledgerAdmitted(device, {
        held,
        asked: cubeBytes(format, side),
        what: 'the tone table',
        make: () => makeTable(device, own(), side, format),
      })
      why =
        admitted.why ??
        (side < size
          ? `the memory budget leaves room for ${side} texels a side of the tone table, not ${size}`
          : undefined)
      return (table = admitted.value ?? makeTable(device, own(), LEAST_SIZE, format))
    },
  }
}

/**
 * A view's TONE TABLE (`toneBakeWgsl.ts`): a cube of `lutSize` texels a side, ten bits a channel
 * (`toneTableFormat`), in which the colour the display shows is baked for every light the table's shaper addresses —
 * the scene's display curve, the white balance, the colour grade, the correction and the display's
 * transfer in one read, which every pixel of the composition makes (`toneLutRead.ts`) in place of
 * the whole chain. It is baked again — one compute pass over the cube — only when a setting
 * (`ColorGradingValues`) or the rank of the scene's display curve differs from the last baked, and
 * its texture is made again when the size differs (`tableKeeper`). Everything but the object is made
 * at the first ask (`view`, `sampler`, `reading`, `encode`): a frame that shows no lit colour holds
 * none. `reading` is the uniform the reader takes the cube's size, shaper and scale from, written
 * when the table is baked.
 */
export function createToneLut(device: GPUDevice) {
  let parts: TableParts | undefined,
    usedRank = -1
  const used = {} as ColorGradingValues
  const own = () => (parts ??= tableParts(device))
  const keeper = tableKeeper(device, own)
  /** Whether the table differs from what `values` and the rank `rank` ask: none baked, a setting
   *  moved, or the curve changed. */
  const moving = (values: ColorGradingValues, rank: number) =>
    usedRank < 0 || rank !== usedRank || settingsDiffer(COLOR_GRADING_RULES, used, values)
  return {
    /** The table's texture view, made at the size last baked or the default. */
    view: () => keeper.of(keeper.table?.size ?? DEFAULT_SIZE).view,
    /** The bytes the table's texture holds: 0 before it is made. A view's reserve counts them. */
    get bytes() {
      return keeper.table ? cubeBytes(keeper.format, keeper.table.size) : 0
    },
    /** The texels a side the cube has: 0 before it is made; fewer than the setting asks where the
     *  budget's room held fewer (`why`). */
    get side() {
      return keeper.table?.size ?? 0
    },
    /** Why the cube is smaller than the setting asks: the budget's reason. */
    get why() {
      return keeper.why
    },
    /** The baking's words as last written, which the translucent layers' uniforms copy. */
    get words() {
      return parts?.params.words.f
    },
    /** The sampler that interpolates the table. */
    get sampler() {
      return own().sampler
    },
    /** The uniform the reader takes the cube's size, shaper and scale from. */
    get reading() {
      return own().reading.buffer
    },
    /** `moving`: a view that rests is drawn again while the table is not what its settings ask. */
    moving,
    /** Whether the table was baked at least once: before that nothing waits on it. */
    get baked() {
      return usedRank >= 0
    },
    /** Bakes the table again into `encoder` when `moving` says it differs: its size taken from
     *  `values`, the baking's uniform and the reading's written, the cube covered by one pass. */
    encode(encoder: GPUCommandEncoder, values: ColorGradingValues, rank: number) {
      if (!moving(values, rank)) return false
      // Not compiled yet: nothing is taken as baked, the next frame bakes.
      const pipeline = own().programs.stage.get()
      if (!pipeline) return false
      Object.assign(used, values)
      usedRank = rank
      const made = keeper.of(sideOf(device, values))
      bakeInto(encoder, own(), made, { ...values, lutSize: made.size }, rank, pipeline)
      return true
    },
    dispose() {
      for (const held of [keeper.table?.texture, parts?.params.buffer, parts?.reading.buffer])
        held?.destroy()
    },
  }
}

/** What the frame's metrics publish of the tone table: its side, its bytes and, where the budget kept it from the size the
 *  setting asks, why. Nothing before the cube is made. */
export const toneTableMetrics = (lut: ToneLut | undefined) =>
  lut?.side ? { side: lut.side, bytes: lut.bytes, why: lut.why ?? null } : undefined

/** A view's tone table (`createToneLut`). */
export type ToneLut = ReturnType<typeof createToneLut>
