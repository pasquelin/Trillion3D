import {
  readCellPage,
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

/**
 * The partition of `cells` as the cook pages it (`partition/pages.rs`): halved in order down to
 * region pages of `per` cells, under index pages of two, the top one in the root's first slot;
 * each cell boxed at the declared poses, in the root's frame, by `declared`. `files` holds each
 * page's bytes by name; a slot's fingerprint is a serial number, which no test here verifies.
 */
export function paged(
  cells: readonly TableCell[],
  per: number,
  declared: (cell: TableCell) => Box = (cell) => cell.parents[0][1],
) {
  const files = new Map<string, Uint8Array>();
  const write = (body: object, box: Box) => {
    const json = JSON.stringify({ version: 4, ...body });
    const sha = hex(++serial, 64);
    files.set(`scene-page-${sha}.json`, new TextEncoder().encode(json));
    return { slot: `${sha}${hex(json.length, 8)}${box.map(f64).join('')}`, box };
  };
  const build = (from: number, to: number): { slot: string; box: Box } => {
    if (to - from <= per) {
      const list = cells.slice(from, to);
      return write({ cells: list, meshPages: [] }, union(list.map(declared)));
    }
    const middle = (from + to) >> 1;
    const halves = [build(from, middle), build(middle, to)];
    return write({ pages: halves.map((half) => half.slot) }, union(halves.map((h) => h.box)));
  };
  const totals = new Map<number, number>(),
    parents = new Set<number>();
  for (const cell of cells) {
    for (const [mesh, nodes] of cell.meshes) totals.set(mesh, (totals.get(mesh) ?? 0) + nodes);
    for (const [rank] of cell.parents) if (rank !== null) parents.add(rank);
  }
  const root = {
    version: 4,
    pages: [build(0, cells.length).slot, ...Array<string>(7).fill('0'.repeat(168))],
    meshes: [...totals].sort(([a], [b]) => a - b).map(([m, n]) => hex(m, 8) + hex(n, 8)),
    parents: [...parents].sort((a, b) => a - b).map((rank) => hex(rank, 8)),
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
