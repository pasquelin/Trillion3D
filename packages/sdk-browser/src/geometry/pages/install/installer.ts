import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { chainReady } from '../../../lighting/deferred/fullscreen.ts'
import { uniformStride } from '../../../session/memory/pools.ts'
import { GEOMETRY_PAGE_MAGIC, NO_UNIT } from '../../../../../sdk-core/src/page/format.ts'
import { namedRanks } from './namedRanks.ts'
import {
  PAGE_INSTALL_LEVELS,
  PAGE_JOB_WORDS,
  PAGE_JOBS_HEADER_WORDS,
  PAGE_LINK_WGSL,
  PAGE_TRANSCODE_WGSL,
} from './transcodeWgsl.ts'

/** The bytes of the staging buffer: the pages on disk waiting for their pass. */
const INSTALL_STAGING_BYTES = 4 << 20

/** The pages one batch installs at most: a job table of this many entries. */
const INSTALL_JOBS = 512

/** The words of the table that tells where the streaming pages a streaming page depends on start in
 *  the pool, one list for each streaming page of a batch. */
const INSTALL_DEPENDENCIES = 1 << 16

/** Whether `bytes` open on a `WGP3` geometry page's magic: a page on disk, which the install pass
 *  transcodes into the pool; any other page — a voxel brick, an index page — is written as it is. */
export const isGeometryPage = (bytes: Uint8Array) =>
  bytes.byteLength >= 4 &&
  new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GEOMETRY_PAGE_MAGIC

/** A page to install: its bytes on disk, the byte of the pool it takes and the bytes it may take
 *  there, the byte its streaming page starts at, and `dependencies`, which gives the byte each
 *  streaming page of that streaming page's list of dependencies starts at — `undefined` for one not
 *  resident, whose vertices no page names. The list is the streaming page's, not the page's: it is
 *  asked once for each streaming page of a batch, by its first page. */
type PageInstall = {
  bytes: Uint8Array
  offset: number
  room: number
  unit: number
  dependencies: () => readonly (number | undefined)[]
}

/**
 * THE INSTALL OF A PAGE: its bytes on disk written into the pool, transcoded into the resident
 * page the shaders read (`transcodeWgsl.ts`). `add` stages a page; `flush` runs the passes over
 * every page staged: the first, a workgroup a page, writes every page but the vertices it names;
 * the second, a level of pages a dispatch, copies those from the clusters they name, each level
 * after the pages of the streaming pages its pages name vertices of, as far as they are staged
 * too. A page staged is written at its turn of the queue: what a frame submitted after `flush`
 * reads is the page installed.
 */
export type PageInstaller = {
  add(page: PageInstall): void
  /** Settles once both passes are compiled; rejects when the device refuses one. */
  prepare(): Promise<void>
  /** Runs the passes over the pages staged, if any. */
  flush(): void
  /** Runs the passes if a page staged is to be written at byte `offset`: a page given up there
   *  leaves before the page that takes its place is staged, and one dispatch writes the two in no
   *  order. */
  flushAt(offset: number): void
  /** Releases the staging buffer and the job table; a page staged and not flushed is dropped. */
  dispose(): void
}

/** The list of a streaming page's dependencies in the dependencies table: where it starts, and how
 *  many entries it has. */
type DependencyList = { at: number; count: number }

/** A page staged: where its bytes lie in the staging buffer and in the pool, in words, the streaming
 *  page it lies in, its streaming page's list of dependencies, and — for a page that names vertices
 *  — the start in the pool of each streaming page of that list it names vertices of (none for a
 *  page that names only its own streaming page or itself). `length` is no pass's: the test
 *  kit's replay of the passes slices the staging buffer by it. */
type Staged = {
  src: number
  dst: number
  room: number
  length: number
  unit: number
  list: DependencyList
  needs: readonly number[] | undefined
}

/** The level each page of `pages` installs at: 0 for one that names no vertex, else one past the
 *  greatest level of the streaming pages it names vertices of — a streaming page's level being the
 *  greatest of its pages that name vertices —, so 1 for a page that names no other streaming page.
 *  The clusters a page names are complete once every page of those streaming pages is. */
function installLevels(pages: readonly Staged[]) {
  const named = new Map<number, Set<number>>()
  for (const { unit, needs } of pages) {
    if (!needs) continue
    let set = named.get(unit)
    if (!set) named.set(unit, (set = new Set()))
    for (const start of needs) set.add(start)
  }
  const levels = new Map<number, number>()
  // `path` holds the streaming pages being resolved: one that names itself again is a chain no
  // compiled page makes, cut where it closes.
  const levelOf = (unit: number, path: Set<number>): number => {
    const needs = named.get(unit)
    if (!needs || path.has(unit)) return 0
    let level = levels.get(unit)
    if (level === undefined) {
      path.add(unit)
      level = 1
      for (const start of needs) level = Math.max(level, 1 + levelOf(start, path))
      path.delete(unit)
      levels.set(unit, level)
    }
    return level
  }
  return pages.map((page) => (page.needs ? levelOf(page.unit, new Set()) : 0))
}

const INSTALL_LABEL = 'Trillion3D page install'

/** The bind group layout of both passes and the passes themselves — the transcode and the link —,
 *  asked off the frame at once (`preparedComputeStage`): a refusal of the device is one rejection of
 *  `prepare`, said by name where the pool is granted, never a throw in the load of a page. */
function installStages(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage'),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'read-only-storage'),
      computeUniformEntry(4, { hasDynamicOffset: true, minBindingSize: 4 }),
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stage = (module: GPUShaderModule, entryPoint: string) =>
    preparedComputeStage(
      device,
      pipelineLayout,
      module,
      entryPoint,
      undefined,
      `${INSTALL_LABEL} ${entryPoint}`,
    ).ask()
  const transcode = stage(
    device.createShaderModule({ label: INSTALL_LABEL, code: PAGE_TRANSCODE_WGSL }),
    'transcode',
  )
  const link = stage(
    device.createShaderModule({ label: INSTALL_LABEL, code: PAGE_LINK_WGSL }),
    'link',
  )
  return {
    layout,
    transcode,
    link,
    prepare: async () => void (await Promise.all([transcode.prepare(), link.prepare()])),
  }
}

/** What the installer keeps: its buffers, the batch being staged and the groups it met. */
interface Installer {
  device: GPUDevice
  pool: () => GPUBuffer
  label: string
  layout: GPUBindGroupLayout
  first: ReturnType<typeof installStages>['transcode']
  second: ReturnType<typeof installStages>['link']
  staging: GPUBuffer
  table: GPUBuffer
  dependencies: GPUBuffer
  levels: GPUBuffer
  stride: number
  jobs: Uint32Array<ArrayBuffer>
  depends: Uint32Array<ArrayBuffer>
  batch: Staged[]
  /** The list of dependencies of each streaming page of the batch, by the byte it starts at. */
  lists: Map<number, DependencyList>
  used: number
  dependsUsed: number
  scheduled: boolean
  disposed: boolean
  /** The groups of each pool buffer the installer met: a pool is replaced when it grows. */
  groups: WeakMap<GPUBuffer, GPUBindGroup>
}

/** The buffers of an installer: the pages staged, the jobs, the dependencies, and the level a
 *  dispatch of the second pass installs — one word each at a dynamic offset. */
function installerBuffers(device: GPUDevice, label: string) {
  const staging = device.createBuffer({
    label: `${label} staging`,
    size: INSTALL_STAGING_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const table = device.createBuffer({
    label: `${label} jobs`,
    size: (PAGE_JOBS_HEADER_WORDS + INSTALL_JOBS * PAGE_JOB_WORDS) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const dependencies = device.createBuffer({
    label: `${label} dependencies`,
    size: INSTALL_DEPENDENCIES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const stride = uniformStride(device.limits)
  const levels = device.createBuffer({
    label: `${label} levels`,
    size: PAGE_INSTALL_LEVELS * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const numbers = new Uint32Array((PAGE_INSTALL_LEVELS * stride) / 4)
  for (let level = 0; level < PAGE_INSTALL_LEVELS; level++) numbers[(level * stride) / 4] = level
  device.queue.writeBuffer(levels, 0, numbers)
  return { staging, table, dependencies, levels, stride }
}

/** The group of the installer's buffers over pool buffer `buffer`, made once. */
function groupOver(s: Installer, buffer: GPUBuffer) {
  let group = s.groups.get(buffer)
  if (!group)
    s.groups.set(
      buffer,
      (group = s.device.createBindGroup({
        label: s.label,
        layout: s.layout,
        entries: [
          { binding: 0, resource: { buffer: s.staging } },
          { binding: 1, resource: { buffer: s.table } },
          { binding: 2, resource: { buffer } },
          { binding: 3, resource: { buffer: s.dependencies } },
          { binding: 4, resource: { buffer: s.levels, size: 4 } },
        ],
      })),
    )
  return group
}

/** The jobs of `pages` written by level, the first of each in the header, the end of the last
 *  after it; the offsets where each level starts. */
function writeJobs(s: Installer, pages: readonly Staged[], level: readonly number[]) {
  const { jobs, device } = s
  const order = pages.map((_, i) => i).sort((a, b) => level[a] - level[b] || a - b)
  const starts = new Uint32Array(PAGE_INSTALL_LEVELS + 1)
  for (const i of order) starts[level[i] + 1]++
  for (let l = 0; l < PAGE_INSTALL_LEVELS; l++) starts[l + 1] += starts[l]
  jobs.set(starts, 0)
  order.forEach((i, rank) => {
    const { src, dst, room, length, unit, list } = pages[i]
    const at = PAGE_JOBS_HEADER_WORDS + rank * PAGE_JOB_WORDS
    jobs.set([src, dst, room, length, unit, list.at, list.count], at)
  })
  const words = PAGE_JOBS_HEADER_WORDS + pages.length * PAGE_JOB_WORDS
  device.queue.writeBuffer(s.table, 0, jobs, 0, words)
  if (s.dependsUsed) device.queue.writeBuffer(s.dependencies, 0, s.depends, 0, s.dependsUsed)
  return starts
}

/** The passes over `pages`, whose levels are `level`, all below `PAGE_INSTALL_LEVELS`. */
function submit(s: Installer, pages: readonly Staged[], level: readonly number[]) {
  const { device, label } = s
  const first = s.first.get(),
    second = s.second.get()
  if (!first || !second) return
  const group = groupOver(s, s.pool())
  const top = Math.max(...level)
  // The jobs by level, the first of each in the header, the end of the last after it.
  const starts = writeJobs(s, pages, level)
  const encoder = device.createCommandEncoder({ label })
  const pass = encoder.beginComputePass({ label })
  pass.setPipeline(first)
  pass.setBindGroup(0, group, [0])
  pass.dispatchWorkgroups(pages.length)
  pass.setPipeline(second)
  // The pages that name vertices, a level at a time: level 0 holds those that name none.
  for (let l = 1; l <= top; l++) {
    const count = starts[l + 1] - starts[l]
    if (!count) continue
    pass.setBindGroup(0, group, [l * s.stride])
    pass.dispatchWorkgroups(count)
  }
  pass.end()
  device.queue.submit([encoder.finish()])
}

/** The passes over `pages`; a chain of streaming pages longer than the levels the tables hold —
 *  none a compiled page makes — goes in turns, each submitted after the one it names vertices of. */
function install(s: Installer, pages: readonly Staged[]): void {
  const level = installLevels(pages)
  const now = pages.map((_, i) => i).filter((i) => level[i] < PAGE_INSTALL_LEVELS)
  submit(
    s,
    now.map((i) => pages[i]),
    now.map((i) => level[i]),
  )
  if (now.length < pages.length)
    install(
      s,
      pages.filter((_, i) => level[i] >= PAGE_INSTALL_LEVELS),
    )
}

/** Runs the batch and empties it; whether it is empty: a batch whose passes are not compiled stays
 *  staged (asked now) and goes at the next flush. */
function flush(s: Installer) {
  if (!s.batch.length || s.disposed) return true
  if (!chainReady(s.first, s.second)) return false
  try {
    install(s, s.batch)
  } finally {
    s.batch.length = s.used = s.dependsUsed = 0
    s.lists.clear()
  }
  return true
}

/** Room for a page: the batch flushed; one that cannot be (passes not compiled) leaves none. */
function flushForRoom(s: Installer) {
  if (!flush(s)) throw new Error('INSTALL_PASSES_NOT_COMPILED')
}

/** The dependency list of the streaming page `unit`, made once per batch. */
function listFor(s: Installer, unit: number, starts: () => readonly (number | undefined)[]) {
  let list = s.lists.get(unit)
  if (!list) {
    const listed = starts()
    if (listed.length > INSTALL_DEPENDENCIES) throw new Error('INSTALL_PAGE_TOO_LARGE')
    if (s.dependsUsed + listed.length > INSTALL_DEPENDENCIES) flushForRoom(s)
    list = { at: s.dependsUsed, count: listed.length }
    listed.forEach((start, i) => {
      s.depends[s.dependsUsed + i] = start === undefined ? NO_UNIT : start / 4
    })
    s.dependsUsed += listed.length
    s.lists.set(unit, list)
  }
  return list
}

function addPage(s: Installer, page: PageInstall) {
  const { bytes, offset, room, unit, dependencies: starts } = page
  if (s.disposed) return
  if (bytes.byteLength % 4 || offset % 4 || room % 4 || unit % 4)
    throw new Error('INSTALL_PAGE_UNALIGNED')
  const size = bytes.byteLength
  if (size > INSTALL_STAGING_BYTES) throw new Error('INSTALL_PAGE_TOO_LARGE')
  if (s.batch.length === INSTALL_JOBS || s.used + size > INSTALL_STAGING_BYTES) flushForRoom(s)
  const list = listFor(s, unit, starts)
  s.device.queue.writeBuffer(s.staging, s.used, bytes as Uint8Array<ArrayBuffer>, 0, size)
  const { at, count } = list
  const needs = namedRanks(bytes)?.flatMap((rank) => {
    const start = rank <= count ? s.depends[at + rank - 1] : NO_UNIT
    return start === NO_UNIT || start === unit / 4 ? [] : [start]
  })
  s.batch.push({
    src: s.used / 4,
    dst: offset / 4,
    room: room / 4,
    length: size / 4,
    unit: unit / 4,
    list,
    needs,
  })
  s.used += size
  if (!s.scheduled) {
    s.scheduled = true
    queueMicrotask(() => {
      s.scheduled = false
      flush(s)
    })
  }
}

/**
 * The installer the engine runs on the GPU. The staging buffer takes the pages as they come, one
 * after the other from its start; the passes are run when `INSTALL_JOBS` pages or the buffer's bytes
 * are staged, else on the turn of the task's microtasks after the first page staged, so that the
 * pages that land together are installed in one batch. The staging buffer is rewritten once the
 * passes are submitted, the queue ordering its reads before the next writes.
 */
function createPageInstaller(
  device: GPUDevice,
  pool: () => GPUBuffer,
  { layout, transcode: first, link: second }: ReturnType<typeof installStages>,
): Omit<PageInstaller, 'prepare'> {
  const s: Installer = {
    device,
    pool,
    label: INSTALL_LABEL,
    layout,
    first,
    second,
    ...installerBuffers(device, INSTALL_LABEL),
    jobs: new Uint32Array(PAGE_JOBS_HEADER_WORDS + INSTALL_JOBS * PAGE_JOB_WORDS),
    depends: new Uint32Array(INSTALL_DEPENDENCIES),
    batch: [],
    lists: new Map<number, DependencyList>(),
    used: 0,
    dependsUsed: 0,
    scheduled: false,
    disposed: false,
    groups: new WeakMap<GPUBuffer, GPUBindGroup>(),
  }
  return {
    add: (page) => addPage(s, page),
    flush: () => void flush(s),
    flushAt(offset) {
      if (s.batch.some((page) => page.dst * 4 === offset)) void flush(s)
    },
    dispose() {
      s.disposed = true
      s.staging.destroy()
      s.table.destroy()
      s.dependencies.destroy()
      s.levels.destroy()
    },
  }
}

/** The installer of a pool, whose buffer is `pool()` at the time of a pass (it is replaced when it
 *  grows): its passes asked at once, off the frame, so that the first page finds them compiled; its
 *  buffers made at its first page, so that a pool that installs none holds none. */
export function lazyInstaller(device: GPUDevice, pool: () => GPUBuffer): PageInstaller {
  const stages = installStages(device)
  let made: Omit<PageInstaller, 'prepare'> | undefined
  return {
    prepare: stages.prepare,
    add: (page) => (made ??= createPageInstaller(device, pool, stages)).add(page),
    flush: () => made?.flush(),
    flushAt: (offset) => made?.flushAt(offset),
    dispose: () => made?.dispose(),
  }
}
