import { Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts';

/** `skeleton`'s palette writes, counted; the skeleton writes through the prototype. */
export function counted(skeleton: Skeleton) {
  const count = { writes: 0 };
  skeleton.palette = (...args) => (
    count.writes++,
    Skeleton.prototype.palette.apply(skeleton, args)
  );
  return count;
}
