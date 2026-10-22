import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import {
  checkTexturePoolBudget,
  type GeometryPool,
  type MemoryBudgets,
  type MemoryBudgetsReport,
} from '../../session/memory/pools.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { behind } from '../../gpu/core/behind.ts'
import {
  geometryProbe,
  grantedGeometryPool,
  grantedTexturePool,
  probed,
  sameLayers,
  textureProbe,
} from '../../geometry/residency/poolGrants.ts'
import type { TexturePool } from '../../geometry/residency/memoryBudgets.ts'
import { textureBudgetBeside, textureBytesBeside } from './besidePools.ts'
import { ledgerReplacing } from '../../gpu/core/deviceLedger.ts'
import { growRows } from '../prepare/growTables.ts'
import type { GrownPages } from '../../geometry/pages/pool/resize.ts'
import { roundUpToSignificantBits } from '../../../../math/src/scalar/integers.ts'

/**
 * Changes memory pools mid-session without emptying what they hold: pages and tiles that fit in
 * the new pool are copied there on the GPU, only those that no longer fit leave, and the image
 * stays complete throughout the setting. A value that cannot be held is brought back to what can,
 * and the report says why (`clamp`). A geometry pool above the
 * drawable-page tables — past the pool they were sized for — grows them in place first (`growTables.ts`, `tables` in the report); tables the device refuses keep
 * the pool in place. A pool the device refuses is drawn smaller, and one it refuses even at its
 * floor keeps what it holds (`poolGrants.ts`): out of memory is absorbed here, never handed to the
 * frame. The new pool is probed while the old one lives, and the copy holds both at once
 * (`transientBytes`): that peak is what the device granted, before any page moves.
 */
export async function setWebgpuMemoryBudgets(
  rt: WebgpuPagesRuntime,
  budgets: MemoryBudgets,
  origin: 'host' | 'prepare-targets' = 'host',
): Promise<MemoryBudgetsReport> {
  const { setup, run, diag } = rt
  const started = cpuNow()
  const before = { pages: residentPages(rt), tiles: residentTiles(rt) }
  // A pool is replaced only by one the device grants; none granted, even at its floor, and the pool
  // in place stays.
  const device = rt.gpu.device
  // Tiles first: their copy is synchronous, the pages' waits for in-flight loads.
  const evictedTiles =
    budgets.texturePoolBytes === undefined
      ? 0
      : await setTextureBudget(rt, device, budgets.texturePoolBytes)
  const geometry =
    budgets.geometryPoolBytes === undefined
      ? { evictedPages: 0, transientBytes: 0, tables: null }
      : await setGeometryBudget(rt, device, budgets.geometryPoolBytes, origin)
  // Origin of the resource change: what the image holds has changed place or size.
  run.gate.resourcesChanged()
  // Set while prepare runs, a budget is only recorded: the report waits for prepare, and names the
  // pools the device grants. A prepare that fails reports its own failure.
  if (origin === 'host') await setup.preparing
  const report = {
    geometryPool: setup.geometryPool,
    texturePool: setup.texturePools?.pool ?? null,
    evictedPages: geometry.evictedPages,
    evictedTiles,
    residentPages: { before: before.pages, after: residentPages(rt) },
    residentTiles: { before: before.tiles, after: residentTiles(rt) },
    durationMs: msSince(started),
    tables: geometry.tables,
    transientBytes: geometry.transientBytes,
  }
  diag.engineDiagnostic('memory-budgets', 'Memory pools set', report)
  return report
}

type Device = WebgpuPagesRuntime['gpu']['device']
const residentTiles = ({ vis }: WebgpuPagesRuntime) =>
  vis.textures
    ? [...vis.textures.color.pools, ...vis.textures.data.pools].reduce(
        (total, pool) => total + pool.resident,
        0,
      )
    : 0
const residentPages = ({ gpu }: WebgpuPagesRuntime) => gpu.cache?.stats().residentPages ?? 0

/** The texture pool drawn again for `budget`; the tiles it evicted. */
async function setTextureBudget(rt: WebgpuPagesRuntime, device: Device, budget: number) {
  const { setup, vis, run, diag } = rt
  checkTexturePoolBudget(budget)
  const pools = setup.texturePools
  // Before prepare nothing is granted yet: the budget is kept, and prepare draws it.
  if (!pools) {
    setup.texturePoolBudget = budget
    return 0
  }
  // A live texture's working texture (#362) is texture memory too: the pool is drawn from what
  // the budget leaves it, the budget recorded staying the one declared.
  const { live, bytes, deducted } = textureBudgetBeside(rt, budget)
  pools.liveBytes = live
  let pool: TexturePool | undefined = pools.poolFor(bytes)
  if (!sameLayers(pool, pools.pool) && vis.textures && device && !run.lost) {
    const probe = textureProbe(device, pools.encoding)
    pool = await probed(grantedTexturePool(device, bytes, pools, diag.engineDiagnostic, probe))
  }
  if (!pool) return 0
  const evictedTiles = vis.textures && !run.lost ? vis.textures.resize(pool.layers) : 0
  pools.pool = pool
  // What the device granted, not what was asked: a refusal keeps the budget in place.
  setup.texturePoolBudget = pool.budgetBytes + deducted
  return evictedTiles
}

/** The geometry pool drawn again for `budget`, the tables grown first when it needs more rows. The
 *  pages that joined the catalogue (`grown`) lay out its cache anew, in place, whatever the slots. */
async function setGeometryBudget(
  rt: WebgpuPagesRuntime,
  device: Device,
  budget: number,
  origin: 'host' | 'prepare-targets',
  grown?: GrownPages,
) {
  const { setup, gpu, run, diag } = rt
  let evictedPages = 0,
    transientBytes = 0,
    tables: MemoryBudgetsReport['tables'] = null,
    applied = !grown
  // The streaming slots take the whole budget (`../../session/memory/pools.ts`). A pool above the
  // tables waits for a running prepare: the tables it builds are those that grow.
  if (setup.preparing && setup.geometryPoolFor(budget).slots > setup.cap) {
    if (origin === 'prepare-targets') throw new Error('TARGET_ADMISSION_REQUIRES_TABLE_GROWTH')
    await setup.preparing
  }
  let pool: GeometryPool | undefined = setup.geometryPoolFor(budget)
  // The tables first: a pool whose pages would find no row is never put in place, and the probe
  // then asks the device for the pool beside the tables it already holds.
  if (pool.slots > setup.cap) {
    tables = await growRows(rt, pool.slots)
    if (tables?.refused) pool = undefined
  }
  if (pool && (pool.slots !== setup.slots || grown) && gpu.cache && device && !run.lost) {
    // The probe stands for the pool that replaces the one in place (`ledgerReplacing`).
    const held = setup.geometryPool.allocatedBytes,
      bare = geometryProbe(device)
    const probe = (drawn: GeometryPool) => ledgerReplacing(device, held, () => bare(drawn))
    pool = await probed(
      grantedGeometryPool(device, budget, setup.geometryPoolFor, diag.engineDiagnostic, probe),
    )
  }
  if (pool && (pool.slots !== setup.slots || grown) && gpu.cache && !run.lost) {
    transientBytes = setup.geometryPool.allocatedBytes + pool.allocatedBytes
    // The root cover keeps its place before any other page, in the root region's grains: the pool
    // never goes below it, and a cut can only be completed from it.
    const evicted = await gpu.cache.resize(pool.slots, grown, pool.roots)
    applied = true
    // A pinned page that has just been evicted is told by the cache: the pin step puts it back in
    // the queue if the image still keeps it.
    evictedPages = evicted.length
  }
  if (pool) setup.geometryPool = pool
  return { evictedPages, transientBytes, tables, applied }
}

/**
 * The geometry pool drawn again for the pages that joined the session's catalogue
 * (`catalogueGrowth.ts`): its budget kept, its cache laid out for them in place — every page it
 * holds where it was, or moved on the GPU —, the tables sized by drawable page grown first when the
 * pool asks more. True once the cache holds them; false where the device refuses the pool, which
 * keeps the one in place.
 */
export function growWebgpuPagePool(rt: WebgpuPagesRuntime, grown: GrownPages) {
  return behind(rt.run.funding, () =>
    setGeometryBudget(rt, rt.gpu.device, rt.setup.geometryPool.budgetBytes, 'host', grown).then(
      (report) => report.applied,
    ),
  )
}

/**
 * The ROOT REGION grown for `short` root pages more than its grains hold
 * (`../../geometry/pages/pool/placement.ts`): HLOD cells hold more root pages than it has room
 * for. As the reference's root page allocation, it grows to the grains asked rounded up to two
 * significant bits (`roundUpToSignificantBits`), within every root page the catalogue has
 * (`rootRegion.most`): the geometry pool drawn again for its budget, the tables grown first when
 * it asks more rows, its pages kept. One growth at a time; the pages wait for it. A device that
 * refuses it keeps the region in place, and the region grows no more: the pages it lacks room for
 * wait, said by name.
 */
export function growWebgpuRootRegion(rt: WebgpuPagesRuntime, short: number) {
  const { setup, diag } = rt,
    held = setup.geometryPool.roots.slots
  const grains = Math.min(roundUpToSignificantBits(held + short, 2), setup.rootRegion.most)
  if (setup.rootGrowth || grains <= held) return
  setup.geometryShape.rootPages = grains
  const budget = setup.geometryPool.budgetBytes
  setup.rootGrowth = behind(rt.run.funding, async () => {
    await setGeometryBudget(rt, rt.gpu.device, budget, 'host')
    const granted = setup.geometryPool.roots.slots
    if (granted >= grains) return
    setup.geometryShape.rootPages = granted
    setup.rootRegion.most = granted
    diag.engineDiagnostic('root-region-refused', 'The root region could not grow', {
      asked: grains,
      held: granted,
    })
  })
    .catch((error) => diag.diagnosticFailure('root-region-growth', error))
    .finally(() => (setup.rootGrowth = undefined))
}

/**
 * A texture turned live (#362) since the pool was drawn: the pool is drawn again under the same
 * budget, less the bytes held beside it, as
 * `setMemoryBudgets` draws it — tiles kept, out of memory absorbed. Once per change; a still scene
 * reads one number.
 */
export function followLiveTextures(rt: WebgpuPagesRuntime) {
  const pools = rt.setup.texturePools,
    live = textureBytesBeside(rt)
  if (!pools || live === (pools.liveBytes ?? 0)) return
  setWebgpuMemoryBudgets(rt, { texturePoolBytes: rt.setup.texturePoolBudget }).catch((error) =>
    rt.diag.diagnosticFailure('texture-live-budget', error),
  )
}
