// Image deltas between the harness's captures, for `bench.ts`. A black capture compares equal to
// any other black capture: it is refused by name, never counted as 0 px (#1016).
import { compareImages } from '../../../packages/sdk-core/src/index.ts';
import type { Capture } from '../../../tests/kit/server/staticServer.ts';
import { flipMap } from './flip.ts';
import type { ImageDiff, Report } from '../report/types.ts';

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

/** The mean and the 99.9th percentile of the colour channels' errors, in 1/255 steps: what a
 *  resampled image is held to against the native one (#816), where a pixel count says nothing. */
function channelErrors(a: Uint8Array, b: Uint8Array) {
  const counts = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if ((i & 3) === 3) continue;
    const error = Math.abs(a[i] - b[i]);
    counts[error]++;
    sum += error;
  }
  const channels = (a.length / 4) * 3;
  let p999 = 0,
    seen = counts[0];
  while (seen < channels * 0.999) seen += counts[++p999];
  return { meanChannel: sum / channels, p999Channel: p999 };
}

/** Delta between two RGBA captures: different pixels, maximum, mean and 99.9th-percentile error
 *  on a channel. */
export function imageDiff(a: Capture | undefined, b: Capture | undefined): ImageDiff {
  if (!a || !b) return null;
  if (a.w !== b.w || a.h !== b.h) return { error: `different sizes ${a.w}×${a.h} / ${b.w}×${b.h}` };
  if (black(a) || black(b)) return { error: 'black capture, RGB 0 everywhere' };
  const diff = compareImages(a.body, b.body);
  return {
    pixels: diff.differentPixels,
    maxChannel: diff.maxChannelError,
    ...channelErrors(a.body, b.body),
    total: a.w * a.h,
  };
}

/** An `ImageDiff` against a named reference image, with its mean LDR-FLIP error in [0, 1]. */
export type ReferenceDiff =
  | Exclude<ImageDiff, { pixels: number }>
  | (Extract<ImageDiff, { pixels: number }> & { reference: string; flipMean: number });

/** A rendering technique's bound against its named reference image (CONTRIBUTING.md, "Image and
 *  fidelity", class 2): the channel errors of `imageDiff` plus the mean LDR-FLIP error. */
export function referenceDiff(
  reference: { name: string; capture: Capture | undefined },
  test: Capture | undefined,
): ReferenceDiff {
  const { capture } = reference;
  if (!capture || !test) return null;
  const diff = imageDiff(capture, test);
  if (!diff || 'error' in diff) return diff;
  const map = flipMap(capture.body, test.body, test.w, test.h);
  return {
    ...diff,
    reference: reference.name,
    flipMean: map.reduce((s, e) => s + e, 0) / map.length,
  };
}
