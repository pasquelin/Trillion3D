import { boxUnion } from '../../../sdk-core/src/index.ts';

/** Grows the box `target` holds at offset zero by a world box stored flat, min then max. */
export function unionBoxInto(target: Float64Array, box: ArrayLike<number>) {
  boxUnion(target, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
}
