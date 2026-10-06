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
 * physical pool (R32 texel array, 2 slices) is one buffer per slice, its texels page by page
 * (`vsmPoolTexelIndexWgsl`), split into parts of whole page rows when a slice exceeds
 * `device.limits.maxStorageBufferBindingSize`.
 */
import { VSM_LOG2_PAGE, VSM_PAGE_TEXELS, VSM_POOL_SLICES } from './constants.ts'
import { vsmWriteChangedCopy } from './writeChanged.ts'
import {
  bufferBytes,
  frameBufferSizes,
  poolPartSizes,
  setBufferSizes,
  SHARED_FRAME_MEMBERS,
  tableBufferSizes,
  vsmLayout,
  type VsmLayout,
  type VsmResourceOptions,
} from './layout.ts'

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
  poolLists: GPUBuffer
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
  /** [slice][part], slice 0 dynamic, 1 static. */
  pagePool: GPUBuffer[][]
  /** Per physical page, the closest depth (the greatest word, read as a float) of each of its
   *  8×8-texel tiles of slice 0 (`VSM_LOG2_TILE_DEPTH_TEXELS`), rebuilt where a page changed
   *  (`vsmTileDepthsBuild`): what the sun's rays prove they miss against
   *  (`vsmSunRayMisses`). Made with the pool, both zero: a page never written holds 0. */
  tileDepths: GPUBuffer
  /** The `VSM_COUNTERS` counters. */
  stats: GPUBuffer
  /** The feedback status: [message id, free pages, pressure bias bits, scene frame]. */
  feedback: GPUBuffer
  /** The per-page dispatcher ids, sorted by bin. */
  perPageIds: GPUBuffer
  /** 2·poolPages + 1 words per list. */
  pagesToClear: GPUBuffer
  pagesToMerge: GPUBuffer
  pagesForTiles: GPUBuffer
  /** Indirect dispatch args: 1D, post-process 2×(x,y,z,count), tile depths 2×4. */
  clearArgs: GPUBuffer
  mergeArgs: GPUBuffer
  tileArgs: GPUBuffer
  /** Whether the cache data is available: prev buffers hold a frame extracted with caching on
   *  (`keepVsmFrame`). */
  prevFrameKept: boolean
  /** Extraction point: the frame just rendered becomes `prev`. */
  swapFrames(): void
  destroy(): void
  bytes: number
}

/**
 * The WGSL function `name` giving the word of pool texel t = (x, y) in its slice: page by page.
 * Page (px, py) fills the words [k·P², (k+1)·P²), k = (py << R) | px, P the page side and R =
 * `poolRowShift` = log2(pages a row), passed as `rowShift`, its WGSL expression (a literal
 * of the layout, or the uniform where a module is built without one); the page's texels row by
 * row inside. Two texels one row apart in a page are one page row of words apart (512 bytes),
 * where a slice laid row by row put them a whole pool row apart (64 KiB at 128 pages a row). Page
 * rows stay whole and in order: a binding part (`poolPartTexelShift`) holds the pages it held.
 * A buffer has no driver tiling; it is laid out as this says.
 */
export function vsmPoolTexelIndexWgsl(name: string, rowShift: string) {
  const L = VSM_LOG2_PAGE,
    M = VSM_PAGE_TEXELS - 1
  return `fn ${name}(t:vec2u)->u32{return ((((t.y>>${L}u)<<${rowShift})|(t.x>>${L}u))<<${2 * L}u)|((t.y&${M}u)<<${L}u)|(t.x&${M}u);}`
}

const S = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC

/** A set's buffers, to free: those its tables take (`growVsmTables`), and the rest. */
const madeBuffers = new WeakMap<VsmResources, { tables: GPUBuffer[]; rest: GPUBuffer[] }>()

/** Makes `size` bytes labelled `vsm.<label>`, into `into`. */
const makeBuffer = (
  device: GPUDevice,
  into: GPUBuffer[],
  label: string,
  size: number,
  usage = S(),
) => {
  const b = device.createBuffer({ label: `vsm.${label}`, size: bufferBytes(size), usage })
  into.push(b)
  return b
}

/** Both frames' buffers and those sized by the maps, of `layout`, made into `made`. */
function createVsmTables(device: GPUDevice, layout: VsmLayout, made: GPUBuffer[]) {
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
  return {
    frames,
    nextMaps: buffer('nextMaps', sizes.nextMaps),
    perPageIds: buffer('perPageIds', sizes.perPageIds),
  }
}

const bytesOf = (buffers: readonly GPUBuffer[]) => buffers.reduce((n, b) => n + b.size, 0)

export function createVsmResources(device: GPUDevice, options: VsmResourceOptions): VsmResources {
  const layout = vsmLayout(options, device.limits.maxStorageBufferBindingSize)
  const tableBuffers: GPUBuffer[] = [],
    rest: GPUBuffer[] = []
  const buffer = (label: string, size: number, usage?: GPUBufferUsageFlags) =>
    makeBuffer(device, rest, label, size, usage)
  const { frames, nextMaps, perPageIds } = createVsmTables(device, layout, tableBuffers)

  const parts = poolPartSizes(layout)
  const pagePool = Array.from({ length: VSM_POOL_SLICES }, (_, s) =>
    parts.map((size, p) => buffer(`physicalPool${s}.${p}`, size)),
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
    stats: buffer('stats', once.stats),
    feedback: buffer('feedback', once.feedback),
    perPageIds,
    pagesToClear: buffer('pagesToClear', once.pagesToClear),
    pagesToMerge: buffer('pagesToMerge', once.pagesToMerge),
    pagesForTiles: buffer('pagesForTiles', once.pagesForTiles),
    tileDepths: buffer('tileDepths', once.tileDepths),
    clearArgs: buffer('clearArgs', once.clearArgs, indirect),
    mergeArgs: buffer('mergeArgs', once.mergeArgs, indirect),
    tileArgs: buffer('tileArgs', once.tileArgs, indirect),
    prevFrameKept: false,
    swapFrames() {
      const c = res.current
      res.current = res.prev
      res.prev = c
    },
    destroy() {
      const made = madeBuffers.get(res)!
      for (const b of [...made.tables, ...made.rest]) b.destroy()
    },
    bytes: bytesOf(tableBuffers) + bytesOf(rest),
  }
  madeBuffers.set(res, { tables: tableBuffers, rest })
  return res
}

/** The members a frame reads as the previous one's, none shared: what a table growth carries. */
const CARRIED_MEMBERS = [
  'uniforms',
  'pageMarks',
  'pageRequests',
  'mappedRects',
  'projectionData',
  'poolLists',
] as const

/**
 * The tables of `res` grown in place to `options` — more full maps, the receiver cover of more
 * suns —, the pool and every buffer it sizes kept: the same pages, and their cache. The previous
 * frame's members are copied whole into the new ones' prefix: a full map's id (from
 * `VSM_SINGLE_PAGE_MAP_SLOTS` up) keeps its rows, as the page table's width is fixed, and
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
  const layout = vsmLayout(
    { ...options, poolPages: held.poolPages },
    device.limits.maxStorageBufferBindingSize,
  )
  if (layout.fullMapCapacity <= held.fullMapCapacity && layout.coverWords <= held.coverWords)
    return undefined
  const made = madeBuffers.get(res)!
  const tableBuffers: GPUBuffer[] = []
  const tables = createVsmTables(device, layout, tableBuffers)
  const parity = res.current === res.frames[0] ? 0 : 1
  const prev = tables.frames[1 - parity]
  const encoder = device.createCommandEncoder({ label: 'vsm.growTables' })
  for (const member of CARRIED_MEMBERS) {
    encoder.copyBufferToBuffer(res.prev[member], 0, prev[member], 0, res.prev[member].size)
    // An upload that sends only what changed (`vsmWriteChanged`) knows what the copy holds.
    vsmWriteChangedCopy(res.prev[member], prev[member])
  }
  device.queue.submit([encoder.finish()])
  for (const b of made.tables) b.destroy()
  made.tables = tableBuffers
  res.layout = layout
  res.frames = tables.frames
  res.current = tables.frames[parity]
  res.prev = prev
  res.nextMaps = tables.nextMaps
  res.perPageIds = tables.perPageIds
  res.bytes = bytesOf(tableBuffers) + bytesOf(made.rest)
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
  | 'poolLists'
  | 'poolPageInfo'
  | 'rasterMarks'
  | 'nextMaps'
  | 'pagePool'
  | 'stats'
  | 'feedback'
  | 'perPageIds'
  | 'pagesToClear'
  | 'pagesToMerge'
  | 'pagesForTiles'
  | 'tileDepths'
  | 'clearArgs'
  | 'mergeArgs'
  | 'tileArgs'

export interface VsmBindingSpec {
  resource: VsmBindingResource
  /** First binding number; the pool takes `slices · parts` consecutive numbers. */
  binding: number
  access?: VsmAccess
  /** Previous-frame buffer of a double-buffered resource. */
  prev?: boolean
  /** WGSL variable name; default `vsm<Resource>` (`vsmPrev<Resource>` for prev), uniforms `vsm`/`vsmPrev`. */
  name?: string
}

const FRAME_RESOURCES = new Set<VsmBindingResource>([
  'uniforms',
  'pageTable',
  'pageMarks',
  'receiverCover',
  'pageRequests',
  'staleRects',
  'mappedRects',
  'projectionData',
  'poolLists',
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
  'pagesToMerge',
  'pagesForTiles',
  'tileDepths',
  'clearArgs',
  'mergeArgs',
  'tileArgs',
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
    case 'poolLists':
      return atomic ? 'atomic<i32>' : 'i32'
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

/**
 * WGSL declarations (and loaders) for `specs` in `group`. Emits, per u32 table named N:
 * `fn NLoad(i:u32)->u32`, plus `NStore(i,v)` when writable and `NOr(i,v)->u32` when atomic.
 * The pool emits `vsmPoolLoad(texel:vec2u,slice:u32)->u32`, and when writable `vsmPoolStore`,
 * and when atomic `vsmPoolAtomicMax(texel,slice,value)` (the raster's atomic max: a value no
 * greater than the word already held writes nothing, the word being the same).
 * Structs used by the declarations come from `VSM_UNIFORMS_WGSL`, `VSM_PROJECTION_DATA_WGSL`,
 * `VSM_STRUCTS_WGSL`, which the caller includes once.
 */
export function vsmBindingsWgsl(
  group: number,
  specs: readonly VsmBindingSpec[],
  layout: VsmLayout,
) {
  const out: string[] = []
  for (const spec of specs) {
    // Both frames hold one buffer of a shared member: its previous frame's content is gone.
    if (spec.prev && SHARED_FRAME_MEMBERS.has(spec.resource))
      throw new Error(`VSM: ${spec.resource} keeps no previous frame`)
    const access = spec.access ?? 'read'
    const atomic = access === 'atomic'
    const space = access === 'read' ? 'storage,read' : 'storage,read_write'
    const name = varName(spec)
    if (spec.resource === 'uniforms') {
      out.push(`@group(${group}) @binding(${spec.binding}) var<uniform> ${name}:VsmUniforms;`)
      continue
    }
    if (spec.resource === 'pagePool') {
      out.push(vsmPoolWgsl(group, spec.binding, access, layout, name))
      continue
    }
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
  return out.join('\n')
}

function vsmPoolWgsl(
  group: number,
  first: number,
  access: VsmAccess,
  layout: VsmLayout,
  name: string,
) {
  const atomic = access === 'atomic'
  const space = access === 'read' ? 'storage,read' : 'storage,read_write'
  const parts = layout.poolPartsPerSlice
  const lines: string[] = []
  const vars: string[] = []
  for (let s = 0; s < VSM_POOL_SLICES; s++)
    for (let p = 0; p < parts; p++) {
      const v = `${name}${s}_${p}`
      vars.push(v)
      lines.push(
        `@group(${group}) @binding(${first + s * parts + p}) var<${space}> ${v}:array<${atomic ? 'atomic<u32>' : 'u32'}>;`,
      )
    }
  const shift = layout.poolPartTexelShift
  const mask = `${(2 ** shift - 1) >>> 0}u`
  // One accessor: the texel's part by slice and word, `body` on that part's array.
  const accessor = (signature: string, body: (v: string) => string, otherwise: string) =>
    `fn ${name}${signature}{\n let l=${name}TexelIndex(t);\n let i=l&${mask};\n switch(slice*${parts}u+(l>>${shift}u)){\n${vars
      .map((v, k) => ` case ${k}u:{${body(v)}}`)
      .join('\n')}\n default:{${otherwise}}\n }\n}`
  // Texture2DArray texel (x, y, slice): its word in the slice, page by page.
  lines.push(vsmPoolTexelIndexWgsl(`${name}TexelIndex`, `${layout.poolRowShift}u`))
  lines.push(
    accessor(
      'Load(t:vec2u,slice:u32)->u32',
      (v) => (atomic ? `return atomicLoad(&${v}[i]);` : `return ${v}[i];`),
      'return 0u;',
    ),
  )
  if (access !== 'read')
    lines.push(
      accessor(
        'Store(t:vec2u,slice:u32,value:u32)',
        (v) => (atomic ? `atomicStore(&${v}[i],value);` : `${v}[i]=value;`),
        '',
      ),
    )
  if (atomic)
    lines.push(
      accessor(
        'AtomicMax(t:vec2u,slice:u32,value:u32)',
        // A word only grows: one already at least \`value\` stays as the max would leave it.
        (v) => `if(atomicLoad(&${v}[i])<value){atomicMax(&${v}[i],value);}`,
        '',
      ),
    )
  return lines.join('\n')
}

/** Number of binding slots a spec consumes. */
function vsmBindingCount(spec: VsmBindingSpec, layout: VsmLayout) {
  return spec.resource === 'pagePool' ? VSM_POOL_SLICES * layout.poolPartsPerSlice : 1
}

/** Bind group layout entries matching `vsmBindingsWgsl`. */
export function vsmBindGroupLayoutEntries(
  specs: readonly VsmBindingSpec[],
  layout: VsmLayout,
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
    for (let k = 0; k < vsmBindingCount(spec, layout); k++)
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
        .flat()
        .forEach((buffer, k) => out.push({ binding: spec.binding + k, resource: { buffer } }))
      continue
    }
    const buffer = FRAME_RESOURCES.has(spec.resource)
      ? (spec.prev ? res.prev : res.current)[spec.resource as keyof VsmFrameBuffers]
      : (res[spec.resource as keyof VsmResources] as GPUBuffer)
    out.push({ binding: spec.binding, resource: { buffer } })
  }
  return out
}

/** What `make(res, arg)` builds over the tables of the frame set `res.current`, made once a set —
 *  the two sets in turn; a set made again (`growVsmTables`) makes its own — and kept in `held`.
 *  `make` and `arg` are the caller's own, so that a frame allocates nothing to ask. */
export function vsmPerFrameSet<T, A>(
  held: WeakMap<VsmFrameBuffers, T>,
  res: VsmResources,
  make: (res: VsmResources, arg: A) => T,
  arg: A,
) {
  let value = held.get(res.current)
  if (value === undefined) held.set(res.current, (value = make(res, arg)))
  return value
}
