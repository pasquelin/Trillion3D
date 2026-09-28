import type { Capture } from '../../tests/kit/server/staticServer.ts';

/** Pixel changes in the middle half of the view, where the frozen gaze looks. */
export function gazeDifferentPixels(a: Capture | undefined, b: Capture | undefined) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
  let different = 0;
  for (let y = Math.floor(a.h / 4); y < Math.ceil((a.h * 3) / 4); y++)
    for (let x = Math.floor(a.w / 4); x < Math.ceil((a.w * 3) / 4); x++) {
      const at = (y * a.w + x) * 4;
      if (
        a.body[at] !== b.body[at] ||
        a.body[at + 1] !== b.body[at + 1] ||
        a.body[at + 2] !== b.body[at + 2]
      )
        different++;
    }
  return different;
}
