import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import type { CutoutModel, CutoutReviewOptions } from './cutoutContracts.ts';
import type { PendingCutout } from './cutoutSheet.mts';
import { alphaOf, embeddedImages, type EmbeddedImages, type Thumbnail } from './cutoutThumb.mts';
import { drawFile, drawThumbnail, link, type ImageKind } from './cutoutDraw.mts';
import { encodePng } from './png.mts';

/**
 * What the two words mean, recalled before the first question and on demand.
 *
 * Nobody decides blind: the person answering did not work on this batch, and "cutout or blend"
 * means nothing on its own. The rule fits in four lines, and the last is the one that counts —
 * when in doubt, the answer that changes nothing exists.
 */
export const LEGENDE = [
  '  A CUTOUT is present or absent at every point — leaf, grille, branch:',
  '  in the black-and-white picture, almost everything is white or black; grey follows only the edge.',
  '  A BLEND lets light through everywhere: it is grey across its whole surface.',
  '  When in doubt, answer blend: nothing changes.',
];

/**
 * The picture to show and to offer, sharpest first: the texture's own file when the scene links one,
 * its own bytes drawn back out of the compiled scene when it embeds them instead, and only failing
 * both, the cache's 64-pixel thumbnail written out as an image. Whatever the source, the caller ends
 * up with one path — one to draw, one to open.
 *
 * What has to be written lands in a scratch directory, not in the compiled model: a picture shown
 * to answer a question is not a product, and nothing in the cache's contract would ever sweep it.
 */
export async function pictureOf(
  model: CutoutModel,
  pending: PendingCutout,
  thumbnail: Thumbnail | undefined,
  embedded: EmbeddedImages,
): Promise<string | null> {
  const source = join(dirname(model.source), pending.image);
  if (
    await access(source).then(
      () => true,
      () => false,
    )
  )
    return source;
  // Image bytes are opened only for an EMBEDDED texture, never for a scene that links its files:
  // a model's `source.bin` weighs tens of megabytes.
  const own =
    thumbnail?.sourceBufferView === undefined ? null : await embeddedOf(model, thumbnail, embedded);
  const bytes = own ?? (thumbnail && encodePng(thumbnail.width, thumbnail.height, thumbnail.rgba));
  if (!bytes) return null;
  const directory = join(tmpdir(), 'web-geometry-decoupes');
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${pending.sha256.slice(0, 16)}.png`);
  await writeFile(target, bytes);
  return target;
}

async function embeddedOf(model: CutoutModel, thumbnail: Thumbnail, embedded: EmbeddedImages) {
  let images = embedded.get(model.cache);
  if (!images) {
    images = embeddedImages(model.cache, model.scope);
    embedded.set(model.cache, images);
  }
  return (await images)(thumbnail.sourceBufferView ?? -1);
}

/**
 * One texture on screen: the picture, its alpha, its numbers, and where to open it in full. Kept
 * apart from the pass that asks — deciding what to show is not deciding what to do with the answer,
 * and a panel in an application will want the same facts arranged its own way.
 *
 * The colour picture is the texture's own file when it is one — the terminal scales it into the box
 * itself, so what you judge is the real thing, not a 64-pixel echo. The alpha can only come from
 * the cache's thumbnail: it has to be computed from texels, and the file's are not decoded here.
 */
export async function show(
  stream: NonNullable<CutoutReviewOptions['stream']>,
  kind: ImageKind,
  rank: string,
  pending: PendingCutout,
  pictures: { thumbnail: Thumbnail | undefined; picture: string | null },
) {
  const { thumbnail, picture } = pictures;
  const measure = pending.measure;
  const facts = [
    `${measure.betweenPercent ?? '?'} % of pixels between the two, of which ${measure.atContourPercent ?? '?'} % at the edge`,
    `${measure.absentPercent ?? '?'} % empty · ${pending.blendPrimitives} blended primitive(s)`,
    `${pending.models.join(', ')}`,
    `proposal: ${pending.proposal ? 'CUTOUT' : 'BLEND'}`,
  ];
  stream.write(`\n  ${rank}  ${basename(pending.image)}\n`);
  if (thumbnail) {
    // A terminal without an image protocol cannot use these bytes: they are not read.
    const file = picture && kind !== 'blocks' ? await readFile(picture).catch(() => null) : null;
    const colour = (file && drawFile(file, kind)) ?? drawThumbnail(thumbnail, kind);
    const alpha = drawThumbnail(alphaOf(thumbnail), kind);
    for (let row = 0; row < Math.max(colour.length, alpha.length); row++)
      stream.write(`  ${colour[row] ?? ''}  ${alpha[row] ?? ''}\n`);
  }
  for (const fact of facts) stream.write(`    ${fact}\n`);
  if (picture) stream.write(`    ${link('view full size', picture)}\n`);
  stream.write(
    '    [Enter] accept   [d] cutout   [v] blend   [t] accept remaining   [?] reminder   [q] quit\n',
  );
}

/**
 * The keys that answer one cutout question, read one press at a time.
 *
 * Enter takes the compiler's proposal, which is what makes a long list short: a pass over sixteen
 * textures is sixteen presses when the measure has them right, and a detour only where it does not.
 */
export type Answer = 'cutout' | 'blend' | 'rest' | 'help' | 'quit';

/** One key, without an Enter to validate it, with the terminal left exactly as it was found. */
async function keypress(input: NodeJS.ReadStream = process.stdin): Promise<string> {
  const wasRaw = input.isRaw;
  input.setRawMode?.(true);
  input.resume();
  try {
    return await new Promise<string>((resolve) => {
      const onData = (data: Buffer) => {
        input.off('data', onData);
        resolve(data.toString('utf8'));
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode?.(wasRaw ?? false);
    input.pause();
  }
}

/** What a key means. An unknown key means nothing, and the caller asks again. */
export function answerOf(key: string, proposal: boolean): Answer | null {
  if (key === '\r' || key === '\n' || key === ' ') return proposal ? 'cutout' : 'blend';
  if (key === 'd' || key === 'D') return 'cutout';
  if (key === 'v' || key === 'V') return 'blend';
  if (key === 't' || key === 'T') return 'rest';
  if (key === '?' || key === 'h' || key === 'H') return 'help';
  // Ctrl-C and Escape stop the pass; what was already answered is kept.
  if (key === 'q' || key === 'Q' || key === '' || key === '') return 'quit';
  return null;
}

/** Asks until a key means something. */
export async function askAnswer(
  proposal: boolean,
  input: NodeJS.ReadStream = process.stdin,
): Promise<Answer> {
  for (;;) {
    const answer = answerOf(await keypress(input), proposal);
    if (answer) return answer;
  }
}
