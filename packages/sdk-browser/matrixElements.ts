import { IDENTITY_MATRIX4, copyMatrix4 } from '../sdk-core/index.ts';

/**
 * Matrix sixteen floats, compared or copied: knowing if view moved, or if requested
 * pose is the one node already holds. Every caller wrote its own loop; they all read
 * the same arithmetic, float by float without tolerance.
 */
export function sameElements(held: ArrayLike<number>, now: ArrayLike<number>, heldAt = 0) {
  for (let i = 0; i < 16; i++) if (held[heldAt + i] !== now[i]) return false;
  return true;
}

/**
 * In both directions: HOST matrix copied into owned buffer, or core result set
 * into HOST matrix. Core only computes in `Float64Array` — single buffer type for
 * product and inverse (`mathMatrix4.ts`) — and host library matrices are plain arrays:
 * result destined for host is composed separately then copied here.
 */
export function copyElements(into: { [index: number]: number }, from: ArrayLike<number>) {
  copyMatrix4(into, from);
}

/**
 * Column-major 4×4 matrix owned by HOST — pose of a node in its scene. Engine only reads
 * its sixteen floats: no host library structure crosses a signature.
 */
export type MatrixElements = { readonly elements: ArrayLike<number> };

/**
 * The same sixteen floats, WRITABLE term by term: the pose a boundary sets back on a host node
 * or on a host camera it restores. It is the mutable face of `MatrixElements` and lives beside
 * it; nothing asks the host to compose them — `copyElements` writes them as they stand.
 */
export type HostNodeMatrix = {
  readonly elements: { [index: number]: number; readonly length: number };
};

export { IDENTITY_MATRIX4 as IDENTITY_ELEMENTS };
