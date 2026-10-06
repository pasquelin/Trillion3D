/**
 * The pages of a paged index (`partition/pages.rs`): a root or an index page lists slots of
 * one width, each naming a page by its fingerprint and size, boxed, with what is listed beside it;
 * a region page lists records. The cell index (`tablePartition.ts`) and the manifest's mesh pages
 * (`manifest/paged.ts`) are read through it.
 */
import { EngineError } from '../../contracts/cache.ts'

/** A kind of page (`partition/pages.rs`): the prefix of its files, the version every page carries,
 *  the member a region page lists its records under, and the codes of a refusal. */
export interface PageKind {
  prefix: string
  version: number
  records: string
  unsupported: string
  invalid: string
}
/** A page of an index a slot names, its box at the declared poses, and the core ranks listed
 *  beside it: for the cell index, the parents its cells hang nodes under. */
export type TableSlot = {
  /** The page the slot names. */
  page: TablePage
  /** Its box at the declared poses: the minimum corner, then the maximum. */
  bounds: readonly number[]
  /** The core ranks listed beside it. */
  parents: readonly number[]
}
/** A page a slot names: its file, relative to the tables, its size and its fingerprint. */
export type TablePage = {
  /** Its file, relative to the tables. */
  url: string
  /** Its size in bytes. */
  bytes: number
  /** Its SHA-256 fingerprint, in hexadecimal. */
  sha256: string
}

/** A page's body: the slots of the pages below it, or its records. */
type PageBody = { version?: number; pages?: readonly string[]; [records: string]: unknown }
/** `body` at `kind`'s version, or a named refusal; `what` names it. */
export function versioned(kind: PageKind, body: unknown, what: string): PageBody {
  const page = body as PageBody | null
  if (page?.version !== kind.version)
    throw new EngineError(
      kind.unsupported,
      `${what} version ${String(page?.version)} is not the ${kind.version} this runtime reads`,
      { version: page?.version ?? null },
    )
  return page
}

/** Whether `list` is an array of `width` hexadecimal digits each. */
export const hexes = (list: unknown, width: number): list is string[] =>
  Array.isArray(list) &&
  list.every(
    (item) => typeof item === 'string' && item.length === width && /^[0-9a-f]+$/.test(item),
  )

/** Whether `list` lists, `length` times, core ranks of eight hexadecimal digits run together. */
export const rankLists = (list: unknown, length: number): list is string[] =>
  Array.isArray(list) &&
  list.length === length &&
  list.every((ranks) => typeof ranks === 'string' && /^([0-9a-f]{8})*$/.test(ranks))

const bits = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8))
const text = /* @__PURE__ */ new TextDecoder()
/** The JSON `bytes` carry, as UTF-8. */
export const pageJson = (bytes: Uint8Array): unknown => JSON.parse(text.decode(bytes))
/** The `f64` whose bits are the sixteen hexadecimal digits `hex`. */
export const float64 = (hex: string) => (
  bits.setBigUint64(0, BigInt(`0x${hex}`)),
  bits.getFloat64(0)
)
/** Whether `slot` is 168 hexadecimal digits. */
export const isSlot = (slot: unknown): slot is string =>
  typeof slot === 'string' && /^[0-9a-f]{168}$/.test(slot)

/** An integer of hexadecimal digits `from` to `to` of `hex`. */
const digits = (hex: string, from: number, to: number) => parseInt(hex.slice(from, to), 16)
/** The integers of eight hexadecimal digits each `hex` runs together. */
export const eights = (hex: string) =>
  Array.from({ length: hex.length / 8 }, (_, at) => digits(hex, 8 * at, 8 * at + 8))

/** The page of `kind` that `slot` names, its box and the `parents` listed beside it, `null` for an
 *  empty slot, or a named refusal. A slot is the page's SHA-256 in 64 hexadecimal digits, its size
 *  in 8, its box as six `f64` bit patterns in 16. */
function slotPage(kind: PageKind, slot: unknown, parents = ''): TableSlot | null {
  if (!isSlot(slot)) throw new EngineError(kind.invalid, 'a page slot is not fixed-width hex', {})
  const bytes = parseInt(slot.slice(64, 72), 16)
  if (bytes === 0) return null
  const sha256 = slot.slice(0, 64)
  const bounds = [0, 1, 2, 3, 4, 5].map((at) => float64(slot.slice(72 + 16 * at, 88 + 16 * at)))
  const page = { url: `${kind.prefix}${sha256}.json`, bytes, sha256 }
  return { page, bounds, parents: eights(parents) }
}

/** The page of `kind` at `page`, read through `read`, at `kind`'s version. */
async function readPage(
  kind: PageKind,
  page: TablePage,
  read: (page: TablePage) => Promise<Uint8Array>,
) {
  return versioned(kind, pageJson(await read(page)), page.url)
}

/** The pages `slots` of `kind` name, their boxes and the `parents` listed beside them, the empty
 *  ones left out. */
export const named = (kind: PageKind, slots: readonly unknown[], parents?: readonly string[]) =>
  slots.map((slot, at) => slotPage(kind, slot, parents?.[at])).filter((slot) => slot !== null)

/** Every region page of `kind` under `slots`, in record order, the pages read side by side
 *  through `read` (which verifies each against its slot). */
export async function readLeaves(
  kind: PageKind,
  slots: ReturnType<typeof named>,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<PageBody[]> {
  const lists = await Promise.all(
    slots.map(async ({ page }) => {
      const body = await readPage(kind, page, read)
      if (Array.isArray(body.pages)) return readLeaves(kind, named(kind, body.pages), read)
      if (Array.isArray(body[kind.records])) return [body]
      throw new EngineError(kind.invalid, `${page.url} lists neither pages nor records`, {})
    }),
  )
  return lists.flat()
}
