import {
  readCellPage,
  RUNGS,
  tablePartition,
  type TableCell,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { CellIndex, IndexPage } from './cellIndex.ts';

type Box = readonly number[];
const bits = new DataView(new ArrayBuffer(8));
const hex = (value: number, width: number) => value.toString(16).padStart(width, '0');
/** The sixteen hexadecimal digits of the bits of `value`. */
const f64 = (value: number) => (
  bits.setFloat64(0, value),
  bits.getBigUint64(0).toString(16).padStart(16, '0')
);
let serial = 0;

/** The union of `boxes`. */
const union = (boxes: readonly Box[]) =>
  [0, 1, 2, 3, 4, 5].map((axis) => (axis < 3 ? Math.min : Math.max)(...boxes.map((b) => b[axis])));

/** The core ranks `cells` hang nodes under, each once in rank order, eight hexadecimal digits
 *  each, run together. */
const parentsOf = (cells: readonly TableCell[]) =>
  [...new Set(cells.flatMap((cell) => cell.parents.map(([rank]) => rank)))]
    .filter((rank) => rank !== null)
    .sort((a, b) => a - b)
    .map((rank) => hex(rank, 8))
    .join('');

/** How a test lays the root's rows (`partition/pages/rows.rs`): the side of the first rung and
 *  each mesh's rows at each rung. By default every rung holds every node. */
type Ladder = { cube: number; rows: (mesh: number, total: number, rung: number) => number };

/**
 * The partition of `cells` as the cook pages it (`partition/pages.rs`): halved in order down to
 * region pages of `per` cells, under index pages of two, the top one in the root's first slot;
 * each cell boxed at the declared poses, in the root's frame, by `declared`, each page listed with
 * the core parents its cells hang under, and the rows laid by `ladder`. `files` holds each page's
 * bytes by name; a slot's fingerprint is a serial number, which no test here verifies.
 */
export function paged(
  cells: readonly TableCell[],
  per: number,
  declared: (cell: TableCell) => Box = (cell) => cell.parents[0][1],
  ladder: Ladder = { cube: 1, rows: (_, total) => total },
) {
  const files = new Map<string, Uint8Array>();
  const write = (body: object, box: Box, list: readonly TableCell[]) => {
    const json = JSON.stringify({ version: 4, ...body });
    const sha = hex(++serial, 64);
    files.set(`scene-page-${sha}.json`, new TextEncoder().encode(json));
    return { slot: `${sha}${hex(json.length, 8)}${box.map(f64).join('')}`, box, list };
  };
  type Page = ReturnType<typeof write>;
  const build = (from: number, to: number): Page => {
    const list = cells.slice(from, to);
    if (to - from <= per)
      return write({ cells: list, meshPages: [] }, union(list.map(declared)), list);
    const middle = (from + to) >> 1;
    const halves = [build(from, middle), build(middle, to)];
    const body = {
      pages: halves.map((h) => h.slot),
      parents: halves.map((h) => parentsOf(h.list)),
    };
    return write(body, union(halves.map((h) => h.box)), list);
  };
  const totals = new Map<number, number>();
  for (const cell of cells)
    for (const [mesh, nodes] of cell.meshes) totals.set(mesh, (totals.get(mesh) ?? 0) + nodes);
  const top = build(0, cells.length);
  const rungs = (mesh: number, total: number) =>
    Array.from({ length: RUNGS }, (_, rung) => hex(ladder.rows(mesh, total, rung), 8)).join('');
  const root = {
    version: 4,
    pages: [top.slot, ...Array<string>(7).fill('0'.repeat(168))],
    parents: [parentsOf(top.list), ...Array<string>(7).fill('')],
    meshes: [...totals]
      .sort(([a], [b]) => a - b)
      .map(([m, n]) => hex(m, 8) + hex(n, 8) + rungs(m, n)),
    cube: f64(ladder.cube),
  };
  return { partition: tablePartition(root), files, root };
}

/** Opens every page of `index` its walk from `eye` meets within `radius`, reading `files`: level
 *  by level, each in the order the cook wrote it, so the cells are numbered in record order. */
export function openAll(
  index: CellIndex,
  files: ReadonlyMap<string, Uint8Array>,
  eye: ArrayLike<number> = [0, 0, 0],
  radius = Infinity,
) {
  const none = { has: () => false };
  for (let unread: IndexPage[] = [null!]; unread.length;) {
    unread = [];
    index.near(
      eye,
      radius,
      Infinity,
      none,
      () => {},
      (page) => void unread.push(page),
    );
    unread.sort((a, b) => a.slot.url.localeCompare(b.slot.url));
    for (const page of unread) {
      const name = page.slot.url.split('/').at(-1)!;
      index.open(page, readCellPage(files.get(name)!, name));
    }
  }
}
