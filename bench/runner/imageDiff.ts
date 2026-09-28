// Image deltas between the harness's captures, for `bench.ts`. A black capture compares equal to
// any other black capture: it is refused by name, never counted as 0 px (#1016).
import { compareImages } from '../../packages/sdk-core/src/index.ts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import type { ImageDiff, Report } from './report/types.ts';

/** True when no pixel carries light: RGB 0 everywhere, whatever the alpha. */
function black({ body }: NonNullable<Capture>) {
  for (let i = 0; i < body.length; i += 4) if (body[i] | body[i + 1] | body[i + 2]) return false;
  return true;
}

/** Refuses every entirely black capture by its file name: an error of the report, listed first so
 *  `resume.md`'s first 40 errors never hide it behind page noise. */
export function refuseBlackCaptures(
  errors: Report['errors'],
  captures: ReadonlyMap<string, Capture>,
) {
  const refused: Report['errors'] = [];
  for (const [file, capture] of captures)
    if (capture && black(capture))
      refused.push({ kind: 'black-capture', message: `${file}: RGB 0 everywhere` });
  errors.unshift(...refused);
}

/** Delta between two RGBA captures: different pixels and maximum error on a channel. */
export function imageDiff(a: Capture | undefined, b: Capture | undefined): ImageDiff {
  if (!a || !b) return null;
  if (a.w !== b.w || a.h !== b.h)
    return { erreur: `different sizes ${a.w}×${a.h} / ${b.w}×${b.h}` };
  if (black(a) || black(b)) return { erreur: 'black capture, RGB 0 everywhere' };
  const diff = compareImages(a.body, b.body);
  return { pixels: diff.differentPixels, maxCanal: diff.maxChannelError, total: a.w * a.h };
}
