/**
 * Every GPU buffer of the virtual shadow map system, sized by `layout.ts`, and the WGSL binding
 * declarations for them.
 *
 * The tables could be allocated per frame for the current map count, extracting the ones the next
 * frame reads. Here they are persistent, sized for a maximum count, and the extracted set is
 * double-buffered: `frames[current]` / `frames[prev]`, swapped by `swapFrames()` at the point the
 * frame data is extracted. The members no pass reads as the previous frame's are one buffer in
 * both frames (`SHARED_FRAME_MEMBERS`). A count above the maximum needs a new
 * `createVsmResources` (which drops the cache).
 *
 * 2D tables are storage buffers of u32, row-major, mips concatenated (see `pageTableWgsl.ts`). The
 * physical pool (R32 texel array, 2 slices) is, a slice, one buffer bound whole
 * (`poolSliceBytes`), its texels page by page (`vsmPoolTexelIndexWgsl`): the pages a device's
 * binding holds are the most it grants (`vsmPoolPagesBound`). The VSM passes bind both slices; a
 * reader outside them (`../../direct/shadowWgsl.ts`: translucent surfaces) the first
 * (`VSM_FORWARD_LAYOUT`).
 */
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS, VSM_POOL_SLICES } from './constants.ts'
import { VSM_STRUCTS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projection/projectionDataWgsl.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import { writeChangedCopy } from '../../../gpu/core/writeChanged.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../../gpu/bind/bindIdentity.ts'
import { pendingMade } from '../../../gpu/core/tableGrowth.ts'
import type { VsmProjectionState } from './projection/projectionStore.ts'
import type { VsmRenderContext } from './render/renderPipes.ts'
import type { VsmPageManagementContext } from './pageManagementPass.ts'
import type { VsmCastState } from './invalidation/castStale.ts'
import { vsmLayout, type VsmLayout, type VsmResourceOptions } from './layout.ts'
import {
  createKeptTables,
  createOcclusion,
  encodeKeptCarry,
  type VsmKeptTables,
  type VsmOcclusionResources,
} from './occlusion/occlusionResources.ts'
import type { VsmOcclusionContext } from './occlusion/occlusionPass.ts'
import type { VsmThrottleState } from './throttle.ts'
import { madeBytesOf } from '../../../gpu/core/textureBytes.ts'
import {
  bufferBytes,
  filterableBufferSizes,
  filterableHistoryBytes,
  frameBufferSizes,
  poolSliceBytes,
  setBufferSizes,
  SHARED_FRAME_MEMBERS,
  tableBufferSizes,
} from './layoutBytes.ts'
import { VSM_FILTER_ARGS_INIT, vsmHistoryHeader, vsmHistoryLayout } from './prefilteredConstants.ts'
import { wgslBlock, type WgslDecl, wgslFn } from '../../../../../math/src/wgsl/decl.ts'

/** One frame's buffers; `pageTable`, `receiverCover` and `staleRects` are the same
 *  buffer in both frames (`SHARED_FRAME_MEMBERS`). */
export interface VsmFrameBuffers {
  uniforms: GPUBuffer
  pageTable: GPUBuffer
  pageMarks: GPUBuffer
  receiverCover: GPUBuffer
  pageRequests: GPUBuffer
  staleRects: GPUBuffer
  mappedRects: GPUBuffer
  projectionData: GPUBuffer
  /** The page lists (`freePagesWgsl.ts`): the frame builds its own and reads the requested list of
   *  the previous frame's (`prev`), the order its pages are taken in. A table growth carries it. */
  freePages: GPUBuffer
}

/**
 * The prefiltered distant shadow's buffers (`prefilteredConstants.ts` lays them), made with a set
 * whose layout asks it (`VsmLayout.prefilteredDistant`): the byte pools a filtered page of
 * `VSM_FILTERABLE_PAGE_BYTES` a pool page — `separate`, one the frame writes and the other its
 * history, by the frame's parity (`vsmFrameParity`), `merged` the projection reads, which the
 * separable passes use as their temporary pool —, the indirect `args` and their empty form
 * `argsInit`, the `pages` lists, and the `history` of the previous frame.
 */
interface VsmFilterable {
  separate: [GPUBuffer, GPUBuffer]
  merged: GPUBuffer
  args: GPUBuffer
  argsInit: GPUBuffer
  pages: GPUBuffer
  /** The map ids, the previous frame's projection records, page table and receiver cover of the
   *  suns' maps, laid by `vsmHistoryLayout`; the plan writes the ids (`uploadFilterableHistory`), the
   *  frame end the rest (`keepFilterableHistory`). */
  history: GPUBuffer
  /** Whether the history holds the previous frame (`keepFilterableHistory`). */
  historyValid: boolean
  /** Whether the frame has a map that holds the prefiltered distant shadow, set by the plan: the
   *  frame resets, filters and keeps the history only then. */
  active: boolean
}

export interface VsmResources {
  layout: VsmLayout
  frames: [VsmFrameBuffers, VsmFrameBuffers]
  current: VsmFrameBuffers
  prev: VsmFrameBuffers
  /** Persistent, updated in place by the physical page address update (one buffer in both frames). */
  poolPageInfo: GPUBuffer
  /** The raster marks: a word per pool page in each of `VSM_DIRTY_SLICES` slices, slice by slice. */
  rasterMarks: GPUBuffer
  /** The next-map data, indexed by the previous frame's id. */
  nextMaps: GPUBuffer
  /** Slice 0 dynamic, 1 static. */
  pagePool: GPUBuffer[]
  /** The occlusion culling's pyramid and build buffers, where the layout asks them
   *  (`occlusion/occlusionResources.ts`). */
  occlusion?: VsmOcclusionResources
  /** Each frame set's kept tables, `kept[k]` with `frames[k]`, where the layout asks the occlusion. */
  kept?: [VsmKeptTables, VsmKeptTables]
  /** The `VSM_COUNTERS` counters, then the overflow flags word. */
  stats: GPUBuffer
  /** The feedback status: [message id, free pages, pressure bias bits]. */
  feedback: GPUBuffer
  /** The per-page dispatcher ids, sorted by bin. */
  perPageIds: GPUBuffer
  /** 2·poolPages + 1 words per list. */
  pagesToClear: GPUBuffer
  /** Indirect dispatch args: 1D, in the clears' (16, pages, 1) form. */
  clearArgs: GPUBuffer
  /** Whether the cache data is available: prev buffers hold a frame extracted with caching on
   *  (`keepVsmFrame`). */
  prevFrameKept: boolean
  /** The prefiltered distant shadow's buffers, where the layout asks them. */
  filterable?: VsmFilterable
  /** Extraction point: the frame just rendered becomes `prev`. */
  swapFrames(): void
  /** The set's buffers and textures, to free: those its tables take (`growVsmTables`), and the
   *  rest. */
  made: { tables: VsmMade[]; rest: VsmMade[] }
  /** What the passes made for this set and hold while it lives, each freed by its own release
   *  with the set (`destroyEngineVsm`): the projection's view uniform and blue noise
   *  (`releaseVsmProjection`), the raster's context (`releaseVsmRender`), the page management's
   *  (`releaseVsmPageManagement`), the shadow changes' stale (`releaseVsmInvalidation`), the
   *  occlusion pyramid's build (`releaseVsmOcclusion`), the compute throttle's buffers. */
  projection?: VsmProjectionState
  render?: VsmRenderContext
  pageManagement?: VsmPageManagementContext
  occlusionPass?: VsmOcclusionContext
  invalidation?: VsmCastState
  /** The compute throttle's buffers, made on the first throttled frame (`throttle.ts`,
   *  `releaseVsmThrottle`). */
  throttle?: VsmThrottleState
  destroy(): void
  bytes: number
}

/**
 * The WGSL function `name` giving the word of pool texel t = (x, y) in its slice: page by page.
 * Page (px, py) fills the words [k·P², (k+1)·P²), k = (py << R) | px, P the page side and R =
 * `poolRowShift` = log2(pages a row), passed as `rowShift`, its WGSL expression (a literal
 * of the layout, or the uniform where a module is built without one); the page's texels row by
 * row inside. Two texels one row apart in a page are one page row of words apart (512 bytes),
 * where a slice laid row by row put them a whole pool row apart (64 KiB at 128 pages a row).
 * A buffer has no driver tiling; it is laid out as this says.
 */
function vsmPoolTexelIndexWgsl(name: string, rowShift: string) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1
  return wgslBlock(
    `vsmPoolTexelIndexWgsl(${name}, ${rowShift})`,
    [],
    `fn ${name}(t:vec2u)->u32{return ((((t.y>>${L}u)<<${rowShift})|(t.x>>${L}u))<<${2 * L}u)|((t.y&${M}u)<<${L}u)|(t.x&${M}u);}`,
  )
}

const S = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC

/** What a set makes: buffers, and the occlusion's textures. */
type VsmMade = GPUBuffer | GPUTexture

/** Makes `size` bytes labelled `vsm.<label>`, into `into`. */
const makeBuffer = (
  device: GPUDevice,
  into: VsmMade[],
  label: string,
  size: number,
  usage = S(),
) => {
  const b = device.createBuffer({ label: `vsm.${label}`, size: bufferBytes(size), usage })
  into.push(b)
  return b
}

/** Both frames' buffers and those sized by the maps, of `layout`, made into `made`, and with the
 *  occlusion both frame sets' kept tables. */
function createVsmTables(device: GPUDevice, layout: VsmLayout, made: VsmMade[]) {
  const buffer = (label: string, size: number, usage?: GPUBufferUsageFlags) =>
    makeBuffer(device, made, label, size, usage)
  const frameSizes = frameBufferSizes(layout)
  // Frame `k`'s buffers; the second frame takes the first's shared members, made once. The
  // uniforms are a copy source, as every member a table growth carries (`growVsmTables`).
  const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const frame = (k: number, first?: VsmFrameBuffers) => {
    const buffers = {} as VsmFrameBuffers
    for (const [member, size] of Object.entries(frameSizes) as [keyof VsmFrameBuffers, number][]) {
      const shared = SHARED_FRAME_MEMBERS.has(member)
      buffers[member] =
        first && shared
          ? first[member]
          : member === 'uniforms'
            ? buffer(`${member}${k}`, size, uniform)
            : buffer(shared ? member : `${member}${k}`, size)
    }
    return buffers
  }
  const first = frame(0)
  const frames: [VsmFrameBuffers, VsmFrameBuffers] = [first, frame(1, first)]
  const sizes = tableBufferSizes(layout)
  const textures: GPUTexture[] = []
  const kept = layout.occlusion ? createKeptTables(device, layout, textures) : undefined
  made.push(...textures)
  return {
    frames,
    nextMaps: buffer('nextMaps', sizes.nextMaps),
    perPageIds: buffer('perPageIds', sizes.perPageIds),
    kept,
    history: layout.prefilteredDistant ? filterableHistory(device, layout, buffer) : undefined,
  }
}

/** The history of the prefiltered distant shadow of `layout`, its header written: the regions' words
 *  and no blend, the history not valid yet. */
function filterableHistory(
  device: GPUDevice,
  layout: VsmLayout,
  buffer: (label: string, size: number) => GPUBuffer,
) {
  const history = buffer('filterableHistory', filterableHistoryBytes(layout))
  device.queue.writeBuffer(history, 0, vsmHistoryHeader(vsmHistoryLayout(layout), 0))
  return history
}

/** The prefiltered distant shadow's buffers of `layout`, around the `history` the tables made. */
function createFilterable(
  device: GPUDevice,
  layout: VsmLayout,
  history: GPUBuffer,
  buffer: (label: string, size: number, usage?: GPUBufferUsageFlags) => GPUBuffer,
): VsmFilterable {
  const sizes = filterableBufferSizes(layout)
  // The empty form of the arguments, copied over them each frame.
  const copy = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  const argsInit = buffer('filterableArgsInit', sizes.argsInit, copy)
  device.queue.writeBuffer(argsInit, 0, new Uint32Array(VSM_FILTER_ARGS_INIT))
  return {
    separate: [
      buffer('filterableSeparate0', sizes.separate),
      buffer('filterableSeparate1', sizes.separate),
    ],
    merged: buffer('filterableMerged', sizes.merged),
    args: buffer('filterableArgs', sizes.args, GPUBufferUsage.INDIRECT | S()),
    argsInit,
    pages: buffer('filterablePages', sizes.pages),
    history,
    historyValid: false,
    active: false,
  }
}

export function createVsmResources(device: GPUDevice, options: VsmResourceOptions): VsmResources {
  const layout = vsmLayout(options)
  const tableBuffers: VsmMade[] = [],
    rest: VsmMade[] = []
  const buffer = (label: string, size: number, usage?: GPUBufferUsageFlags) =>
    makeBuffer(device, rest, label, size, usage)
  const { frames, nextMaps, perPageIds, kept, history } = createVsmTables(
    device,
    layout,
    tableBuffers,
  )

  const pagePool = Array.from({ length: VSM_POOL_SLICES }, (_, s) =>
    buffer(`physicalPool${s}`, poolSliceBytes(layout)),
  )

  const indirect = GPUBufferUsage.INDIRECT | S()
  const once = setBufferSizes(layout)
  const res: VsmResources = {
    layout,
    frames,
    current: frames[0],
    prev: frames[1],
    poolPageInfo: buffer('poolPageInfo', once.poolPageInfo),
    rasterMarks: buffer('rasterMarks', once.rasterMarks),
    nextMaps,
    pagePool,
    occlusion: layout.occlusion ? createOcclusion(device, layout, buffer, rest) : undefined,
    kept,
    stats: buffer('stats', once.stats),
    feedback: buffer('feedback', once.feedback),
    perPageIds,
    pagesToClear: buffer('pagesToClear', once.pagesToClear),
    clearArgs: buffer('clearArgs', once.clearArgs, indirect),
    prevFrameKept: false,
    filterable: history && createFilterable(device, layout, history, buffer),
    swapFrames() {
      const c = res.current
      res.current = res.prev
      res.prev = c
    },
    made: { tables: tableBuffers, rest },
    destroy() {
      for (const b of [...res.made.tables, ...res.made.rest]) b.destroy()
    },
    bytes: madeBytesOf(tableBuffers) + madeBytesOf(rest),
  }
  return res
}

/** The index, 0 or 1, of the frame set `res` is in: `current` is `frames[parity]`. What a frame writes
 *  beside the set (`throttle.ts`) takes its turns by it. */
export const vsmFrameParity = (res: Pick<VsmResources, 'current' | 'frames'>): 0 | 1 =>
  res.current === res.frames[0] ? 0 : 1

/** The members a frame reads as the previous one's, none shared: what a table growth carries. */
const CARRIED_MEMBERS = [
  'uniforms',
  'pageMarks',
  'pageRequests',
  'mappedRects',
  'projectionData',
  'freePages',
] as const

/**
 * The tables of `res` grown in place to `options` — more table blocks, the receiver cover of more
 * suns, more map slots —, the pool and every buffer it sizes kept: the same pages, and their cache. The previous
 * frame's members are copied whole into the new ones' prefix: a map's record and the rows its
 * table origin names stay where they were, as the page table's width is fixed, and
 * the pass that reads the previous frame's levels reads them by that frame's own uniforms, carried
 * too (`VSM_INVALIDATION_SPECS`). The shared members, cleared before each read, and the buffers
 * the plan writes every frame are not carried. Only the old tables are freed. `undefined`, and
 * nothing made, when `options` asks no more than `res` holds. A refused buffer leaves `res` as it
 * was (the caller's `constructGpuResources` frees what was made).
 */
export function growVsmTables(
  device: GPUDevice,
  res: VsmResources,
  options: VsmResourceOptions,
): VsmLayout | undefined {
  const held = res.layout
  const layout = vsmLayout({ ...options, poolPages: held.poolPages })
  if (
    layout.fullMapCapacity <= held.fullMapCapacity &&
    layout.coverWords <= held.coverWords &&
    layout.mapSlots <= held.mapSlots
  )
    return undefined
  const { made } = res
  const tableBuffers: VsmMade[] = []
  const tables = createVsmTables(device, layout, tableBuffers)
  pendingMade(device, tableBuffers, madeBytesOf(tableBuffers), () => {
    const parity = vsmFrameParity(res)
    const prev = tables.frames[1 - parity]
    const encoder = device.createCommandEncoder({ label: 'vsm.growTables' })
    for (const member of CARRIED_MEMBERS) {
      encoder.copyBufferToBuffer(res.prev[member], 0, prev[member], 0, res.prev[member].size)
      // An upload that sends only what changed (`writeChanged`) knows what the copy holds.
      writeChangedCopy(res.prev[member], prev[member])
    }
    // The previous frame's kept tables too: the occlusion's first cull reads them.
    if (res.kept && tables.kept)
      encodeKeptCarry(encoder, res.kept[1 - parity], tables.kept[1 - parity])
    device.queue.submit([encoder.finish()])
    const held = made.tables
    made.tables = tableBuffers
    res.layout = layout
    res.frames = tables.frames
    res.current = tables.frames[parity]
    res.prev = prev
    res.nextMaps = tables.nextMaps
    res.perPageIds = tables.perPageIds
    res.kept = tables.kept
    // The history is laid by the new tables: it holds no frame yet.
    if (res.filterable && tables.history) {
      res.filterable.history = tables.history
      res.filterable.historyValid = false
    }
    res.bytes = madeBytesOf(tableBuffers) + madeBytesOf(made.rest)
    return held
  }).commit()
  return layout
}

// ---- Binding builder ------------------------------------------------------------------------

/** 'atomic' declares array<atomic<...>> (atomic or / min / max / add users). */
type VsmAccess = 'read' | 'read_write' | 'atomic'

type VsmBindingResource =
  | 'uniforms'
  | 'pageTable'
  | 'pageMarks'
  | 'receiverCover'
  | 'pageRequests'
  | 'staleRects'
  | 'mappedRects'
  | 'projectionData'
  | 'freePages'
  | 'poolPageInfo'
  | 'rasterMarks'
  | 'nextMaps'
  | 'pagePool'
  | 'stats'
  | 'feedback'
  | 'perPageIds'
  | 'pagesToClear'
  | 'clearArgs'
  | FilterableResource

export interface VsmBindingSpec {
  resource: VsmBindingResource
  /** First binding number; the pool takes `slices` consecutive numbers. */
  binding: number
  /** The pool: the slices bound, from the first (`VSM_POOL_SLICES` unless given). */
  slices?: number
  access?: VsmAccess
  /** Previous-frame buffer of a double-buffered resource (`filterableSeparate`: the other of the two). */
  prev?: boolean
  /** WGSL variable name; default `vsm<Resource>` (`vsmPrev<Resource>` for prev), uniforms `vsm`/`vsmPrev`. */
  name?: string
}

/** The prefiltered distant shadow's buffer each binding resource names (`VsmFilterable`): the
 *  separable pool the frame's parity writes, or with `prev` the other. */
type FilterableBuffer = (res: VsmResources, f: VsmFilterable, prev?: boolean) => GPUBuffer
const FILTERABLE_BUFFERS = {
  filterableSeparate: (res, f, prev) => f.separate[vsmFrameParity(res) ^ (prev ? 1 : 0)],
  filterableMerged: (_, f) => f.merged,
  filterableArgs: (_, f) => f.args,
  filterablePages: (_, f) => f.pages,
  filterableHistory: (_, f) => f.history,
} satisfies Record<string, FilterableBuffer>
type FilterableResource = keyof typeof FILTERABLE_BUFFERS
const FILTERABLE_RESOURCES = new Set<VsmBindingResource>(
  Object.keys(FILTERABLE_BUFFERS) as FilterableResource[],
)

const FRAME_RESOURCES = new Set<VsmBindingResource>([
  'uniforms',
  'pageTable',
  'pageMarks',
  'receiverCover',
  'pageRequests',
  'staleRects',
  'mappedRects',
  'projectionData',
  'freePages',
])

/** Resources read through `<name>Load(index)` (2D tables and flat u32 arrays). */
const U32_TABLES = new Set<VsmBindingResource>([
  'pageTable',
  'pageMarks',
  'receiverCover',
  'pageRequests',
  'rasterMarks',
  'stats',
  'feedback',
  'perPageIds',
  'pagesToClear',
  'clearArgs',
  ...FILTERABLE_RESOURCES,
])

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function varName(spec: VsmBindingSpec) {
  if (spec.name) return spec.name
  if (spec.resource === 'uniforms') return spec.prev ? 'vsmPrev' : 'vsm'
  if (spec.resource === 'pagePool') return 'vsmPool'
  return (spec.prev ? 'vsmPrev' : 'vsm') + cap(spec.resource)
}

function elementType(resource: VsmBindingResource, atomic: boolean) {
  switch (resource) {
    case 'staleRects':
    case 'mappedRects':
      // Atomic users address .x/.y/.z/.w as 4·rect + component (atomic min / max).
      return atomic ? 'atomic<u32>' : 'vec4u'
    case 'projectionData':
      return 'VsmProjectionRecord'
    case 'poolPageInfo':
      return 'VsmPoolPageInfo'
    case 'nextMaps':
      return 'VsmNextMap'
    default:
      return atomic ? 'atomic<u32>' : 'u32'
  }
}

/** The fragment declaring the struct a resource's elements are (`elementType`). */
const STRUCT_OF: Partial<Record<VsmBindingResource, WgslDecl>> = {
  projectionData: VSM_PROJECTION_DATA_WGSL,
  poolPageInfo: VSM_STRUCTS_WGSL,
  nextMaps: VSM_STRUCTS_WGSL,
}

/**
 * WGSL declarations (and loaders) for `specs` in `group`. Emits, per u32 table named N:
 * `fn NLoad(i:u32)->u32`, plus `NStore(i,v)` when writable and `NOr(i,v)->u32` when atomic.
 * The pool emits `vsmPoolLoad(texel:vec2u,slice:u32)->u32`, and when writable `vsmPoolStore`,
 * and when atomic `vsmPoolAtomicMax(texel,slice,value)` (the raster's atomic max: a value no
 * greater than the word already held writes nothing, the word being the same).
 * The block lists the structs its bindings name (`VSM_UNIFORMS_WGSL`, `VSM_PROJECTION_DATA_WGSL`,
 * `VSM_STRUCTS_WGSL`). The pool's load is a declaration of its own (`vsmPoolLoadOf`), which the
 * projection sample lists (`vsmProjectionSampleWgsl`).
 */
export function vsmBindingsWgsl(
  group: number,
  specs: readonly VsmBindingSpec[],
  layout: VsmLayout,
) {
  const out: string[] = []
  const deps = new Set<WgslDecl>()
  for (const spec of specs) {
    // Both frames hold one buffer of a shared member: its previous frame's content is gone.
    if (spec.prev && SHARED_FRAME_MEMBERS.has(spec.resource))
      throw new Error(`VSM: ${spec.resource} keeps no previous frame`)
    const access = spec.access ?? 'read'
    const atomic = access === 'atomic'
    const space = access === 'read' ? 'storage,read' : 'storage,read_write'
    const name = varName(spec)
    if (spec.resource === 'uniforms') {
      deps.add(VSM_UNIFORMS_WGSL)
      out.push(`@group(${group}) @binding(${spec.binding}) var<uniform> ${name}:VsmUniforms;`)
      continue
    }
    if (spec.resource === 'pagePool') {
      deps.add(vsmPoolWgsl(group, spec, layout).accessors)
      continue
    }
    const struct = STRUCT_OF[spec.resource]
    if (struct) deps.add(struct)
    out.push(
      `@group(${group}) @binding(${spec.binding}) var<${space}> ${name}:array<${elementType(spec.resource, atomic)}>;`,
    )
    if (U32_TABLES.has(spec.resource)) {
      out.push(
        atomic
          ? `fn ${name}Load(i:u32)->u32{return atomicLoad(&${name}[i]);}\nfn ${name}Store(i:u32,v:u32){atomicStore(&${name}[i],v);}\nfn ${name}Or(i:u32,v:u32)->u32{return atomicOr(&${name}[i],v);}`
          : access === 'read_write'
            ? `fn ${name}Load(i:u32)->u32{return ${name}[i];}\nfn ${name}Store(i:u32,v:u32){${name}[i]=v;}`
            : `fn ${name}Load(i:u32)->u32{return ${name}[i];}`,
      )
    }
  }
  return wgslBlock(
    `vsmBindingsWgsl(${group}, ${JSON.stringify(specs)}, ${layoutKey(layout)})`,
    [...deps],
    out.join('\n'),
  )
}

/** Whether `device` takes a ninth storage buffer a shader stage: the page management's counters
 *  (`vsmCountersOn`) and the software raster's projection data (`vsmViewsLaid`) are bound where it does. */
export const vsmNinthStorage = (device: Pick<GPUDevice, 'limits'>) =>
  device.limits.maxStorageBuffersPerShaderStage >= 9

/** The layout's number a module's text reads: the pool's row shift. */
const layoutKey = (layout: VsmLayout) => `${layout.poolRowShift}`

/**
 * The layout a reader outside the VSM passes (the translucent layers) is compiled for, before any
 * pool is granted: the pool's row shift is every pool's, whatever its pages, so its text is every
 * granted pool's too. Such a reader binds the slice it reads in one binding, as its layout
 * declares it.
 */
export const VSM_FORWARD_LAYOUT = vsmLayout({ fullMapCapacity: 0, coverMode: 'none' })

/** The slices a pool spec binds. */
const slicesOf = (spec: VsmBindingSpec) => spec.slices ?? VSM_POOL_SLICES

/** The pool's `<name>Load` of `specs`' page pool in `group` (`vsmBindingsWgsl`): what a fragment
 *  that reads the pool lists. */
export function vsmPoolLoadOf(group: number, specs: readonly VsmBindingSpec[], layout: VsmLayout) {
  const spec = specs.find((s) => s.resource === 'pagePool')
  if (!spec) throw new Error('VSM: no page pool among the bindings')
  return vsmPoolWgsl(group, spec, layout).load
}

/** Each pool's declarations, built once per binding, access, slices and layout numbers: the
 *  bindings and `vsmPoolLoadOf` share them. */
const pools = new Map<string, { load: WgslDecl; accessors: WgslDecl }>()

function vsmPoolWgsl(group: number, spec: VsmBindingSpec, layout: VsmLayout) {
  const access = spec.access ?? 'read',
    name = varName(spec),
    slices = slicesOf(spec)
  const key = `${name}(${group}, ${spec.binding}, ${access}, ${slices}, ${layoutKey(layout)})`
  let pool = pools.get(key)
  if (!pool)
    pools.set(key, (pool = buildPool(key, group, spec.binding, access, slices, layout, name)))
  return pool
}

/**
 * The pool's accessors over `slices` slices, one buffer each, from binding `first`: a texel's word
 * (`vsmPoolTexelIndexWgsl`) read in the buffer of its slice, the switch choosing the slice alone.
 */
function buildPool(
  key: string,
  group: number,
  first: number,
  access: VsmAccess,
  slices: number,
  layout: VsmLayout,
  name: string,
) {
  const atomic = access === 'atomic'
  const space = access === 'read' ? 'storage,read' : 'storage,read_write'
  const vars = Array.from({ length: slices }, (_, s) => `${name}${s}`)
  const lines = vars.map(
    (v, s) =>
      `@group(${group}) @binding(${first + s}) var<${space}> ${v}:array<${atomic ? 'atomic<u32>' : 'u32'}>;`,
  )
  // One accessor: the texel's word, \`body\` on its slice's array at \`i\`.
  const select = ` let i=${name}TexelIndex(t);\n switch(slice){`
  const accessor = (signature: string, body: (v: string) => string, otherwise: string) =>
    `fn ${name}${signature}{\n${select}\n${vars
      .map((v, k) => ` case ${k}u:{${body(v)}}`)
      .join('\n')}\n default:{${otherwise}}\n }\n}`
  // Texture2DArray texel (x, y, slice): its word in the slice, page by page.
  const load = wgslFn(
    `${name}Load`,
    [
      wgslBlock(`${key} bindings`, [], lines.join('\n')),
      vsmPoolTexelIndexWgsl(`${name}TexelIndex`, `${layout.poolRowShift}u`),
    ],
    accessor(
      'Load(t:vec2u,slice:u32)->u32',
      (v) => (atomic ? `return atomicLoad(&${v}[i]);` : `return ${v}[i];`),
      'return 0u;',
    ),
  )
  const rest: string[] = []
  if (access !== 'read')
    rest.push(
      accessor(
        'Store(t:vec2u,slice:u32,value:u32)',
        (v) => (atomic ? `atomicStore(&${v}[i],value);` : `${v}[i]=value;`),
        '',
      ),
    )
  if (atomic)
    rest.push(
      accessor(
        'AtomicMax(t:vec2u,slice:u32,value:u32)',
        // A word only grows: one already at least \`value\` stays as the max would leave it.
        (v) => `if(atomicLoad(&${v}[i])<value){atomicMax(&${v}[i],value);}`,
        '',
      ),
    )
  return { load, accessors: wgslBlock(`${key} accessors`, [load], rest.join('\n')) }
}

/** Number of binding slots a spec consumes. */
const vsmBindingCount = (spec: VsmBindingSpec) =>
  spec.resource === 'pagePool' ? slicesOf(spec) : 1

/** Bind group layout entries matching `vsmBindingsWgsl`. */
export function vsmBindGroupLayoutEntries(
  specs: readonly VsmBindingSpec[],
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  const out: GPUBindGroupLayoutEntry[] = []
  for (const spec of specs) {
    const type: GPUBufferBindingType =
      spec.resource === 'uniforms'
        ? 'uniform'
        : (spec.access ?? 'read') === 'read'
          ? 'read-only-storage'
          : 'storage'
    for (let k = 0; k < vsmBindingCount(spec); k++)
      out.push({ binding: spec.binding + k, visibility, buffer: { type } })
  }
  return out
}

/** Bind group entries matching `vsmBindingsWgsl`, using `res.current` / `res.prev` at call time. */
export function vsmBindGroupEntries(
  res: VsmResources,
  specs: readonly VsmBindingSpec[],
): GPUBindGroupEntry[] {
  const out: GPUBindGroupEntry[] = []
  for (const spec of specs) {
    if (spec.resource === 'pagePool') {
      res.pagePool
        .slice(0, slicesOf(spec))
        .forEach((buffer, k) => out.push({ binding: spec.binding + k, resource: { buffer } }))
      continue
    }
    const buffer = FRAME_RESOURCES.has(spec.resource)
      ? (spec.prev ? res.prev : res.current)[spec.resource as keyof VsmFrameBuffers]
      : FILTERABLE_RESOURCES.has(spec.resource)
        ? filterableBuffer(res, spec as VsmBindingSpec & { resource: FilterableResource })
        : (res[spec.resource as keyof VsmResources] as GPUBuffer)
    out.push({ binding: spec.binding, resource: { buffer } })
  }
  return out
}

/** The prefiltered distant shadow's buffer a spec names. */
function filterableBuffer(
  res: VsmResources,
  spec: VsmBindingSpec & { resource: FilterableResource },
) {
  if (!res.filterable)
    throw new Error(`VSM: ${spec.resource} bound by a set without the prefiltered distant shadow`)
  const bufferOf: FilterableBuffer = FILTERABLE_BUFFERS[spec.resource]
  return bufferOf(res, res.filterable, spec.prev)
}

/** What a family builds over the tables of a frame set (`vsmPerFrameSet`): the identity of what
 *  it named — the set, and what else its groups bind —, of depth two, the two sets taking turns,
 *  and what was made at each of its slots. */
export interface VsmPerFrameSet<T> {
  identity: WebgpuBindIdentity
  slots: T[]
}

/** A family's holder of what it builds over the frame sets (`vsmPerFrameSet`). */
export const vsmFrameSetHeld = <T>(): VsmPerFrameSet<T> => ({
  identity: createWebgpuBindIdentity(2),
  slots: [],
})

/** What `make(res, arg)` builds over the tables of the frame set `res.current` and over `also`
 *  — what else its groups bind —, kept in `held` (`createWebgpuBindIdentity`): made again only when
 *  one of them moved, the two sets in turn each held; a set made again (`growVsmTables`), or
 *  another `also`, makes its own. `make` and `arg` are the caller's own, so that a frame allocates
 *  nothing to ask. */
export function vsmPerFrameSet<T, A>(
  held: VsmPerFrameSet<T>,
  res: VsmResources,
  make: (res: VsmResources, arg: A) => T,
  arg: A,
  also?: unknown,
) {
  const { identity, slots } = held
  identity.next[0] = res.current
  identity.next[1] = also
  if (identity.moved()) slots[identity.slot] = make(res, arg)
  return slots[identity.slot]
}
