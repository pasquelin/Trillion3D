/**
 * THE CELL INDEX OF A PARTITIONED SCENE, READ AS THE VIEW REACHES IT. The cook cut the
 * cells' records into pages (`partition/pages.rs`), each the cells of one region of space, under
 * index pages; the root names the top ones, each boxed at the declared poses. Before its first
 * frame the runtime reads that root and the pages on the first camera's way (`cells.ts`, `prime`).
 * A frame walks the pages from it: a page whose box, where the parents its cells hang under stand
 * now (`boxes.ts`, `around`), meets its sphere is read — decoded in the pool and
 * opened within the one integration budget (`cells.ts`) — then its pages are walked, or its cells
 * tested. A page past the keep sphere with no cell placed is closed again: the index holds the
 * pages the view reached, never the world's, and a frame's work follows what its sphere holds.
 */
import type { readCellPage, TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { TableSlot } from '../../../../sdk-core/src/scene/core/tablePages.ts'
import type { StreamPage } from '../streaming/types.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { boxed, type Boxed, type CellBoxes, type Declared } from './boxes.ts'
import { boxDistance } from './plan.ts'

/** A page of the index: its file, its boxes, and once opened the pages it lists or its cells. */
export type IndexPage = Declared & {
  slot: StreamPage
  body: { pages: IndexPage[] } | { cells: number[] } | null
}
/** A cell the index holds: its record, its file's address, its boxes, and its HLOD 0 cell's
 *  streaming bounds as declared, carried where the parents its nodes hang under stand now. */
type Cell = TableCell & { item: Boxed; leafBox: Declared }
/** A page's body as the pool reads it. */
export type PageBody = ReturnType<typeof readCellPage>

/** The index under the root's `slots`, whose files lie beside `base`, boxed through `boxes`. */
export function createCellIndex(slots: readonly TableSlot[], base: string, boxes: CellBoxes) {
  const cells = new Map<number, Cell>()
  let opened = 0,
    forgotten: string[] = []
  const pageOf = ({ page, bounds, parents }: TableSlot): IndexPage => ({
    slot: { ...page, url: new URL(page.url, base).href },
    declared: bounds,
    parents,
    box: new Float64Array(BOX_VALUES),
    written: -1,
    body: null,
  })
  const top = slots.map(pageOf)
  /** The file of a cell the index holds, as the catalogue takes it. */
  const fileOf = (cell: number): StreamPage => {
    const { url, bytes, sha256 } = cells.get(cell)!
    return { url, bytes, sha256 }
  }
  /** The distances the walk meets `cell` by from `eye`: its content — its grid cell's, or its
   *  nodes' boxes where a moved parent carried them — (`own`), its HLOD 0 cell's streaming bounds
   *  where those parents carried them too (`leaf`, `leafBox`: a page's box and a cell's boxes
   *  follow a moved parent, so do the bounds its HLOD 0 cell streams by), and the nearest of those
   *  and its HLOD 1 cell's (`reach`) — a cell is met while any grid could stream it. */
  const met = { own: 0, leaf: 0, reach: 0, leafBox: new Float64Array(0) as ArrayLike<number> }
  const measure = ({ item, bounds, hlod, leafBox }: Cell, eye: ArrayLike<number>) => {
    met.own = Math.min(boxDistance(bounds, eye), boxDistance(boxes.bounds(item), eye))
    met.leafBox = boxes.around(leafBox)
    met.leaf = boxDistance(met.leafBox, eye)
    met.reach = Math.min(met.own, met.leaf, boxDistance(hlod[2], eye))
    return met
  }
  /** Whether `page` holds no cell of `held`. */
  const idle = (page: IndexPage, held: { has(cell: number): boolean }): boolean =>
    !page.body ||
    ('pages' in page.body
      ? page.body.pages.every((below) => idle(below, held))
      : !page.body.cells.some((cell) => held.has(cell)))
  const close = (page: IndexPage) => {
    const body = page.body
    if (!body) return
    opened--
    page.body = null
    if ('pages' in body)
      for (const below of body.pages) {
        forgotten.push(below.slot.url)
        close(below)
      }
    else
      for (const cell of body.cells) {
        forgotten.push(cells.get(cell)!.url)
        cells.delete(cell)
      }
  }
  return {
    /** Every file the index names now — the root's pages, those its opened pages list, their cells'
     *  files —: what a session's catalogue holds at open, the index kept from a session before
     *  included, whose opened pages its prime walks no more. */
    named() {
      const named: StreamPage[] = [],
        walk = [...top]
      for (let page = walk.pop(); page; page = walk.pop()) {
        named.push(page.slot)
        if (!page.body) continue
        if ('pages' in page.body) walk.push(...page.body.pages)
        else for (const cell of page.body.cells) named.push(fileOf(cell))
      }
      return named
    },
    /** The record of a cell the index holds. */
    cell: (cell: number): TableCell => cells.get(cell)!,
    /** How many pages the index holds opened, and cells. */
    stats: () => ({ pages: opened, cells: cells.size }),
    /** Opens `page` on its decoded `body`; returns the files it names, which the catalogue takes. */
    open(page: IndexPage, body: PageBody): StreamPage[] {
      opened++
      if (body.pages) {
        const pages = body.pages.map(pageOf)
        page.body = { pages }
        return pages.map((below) => below.slot)
      }
      // A cell is its cook's rank, whatever page opens first: the world roots name it so.
      const ids = body.cells.map((record, at) => {
        const url = new URL(record.url, base).href
        const id = body.first + at
        const leafBox: Declared = {
          declared: record.hlod[1],
          parents: record.parents.flatMap(([rank]) => (rank === null ? [] : [rank])),
          box: new Float64Array(BOX_VALUES),
          written: -1,
        }
        cells.set(id, { ...record, url, item: boxed(record.parents), leafBox })
        return id
      })
      page.body = { cells: ids }
      return ids.map(fileOf)
    },
    /**
     * Walks the pages from the root: visits each cell within `radius` of `eye` — its boxes or its
     * HLOD cells' streaming bounds, which its page's box holds too (`partition.rs`) —, with how
     * far its content and its HLOD 0 cell's streaming bounds lie, that HLOD 0 cell and those
     * bounds, and each
     * page within it not yet opened (`unread`); closes each opened page past `keep` whose cells
     * `held` holds none. Distances are 2D (`boxDistance`). Returns the boxes it tested: the pages
     * it met, and the cells of the region pages it walked.
     */
    near(
      eye: ArrayLike<number>,
      radius: number,
      keep: number,
      held: { has(cell: number): boolean },
      visit: (
        cell: number,
        own: number,
        leaf: number,
        hlod: number,
        leafBox: ArrayLike<number>,
      ) => void,
      unread: (page: IndexPage, distance: number) => void,
    ) {
      const tested = { pages: 0, cells: 0 },
        open = [...top]
      for (let page = open.pop(); page; page = open.pop()) {
        tested.pages++
        const away = boxDistance(boxes.around(page), eye)
        if (away > radius) {
          if (away > keep && idle(page, held)) close(page)
        } else if (!page.body) unread(page, away)
        else if ('pages' in page.body) open.push(...page.body.pages)
        else
          for (const cell of page.body.cells) {
            tested.cells++
            const record = cells.get(cell)!
            const { own, leaf, reach, leafBox } = measure(record, eye)
            if (reach <= radius) visit(cell, own, leaf, record.hlod[0], leafBox)
          }
      }
      return tested
    },
    /** The files the pages closed since the last call named: the catalogue lets them go. */
    forgotten() {
      const out = forgotten
      forgotten = []
      return out
    },
  }
}

export type CellIndex = ReturnType<typeof createCellIndex>
