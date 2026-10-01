/**
 * The world roots' records (docs/FORMAT.md, World super-roots; #1232): `world-roots.table` and
 * `world-roots.dag`, read straight from their bytes, as the cook writes them
 * (`compiler_world_roots/records.rs`). Never one string of the whole world, which a JavaScript
 * engine refuses past 512 MiB: the open world's table weighed 866 MiB as JSON. A record is read at
 * its rank when asked, as a page is viewed in its bundle; only the bundles, a few thousand, are
 * read whole. A file that breaks its contract is refused whole, `INVALID_CACHE`.
 */
import type { ClusterGroup } from '../contracts/geometry.ts';
import {
  WORLD_ROOTS_BIN,
  refuseWorldRoots as refuse,
  type WorldRoots,
  type WorldRootsCluster,
} from './worldRoots.ts';

/** The products' version this reader knows: another is refused. */
const VERSION = 2;
/** Bytes of each header and record (`records.rs`). */
const [TABLE_HEADER, BUNDLE, PAGE, CELL, OBJECT] = [80, 56, 24, 8, 24];
const [DAG_HEADER, CLUSTER, GROUP] = [24, 152, 64];
/** An index word naming nothing. */
const NONE = 0xffffffff;

/** `bytes`' view, its `u32` words, and its pool from where `poolAt` reads it starts. */
function opened(
  bytes: Uint8Array,
  magic: string,
  poolAt: (word: (at: number) => number) => number,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (at: number) => view.getUint32(at, true);
  if (bytes.byteLength < DAG_HEADER || String.fromCharCode(...bytes.subarray(0, 4)) !== magic)
    refuse(`not a ${magic} file`);
  if (word(4) !== VERSION) refuse(`version ${word(4)}`);
  const at = poolAt(word);
  const words = (bytes.byteLength - at) / 4;
  if (!(words >= 0) || !Number.isInteger(words)) refuse(`${magic} is not its records' length`);
  // Aligned it is viewed in place; a caller's unaligned view is copied once.
  const pool =
    (bytes.byteOffset + at) % 4 === 0
      ? new Uint32Array(bytes.buffer, bytes.byteOffset + at, words)
      : new Uint32Array(bytes.slice(at).buffer);
  /** The list a record names at `at`: its first word and its length, inside the pool. */
  const list = (at: number) => {
    const first = word(at),
      count = word(at + 4);
    if (first + count > pool.length) refuse(`a list at ${at} past the pool`);
    return pool.subarray(first, first + count);
  };
  return { view, word, pool, list };
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const below = (values: Uint32Array, end: number) => values.every((value) => value < end);

/**
 * `bytes` as a world-roots table, or `INVALID_CACHE`: its magic and version, its records filling
 * it, its bundles laid end to end from the binary's start, the pinned top's bytes the sum of its
 * first `pinned` bundles, and every dependency naming a bundle of the table.
 */
export function readWorldRoots(bytes: Uint8Array): WorldRoots {
  const { view, word, list } = opened(bytes, 'WRTB', (w) => {
    const counts = [w(20), w(24), w(28), w(32)];
    const records = counts[0] * BUNDLE + counts[1] * PAGE + counts[2] * CELL + counts[3] * OBJECT;
    if (TABLE_HEADER + records + w(36) * 4 !== bytes.byteLength) refuse('table length');
    return TABLE_HEADER + records;
  });
  const [pinned, pinnedTopBytes, bundleCount, pageCount, cellCount, objectCount] = [
    12, 16, 20, 24, 28, 32,
  ].map(word);
  const pagesAt = TABLE_HEADER + bundleCount * BUNDLE,
    cellsAt = pagesAt + pageCount * PAGE,
    objectsAt = cellsAt + cellCount * CELL;
  let end = 0;
  const bundles = Array.from({ length: bundleCount }, (_, rank) => {
    const at = TABLE_HEADER + rank * BUNDLE,
      dependencies = list(at + 16);
    if (word(at) + word(at + 4) * 2 ** 32 !== end) refuse(`bundle ${rank} is not the next range`);
    if (!below(dependencies, bundleCount)) refuse(`bundle ${rank} dependencies`);
    const offset = end;
    end += word(at + 8);
    const sha256 = hex(bytes.subarray(at + 24, at + BUNDLE));
    return {
      offset,
      bytes: word(at + 8),
      sha256,
      count: word(at + 12),
      dependencies: [...dependencies],
    };
  });
  if (pinned < 1 || pinned > bundleCount) refuse(`pinned ${pinned}`);
  const payloadBytes = word(40) + word(44) * 2 ** 32;
  if (payloadBytes !== end) refuse('payload');
  const top = bundles.slice(0, pinned).reduce((sum, bundle) => sum + bundle.bytes, 0);
  if (pinnedTopBytes !== top) refuse('pinnedTopBytes');
  let next = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (word(cellsAt + cell * CELL) !== next) refuse(`cell ${cell} objects`);
    next += word(cellsAt + cell * CELL + 4);
  }
  if (next !== objectCount) refuse('cells and objects');
  for (let object = 0; object < objectCount; object++)
    if (!below(list(objectsAt + object * OBJECT + 16), bundleCount)) refuse('object dependencies');
  const objectAt = (object: number) => {
    const at = objectsAt + object * OBJECT;
    const [roots, dependencies] = [list(at + 8), list(at + 16)].map((v) => Array.from(v));
    return { node: word(at), primitive: word(at + 4), roots, dependencies };
  };
  return {
    version: VERSION,
    budgetBytes: word(8),
    pinned,
    pinnedTopBytes,
    payload: { url: WORLD_ROOTS_BIN, sha256: hex(bytes.subarray(48, 80)), bytes: payloadBytes },
    bundles,
    pages: {
      count: pageCount,
      at(page) {
        const at = pagesAt + page * PAGE;
        const [bundle, offset, level] = [word(at), word(at + 4), word(at + 8)];
        return { bundle, offset, level, lodError: view.getFloat64(at + 16, true) };
      },
    },
    cells: {
      count: cellCount,
      objects(cell) {
        const first = word(cellsAt + cell * CELL);
        return Array.from({ length: word(cellsAt + cell * CELL + 4) }, (_, i) =>
          objectAt(first + i),
        );
      },
    },
  };
}

/**
 * `bytes` as the world DAG, or `INVALID_CACHE`: every world cluster in the cook's rank, in the
 * shape the world stream reads (`WorldRootsCluster`), and the group list, its children and outputs
 * naming clusters of the DAG.
 */
export function readWorldRootsDag(bytes: Uint8Array) {
  const { view, word, list } = opened(bytes, 'WRTD', (w) => {
    if (DAG_HEADER + w(8) * CLUSTER + w(12) * GROUP + w(16) * 4 !== bytes.byteLength)
      refuse('DAG length');
    return DAG_HEADER + w(8) * CLUSTER + w(12) * GROUP;
  });
  const clusterCount = word(8);
  const floats = (at: number, count: number) =>
    Array.from({ length: count }, (_, i) => view.getFloat64(at + i * 8, true));
  const named = (at: number) => (word(at) === NONE ? null : word(at));
  const clusters: WorldRootsCluster[] = Array.from({ length: clusterCount }, (_, cluster) => {
    const at = DAG_HEADER + cluster * CLUSTER,
      parentError = view.getFloat64(at + 32, true),
      parentSphere = floats(at + 72, 4);
    return {
      cluster,
      level: word(at),
      lodError: view.getFloat64(at + 24, true),
      sphere: floats(at + 40, 4),
      parentError: Number.isNaN(parentError) ? null : parentError,
      parentSphere: Number.isNaN(parentSphere[0]) ? null : parentSphere,
      min: floats(at + 104, 3),
      max: floats(at + 128, 3),
      triangles: word(at + 4),
      material: named(at + 8),
      bundle: named(at + 12),
      offset: named(at + 16),
      origin: named(at + 20),
    };
  });
  const groupsAt = DAG_HEADER + clusterCount * CLUSTER;
  const groups: ClusterGroup[] = Array.from({ length: word(12) }, (_, group) => {
    const at = groupsAt + group * GROUP;
    const [children, outputs] = [list(at + 4), list(at + 12)];
    if (!below(children, clusterCount) || !below(outputs, clusterCount)) refuse(`group ${group}`);
    const [error, ...sphere] = floats(at + 24, 5);
    return { level: word(at), error, sphere, children: [...children], outputs: [...outputs] };
  });
  return { clusters, groups };
}
