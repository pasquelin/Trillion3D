import { PHYSICAL_MAP_FIELDS, type VisMaterial } from '../../visibility/materialType.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'
import { PHYSICAL_SECOND_UV } from '../../visibility/types.ts'

/** Words of one record (`physicalTableWgsl`, `../../visibility/shader/physicalWgsl.ts`): the four
 *  factors, the coat normal's two scales, the maps' UV channels, a pad, the four map slots. */
export const PHYSICAL_RECORD_WORDS = 12
/** Records a row of the table texture holds, three `rgba32uint` texels each: a row is 768 texels,
 *  within every device's side, and a record's index splits into its row and column by a shift. */
export const PHYSICAL_ROW_RECORDS = 256
const ROW_TEXELS = PHYSICAL_ROW_RECORDS * 3,
  ROW_BYTES = ROW_TEXELS * 16

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const FLOOR = Number(ROUGHNESS_FLOOR)
/** One record, filled before it is compared with the table's: a row write allocates nothing. */
const scratch = new Float32Array(PHYSICAL_RECORD_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)

/** A physical word (`PageInfo.physical`, a blend item's): the record's rank plus one `record`, its
 *  high bit set where the geometry is read as floats and carries a second UV set (`vertUv1`). */
export const physicalWord = (record: number, floatSecondUv: boolean) =>
  record && floatSecondUv ? (record | PHYSICAL_SECOND_UV) >>> 0 : record

/**
 * Writes the record of `mat` at word `at`: its factors as the material declares them, clamped as
 * the lobes read them (a strength and a coat in [0, 1], a coat roughness in [floor, 1]); its maps'
 * slots in the data atlas, in `PHYSICAL_MAP_FIELDS` order, 0 for none; bit `i` of the channels word
 * set where map `i` reads the second UV set. Returns whether a word changed.
 */
function writePhysicalRecord(
  ints: Uint32Array,
  at: number,
  mat: VisMaterial,
  dataLayer: ReadonlyMap<Texture, number>,
) {
  scratch[0] = clamp(mat.anisotropy ?? 0, 0, 1)
  scratch[1] = mat.anisotropyRotation ?? 0
  scratch[2] = clamp(mat.clearcoat ?? 0, 0, 1)
  scratch[3] = clamp(mat.clearcoatRoughness ?? 0, FLOOR, 1)
  scratch[4] = mat.clearcoatNormalScale?.[0] ?? 1
  scratch[5] = mat.clearcoatNormalScale?.[1] ?? 1
  let channels = 0
  for (let i = 0; i < PHYSICAL_MAP_FIELDS.length; i++) {
    const map = mat[PHYSICAL_MAP_FIELDS[i]]
    scratchInts[8 + i] = map ? (dataLayer.get(map) ?? 0) : 0
    if (map?.channel === 1) channels |= 1 << i
  }
  scratchInts[6] = channels
  scratchInts[7] = 0
  let changed = false
  for (let i = 0; i < PHYSICAL_RECORD_WORDS; i++)
    if (ints[at + i] !== scratchInts[i]) {
      ints[at + i] = scratchInts[i]
      changed = true
    }
  return changed
}

/**
 * The physical records of a session's surfaces, one per surface that carries a lobe
 * (`hasPhysicalLobes`), opaque or blended, in one `rgba32uint` texture the opaque resolve and the
 * blend pass both read (`physicalTableWgsl`): a texture, not a storage buffer, so neither pass
 * spends one of the eight storage buffers a stage is guaranteed. A row or a blend item names its
 * surface's record by rank plus one (`PageInfo.physical`), 0 for none, so it pays one word and the
 * surfaces without a lobe nothing. A record is rewritten with its rows — every row write reads the
 * surface's fields and slots again —, the texture written only over the records that changed, and
 * grown by doubling its rows: a new texture, which the passes' live entries rebind.
 *
 * An open world's surfaces come and go: the table holds none of them alive (weak maps), and the
 * rank of a surface the collector took — no page, row or item names it any longer — is handed to
 * the next lobed surface, so the table is as tall as the lobed surfaces alive, not as all seen.
 */
export function createPhysicalTable() {
  const freed: number[] = []
  const p: Records = {
    ranks: new WeakMap(),
    words: new WeakMap(),
    freed,
    reclaim: new FinalizationRegistry<number>((rank) => void freed.push(rank)),
    ints: new Uint32Array(PHYSICAL_RECORD_WORDS),
    ...{ held: 0, epoch: 0, low: Infinity, high: -1, texture: undefined },
  }
  const table = {
    view: undefined as GPUTextureView | undefined,
    /** The row word of `mat`: its record's rank plus one, or 0 without a lobe. A surface of a
     *  version (`refreshSurface`) whose atlas slots held since its last write keeps its word. */
    rowWord: (mat: Surface, dataLayer: Layers) => rowWord(p, mat, dataLayer),
    /** The data atlas's slots moved — a census, a texture appended or released: every surface's
     *  record is rewritten at its next row. */
    forget() {
      p.epoch++
    },
    /** Whether `upload` has records to send, or no texture yet. */
    get pending() {
      return p.low <= p.high || !p.texture
    },
    /** The view the passes bind, its texture made or grown to hold every record, and the records
     *  written since the last upload sent up: their span of the first row alone, else their rows. */
    upload: (device: GPUDevice) => upload(p, table, device),
    dispose() {
      p.texture?.destroy()
      p.texture = table.view = undefined
    },
  }
  return table
}

type Surface = VisMaterial & { version?: number }
type Layers = ReadonlyMap<Texture, number>
type Records = {
  ranks: WeakMap<VisMaterial, number>
  /** Each surface's word as last written, at its version and the atlas slots' epoch: a row of a
   *  surface that moved neither reads it back, no lobe test, slot lookup or record compare. */
  words: WeakMap<VisMaterial, { word: number; version: number; epoch: number }>
  /** Ranks whose surface the collector took, handed out again before a new one. */
  freed: number[]
  reclaim: FinalizationRegistry<number>
  ints: Uint32Array<ArrayBuffer>
  /** Ranks handed out so far (the table's height), the atlas slots' epoch, and the range of
   *  records written since the last upload (`low > high`: none). */
  held: number
  epoch: number
  low: number
  high: number
  texture: GPUTexture | undefined
}

function rowWord(p: Records, mat: Surface, dataLayer: Layers) {
  const kept = p.words.get(mat),
    version = mat.version
  if (kept && kept.version === version && kept.epoch === p.epoch) return kept.word
  const word = write(p, mat, dataLayer)
  if (version === undefined) return word
  // One record per surface, refilled at each miss: an epoch bump allocates nothing.
  if (kept) {
    kept.word = word
    kept.version = version
    kept.epoch = p.epoch
  } else p.words.set(mat, { word, version, epoch: p.epoch })
  return word
}

/** The record of `mat`, written now, and its rank plus one; 0 without a lobe. */
function write(p: Records, mat: VisMaterial, dataLayer: Layers) {
  if (!hasPhysicalLobes(mat)) return 0
  let rank = p.ranks.get(mat)
  if (rank === undefined) {
    rank = p.freed.pop() ?? p.held++
    p.ranks.set(mat, rank)
    p.reclaim.register(mat, rank)
    // Records held: a power of two, so past one row a whole number of rows.
    if ((rank + 1) * PHYSICAL_RECORD_WORDS > p.ints.length) {
      const grown = new Uint32Array(p.ints.length * 2)
      grown.set(p.ints)
      p.ints = grown
    }
  }
  if (writePhysicalRecord(p.ints, rank * PHYSICAL_RECORD_WORDS, mat, dataLayer)) {
    p.low = Math.min(p.low, rank)
    p.high = Math.max(p.high, rank)
  }
  return rank + 1
}

function upload(p: Records, table: { view: GPUTextureView | undefined }, device: GPUDevice) {
  const rows = Math.max(1, Math.ceil(p.held / PHYSICAL_ROW_RECORDS))
  if (!p.texture || p.texture.height < rows) {
    // A pass this image encoded earlier — the opaque resolve before the blends grew the table —
    // still binds the old texture, its command buffer not yet submitted: destroyed now, that submit
    // would fail. It goes once the queue's work is done, the frame's submit long since made.
    const old = p.texture
    if (old) void device.queue.onSubmittedWorkDone().then(() => old.destroy())
    let height = 1
    while (height < rows) height *= 2
    p.texture = device.createTexture({
      label: 'Trillion3D physical records',
      size: [ROW_TEXELS, height],
      format: 'rgba32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    table.view = p.texture.createView()
    if (p.held) [p.low, p.high] = [0, p.held - 1]
  }
  const { low, high } = p
  if (low > high) return table.view!
  const first = Math.floor(low / PHYSICAL_ROW_RECORDS),
    last = Math.floor(high / PHYSICAL_ROW_RECORDS)
  // Within one row, the records' own texels; across rows, those rows whole.
  const x = first === last ? (low % PHYSICAL_ROW_RECORDS) * 3 : 0,
    width = first === last ? (high - low + 1) * 3 : ROW_TEXELS
  device.queue.writeTexture(
    { texture: p.texture, origin: [x, first] },
    p.ints,
    { offset: first * ROW_BYTES + x * 16, bytesPerRow: ROW_BYTES },
    [width, last - first + 1],
  )
  p.low = Infinity
  p.high = -1
  return table.view!
}
export type PhysicalTable = ReturnType<typeof createPhysicalTable>
