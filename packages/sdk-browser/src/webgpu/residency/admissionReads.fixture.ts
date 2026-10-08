// Random residency jobs for the admission reads' tests: one world, one job over it,
// reading ahead or not, every read and load logged in order.
import type { PageRec } from '../../page/selection/selection.ts'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, lruCache, pageOf } from './residentEnsurer.fixture.ts'
import { lcgFloatRandom } from '../../../../math/src/sequence/seeded.fixture.ts'

/** A random world: pages whose parents come before them, some without bytes, some resident, some
 *  wanted by the camera, the rest split between the two lower tiers. */
export function world(seed: number) {
  const random = lcgFloatRandom(seed)
  const count = 1 + Math.floor(random() * 24)
  const pages = Array.from({ length: count }, (_, i) => pageOf(`p${i}`))
  const parents = new Map<PageRec, PageRec[]>()
  pages.forEach((page, i) => {
    const list: PageRec[] = []
    for (let j = 0; j < i; j++) if (random() < 0.15) list.push(pages[j])
    parents.set(page, list)
  })
  const without = new Set(pages.filter(() => random() < 0.1))
  const pick = (odds: number) => pages.filter(() => random() < odds)
  return {
    pages,
    parentsOf: (page: PageRec) => parents.get(page)!,
    hasBytes: (page: PageRec) => !without.has(page),
    slots: Math.floor(random() * (count + 2)),
    resident: pick(0.2),
    camera: pick(0.4),
    tiers: [pick(0.3), pick(0.3)],
  }
}

/** One residency job over `scene`, reading ahead or not: every read and load, in order. With
 *  `arrival`, a read settles when that promise does, and the load of its page waits for it, as the
 *  admission joins the transfer under way. */
export async function run(
  scene: ReturnType<typeof world>,
  readAhead: boolean,
  slots = scene.slots,
  arrival?: (url: string) => Promise<void>,
) {
  const tracking = createWebgpuPageTracking(scene.pages)
  const cache = lruCache(slots),
    load = cache.load,
    log: string[] = [],
    signals: AbortSignal[] = []
  for (const page of scene.resident.slice(0, slots)) await load(page.url)
  const arriving = new Map<string, Promise<void>>()
  cache.load = async (url: string) => {
    await arriving.get(url)
    log.push(`load ${url}`)
    return load(url)
  }
  for (const page of scene.camera) tracking.wanted.add(tracking.keyOf(page), page)
  const ensure = createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    hasBytes: scene.hasBytes,
    parentsOf: scene.parentsOf,
    lowerTiers: () =>
      scene.tiers.map((pages) => ({
        pages,
        has: (key: number) => pages.some((page) => tracking.keyOf(page) === key),
        revision: 0,
      })),
    prefetch: readAhead
      ? (page, signal) => {
          log.push(`read ${page.url}`)
          signals.push(signal)
          if (arrival) arriving.set(page.url, arrival(page.url))
        }
      : undefined,
  })
  let error: unknown
  await ensure(scene.camera, 1, 1).catch((thrown) => (error = thrown))
  const loads = log.filter((entry) => entry.startsWith('load'))
  return { log, loads, reads: log.filter((entry) => entry.startsWith('read')), signals, error }
}
