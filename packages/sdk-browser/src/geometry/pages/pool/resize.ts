import type { GpuPageContext, ResidentPage } from './types.ts'
import { ledgerReplacing } from '../../../gpu/core/deviceLedger.ts'
import { grownByCopy } from '../../../gpu/core/tableGrowth.ts'
import { evictResident } from './commit.ts'
import { checkBudget, storageBufferCap } from '../../../session/memory/pools.ts'
import { extendHomes, pageHomes, type PageHomes } from './homes.ts'
import { createPlacement, poolBytes, type Placement, type RootSlots } from './placement.ts'

/** Bytes of a pool of `slots` streaming pages of `pageBytes` at most, `roots` its root region
 *  (`poolBytes`), refused past one storage binding. */
export const pageBufferBytes = (
  device: GPUDevice,
  pageBytes: number,
  slots: number,
  homes?: PageHomes,
  roots?: RootSlots,
) => {
  checkBudget(slots, 'INVALID_PAGE_BUDGET')
  if (roots && !rootsFit(roots, slots)) throw new Error('INVALID_PAGE_BUDGET')
  const size = poolBytes(pageBytes, slots, homes, roots)
  if (size > storageBufferCap(device.limits)) throw new Error('INVALID_PAGE_BUDGET')
  return size
}

/** Whether `roots` lies in a pool of `slots`: whole grains, no more than its slots, each a whole
 *  number of words. */
const rootsFit = ({ slots: grains, bytes }: RootSlots, slots: number) =>
  Number.isSafeInteger(grains) &&
  grains >= 0 &&
  grains <= slots &&
  (grains === 0 || (Number.isSafeInteger(bytes) && bytes >= 4 && bytes % 4 === 0))

export const createPageBuffer = (
  device: GPUDevice,
  size: number,
  label = 'Trillion3D geometry page cache',
) =>
  device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })

/** A streaming page the pool holds: its name, its first byte, one of its pages' keys — whether a
 *  root grain holds it (`placement.ts`, `rooted`) —, its resident pages, and its rank — 0 for one
 *  of the root cover, 1 for one pinned, 2 for another — and latest arrival. */
type HeldUnit = {
  unit: string
  start: number
  key: string
  pages: ResidentPage[]
  rank: number
  latest: number
}

/** The streaming pages `old` holds, with the pages `resident` holds in each, ranked only when some
 *  must leave (`fits` false): the root cover's first, then the pinned ones, then the others, each
 *  the most recent arrival first: a smaller pool gives up the oldest arrivals. */
function heldUnits(context: GpuPageContext, old: Placement, fits: boolean): HeldUnit[] {
  const { resident, eviction, cover } = context
  const units: HeldUnit[] = []
  for (const [unit, { start, keys }] of old.placed) {
    const pages = [...keys].flatMap((key) => resident.get(key) ?? [])
    const rank = Math.min(
      ...pages.map((page) => (cover.has(page.key) ? 0 : eviction.isPinned(page.key) ? 1 : 2)),
    )
    const latest = Math.max(...pages.map((page) => page.generation))
    const [key] = keys
    units.push({ unit, start, key, pages, rank, latest })
  }
  if (!fits) units.sort((a, b) => a.rank - b.rank || b.latest - a.latest)
  return units
}

/** The catalogue a pool is laid out for when pages join it: the width the widest streaming page
 *  asks, and the width of each streaming page new to it (`extendHomes`). */
export type GrownPages = { pageBytes: number; widths: ReadonlyMap<string, number> }

type Planned = { held: HeldUnit; start: number; bytes: number }

/** The layout first, nothing moved yet: where each streaming page held keeps its place in
 *  `placement`, and whether any moved. */
function planLayout(
  context: GpuPageContext,
  old: GpuPageContext['placement'],
  placement: GpuPageContext['placement'],
  bytes: number,
) {
  let total = 0
  for (const unit of old.placed.keys()) total += placement.widthOf(unit)
  const plan: Planned[] = []
  let moved = false
  for (const held of heldUnits(context, old, total <= bytes)) {
    const start = placement.keep(held.unit, held.start, held.key)
    for (const page of held.pages) if (start >= 0) placement.hold(page.key)
    const copied = Math.min(old.widthOf(held.unit), placement.widthOf(held.unit))
    plan.push({ held, start, bytes: copied })
    if (start !== held.start) moved = true
  }
  return { plan, moved }
}

/** Each streaming page of `plan` moved to its new place or evicted, every page logged; the runs
 *  to copy — old start, new start, width — gathered into `runs`. Returns the evicted keys. */
function movePlanned(context: GpuPageContext, plan: Planned[], runs: number[]) {
  const evicted: string[] = []
  for (const { held, start, bytes: width } of plan.sort((x, y) => x.held.start - y.held.start)) {
    if (start < 0) {
      for (const page of held.pages) {
        evictResident(context, page, 'resize')
        evicted.push(page.key)
      }
      continue
    }
    const at = runs.length - 3
    if (at >= 0 && runs[at] + runs[at + 2] === held.start && runs[at + 1] + runs[at + 2] === start)
      runs[at + 2] += width
    else runs.push(held.start, start, width)
    if (start === held.start) continue
    for (const page of held.pages) {
      page.offset += start - held.start
      context.changes.placed(page.key, page.offset)
    }
  }
  return evicted
}

/**
 * The pool changes size WITHOUT losing what it holds, through its one allocator (`placement.ts`):
 * a new layout of the new bytes, the streaming pages placed in it in rank — the root cover's
 * first, which a pool never goes below, then the pinned ones, then the latest arrivals
 * (`heldUnits`; no rank when they all fit) —, each where it was when that slot is free, at its
 * home when the pool comes to hold the catalogue, else in a free slot; one no slot takes is
 * evicted, every page of it. Every page that moved is logged as an ordinary arrival
 * (`residencyLog.ts`). The streaming pages are copied into the new buffer in runs: one that keeps
 * its place beside one that does too is one copy, so a pool that grows behind its pages copies
 * them in one; a pool whose bytes and places all stay keeps its buffer. Returns the evicted keys,
 * pinned included: the caller unpins them on its side.
 *
 * Pages joined the catalogue (`grown`): the homes of their streaming pages are added behind the
 * others; a wider widest streaming page widens every slot. `roots`, the new root region
 * (`placement.ts`), keeps the one in place when absent: the root pages take its grains.
 */
export function resizeGpuPages(
  context: GpuPageContext,
  slots: number,
  grown?: GrownPages,
  roots = context.roots,
): string[] {
  const { device, resident } = context
  // The pages staged are installed into the pool as it is, before it is copied.
  context.install.flush()
  const pageBytes = Math.max(context.pageBytes, grown?.pageBytes ?? context.pageBytes)
  // The homes joined are the new layout's alone until its buffer is made: a buffer the device
  // refuses leaves the pool's homes as they were.
  const homes = grown ? joinedHomes(context.homes, grown.widths) : context.homes
  const bytes = pageBufferBytes(device, pageBytes, slots, homes, roots)
  const old = context.placement
  const { units, rootUrls } = context
  const placement = createPlacement({
    bytes,
    widest: pageBytes,
    ...{ homes, units, roots, rootUrls, resident },
  })
  const { plan, moved } = planLayout(context, old, placement, bytes)
  const next =
    moved || bytes !== context.buffer.size
      ? ledgerReplacing(device, context.buffer.size, () => createPageBuffer(device, bytes))
      : context.buffer
  const runs: number[] = []
  const evicted = movePlanned(context, plan, runs)
  if (next !== context.buffer) {
    const held = context.buffer
    context.buffer = next
    grownByCopy(
      device,
      [held],
      (encoder) => {
        for (let i = 0; i < runs.length; i += 3)
          encoder.copyBufferToBuffer(held, runs[i], next, runs[i + 1], runs[i + 2])
      },
      'Trillion3D geometry page cache resize',
    )
  }
  context.homes = homes
  context.placement = placement
  context.slots = slots
  context.roots = roots
  context.pageBytes = pageBytes
  return evicted
}

/** The pool's `homes` with the homes of the streaming pages `widths` names behind them, as a copy:
 *  `homes` itself is the held layout's. */
function joinedHomes(homes: PageHomes | undefined, widths: ReadonlyMap<string, number>) {
  if (!homes) return pageHomes(widths)
  const joined: PageHomes = { homes: new Map(homes.homes), bytes: homes.bytes }
  extendHomes(joined, widths)
  return joined
}
