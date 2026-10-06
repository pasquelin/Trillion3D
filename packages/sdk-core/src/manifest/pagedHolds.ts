/**
 * THE MESH PAGES A LAZY MANIFEST'S VIEW HOLDS (`openPagedManifest`). Each page is counted per hold
 * and read once while its holds wait: at the first one's priority, and cancelled once every one of
 * them let it go. Its primitives join the list once it lands and leave it with its last holder,
 * which lets its files go (`letGo`). A hold that fails leaves its pages counted until released:
 * they stay wanted, and the next hold asks the same pages again.
 */
import type { Primitive } from '../contracts/index.ts'
import type { TablePage } from '../scene/core/tablePages.ts'
import { waitShared, type SharedRead } from '../runtime/sharedRead.ts'

/** How a hold asks its pages read: the signal that lets it go, and its priority. */
export type PageAsk = { signal?: AbortSignal; priority?: number }

/** The mesh pages of a manifest opened by its head (`openPagedManifest`), held by a count. */
export interface ManifestPages {
  /** The manifest's primitives now, in rank order: those of every page held and read, the very
   *  list its `metadata.primitives` is. */
  readonly primitives: readonly Primitive[]
  /** Bumped each time a page's primitives join or leave `primitives`. */
  readonly changes: number
  /** Counts one more holder of each page `slots` name; a page neither read nor on its way is, as
   *  `asked`, its primitives appended once it lands. Settles once every one is, or fails with the
   *  first that failed, its pages still counted: each hold is released once, landed or not. */
  hold(slots: readonly string[], asked?: PageAsk): Promise<void>
  /** Counts one holder less of each; a page none holds any longer leaves with its primitives. */
  release(slots: readonly string[]): void
}

/** A page's read on its way, shared by the holds waiting on it — cancelled once every one let it
 *  go —, and the ask its files are read with. */
type Reading = SharedRead<void> & { asked: PageAsk }
/** A page held: its holders, its primitives once read, its read on its way, its files read. */
type Held = {
  count: number
  primitives?: Primitive[]
  reading?: Reading
  files: Map<string, TablePage>
}
/** A read of one file of a page, as a hold asks it. */
type Read = (page: TablePage, asked: PageAsk) => Promise<unknown>

/** `entry`'s read, `start`ed with the ask it reads at `priority` with: forgotten once settled. */
function startReading(
  entry: Held,
  priority: number | undefined,
  start: (asked: PageAsk) => Promise<void>,
) {
  const stop = new AbortController(),
    asked = { priority, signal: stop.signal }
  const reading: Reading = { askers: 0, stop, asked, promise: start(asked) }
  const done = () => void (entry.reading === reading && (entry.reading = undefined))
  reading.promise.then(done, done)
  entry.reading = reading
}

/** `entry`'s read joined by a hold as `asked`: one more urgent lifts it — its file on its way
 *  asked again at that priority through `read`, the queue keeping the most urgent, and the files
 *  after it asked so. */
function lift(entry: Held, asked: PageAsk, read: Read) {
  const own = entry.reading!.asked
  if ((asked.priority ?? 0) >= (own.priority ?? 0)) return
  own.priority = asked.priority
  const file = [...entry.files.values()].at(-1)
  if (file) read(file, asked).catch(() => {})
}

/** `primitives` taken out of `list`, its order kept. */
function unlist(list: Primitive[], primitives: readonly Primitive[]) {
  const gone = new Set(primitives)
  let at = 0
  for (const primitive of list) if (!gone.has(primitive)) list[at++] = primitive
  list.length = at
}

/** The holds of the pages `load` reads — a slot's primitives, read as asked, each file it reads
 *  told `seen` —, listed in `list` in rank order, their files let go through `letGo`, a file on
 *  its way asked again through `read`. */
export function createPageHolds(
  load: (slot: string, asked: PageAsk, seen: (page: TablePage) => void) => Promise<Primitive[]>,
  list: Primitive[],
  letGo: (page: TablePage) => void,
  read: Read,
) {
  const held = new Map<string, Held>()
  let changes = 0
  /** `slot`'s one read, started for the first hold that asks it and joined by the later ones; one
   *  its last asker stopped is never joined, a new one starts. */
  const join = (slot: string, entry: Held, asked: PageAsk = {}) => {
    if (!entry.reading || entry.reading.stop.signal.aborted)
      startReading(entry, asked.priority, (own) => place(slot, entry, own))
    else lift(entry, asked, read)
    return waitShared(entry.reading!, asked.signal)
  }
  const place = async (slot: string, entry: Held, asked: PageAsk) => {
    const primitives = await load(slot, asked, (page) => entry.files.set(page.url, page))
    // Released before it landed, or placed by its other read: a stopped one landing anyway.
    if (held.get(slot) !== entry || entry.primitives) return
    entry.primitives = primitives
    for (const primitive of primitives) list.push(primitive)
    // In rank order, whichever page landed first: the list is the same for the same pages held.
    list.sort((a, b) => a.mesh - b.mesh || a.primitive - b.primitive)
    changes++
  }
  const pages: ManifestPages = {
    primitives: list,
    get changes() {
      return changes
    },
    async hold(slots, asked) {
      const settled = await Promise.allSettled(
        slots.map((slot) => {
          let entry = held.get(slot)
          if (!entry) held.set(slot, (entry = { count: 0, files: new Map() }))
          entry.count++
          return entry.primitives ? undefined : join(slot, entry, asked)
        }),
      )
      const failed = settled.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
    },
    release(slots) {
      for (const slot of slots) {
        const entry = held.get(slot)
        if (!entry || --entry.count > 0) continue
        held.delete(slot)
        entry.files.forEach((page) => letGo(page))
        if (entry.primitives) unlist(list, entry.primitives)
        changes += entry.primitives ? 1 : 0
      }
    },
  }
  return pages
}
