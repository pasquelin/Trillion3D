import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import type { BatchJob } from './contracts.ts';
import {
  answerSheet,
  pendingOf,
  readSheet,
  type PendingCutout,
  type Sheet,
} from './cutoutSheet.mts';
import { alphaOf, readThumbnails, type Thumbnail } from './cutoutThumb.mts';
import { drawThumbnail, imageKind, link } from './cutoutDraw.mts';
import { encodePng } from './cutoutPng.mts';
import { askAnswer } from './cutoutAsk.mts';

/**
 * The cutout questions of a whole batch, asked once and applied everywhere.
 *
 * A batch of one is still a batch: the same path serves a single import and nine of them. Answers
 * are keyed by the image's bytes, so a leaf shared by two scenes is shown once and answered once,
 * and the answer lands in every sheet that knows it. Only the models an answer changed are compiled
 * again — the rest are already right.
 *
 * Nobody is asked anything when the output is not a terminal: the pending textures are listed and
 * the run ends, which is what a log, a pipe or an automated chain wants.
 */
export interface CutoutReviewOptions {
  scope?: string;
  stream?: NodeJS.WriteStream;
  input?: NodeJS.ReadStream;
  /** Defaults to whether the stream is a terminal. */
  interactive?: boolean;
  /** How to compile the models an answer changed; `prepareMany` when left out. */
  rerun?: (jobs: BatchJob[]) => Promise<unknown>;
}

export interface CutoutReviewSummary {
  pending: number;
  answered: number;
  recompiled: string[];
}

const CELLS = 10;

function nameOf(job: BatchJob): string {
  return job.id ?? basename(job.cache);
}

/** The picture to offer: the source texture at full size when it is a file, the thumbnail when the
 *  image was embedded in the scene and has no file of its own. */
async function pictureOf(
  job: BatchJob,
  pending: PendingCutout,
  thumbnail: Thumbnail | undefined,
): Promise<string | null> {
  const source = join(dirname(job.source), pending.image);
  if (
    await access(source).then(
      () => true,
      () => false,
    )
  )
    return source;
  if (!thumbnail) return null;
  const directory = join(job.cache, 'decoupes');
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${pending.sha256.slice(0, 16)}.png`);
  await writeFile(target, encodePng(thumbnail.width, thumbnail.height, thumbnail.rgba));
  return target;
}

/** One texture on screen: its two pictures side by side, its numbers, and where to see it bigger. */
function show(
  stream: NodeJS.WriteStream,
  pending: PendingCutout,
  rank: string,
  thumbnail: Thumbnail | undefined,
  picture: string | null,
) {
  const kind = imageKind();
  const measure = pending.measure;
  const facts = [
    `${measure.betweenPercent ?? '?'} % de pixels entre les deux, dont ${measure.atContourPercent ?? '?'} % au bord`,
    `${measure.absentPercent ?? '?'} % de vide · ${pending.blendPrimitives} primitive(s) en mélange`,
    `${pending.models.join(', ')}`,
    `proposition : ${pending.proposal ? 'DÉCOUPE' : 'VITRE'}`,
  ];
  stream.write(`\n  ${rank}  ${basename(pending.image)}\n`);
  if (thumbnail) {
    const colour = drawThumbnail(thumbnail, CELLS, kind);
    const alpha = drawThumbnail(alphaOf(thumbnail), CELLS, kind);
    for (let row = 0; row < Math.max(colour.length, alpha.length); row++)
      stream.write(`  ${colour[row] ?? ''}  ${alpha[row] ?? ''}\n`);
  }
  for (const fact of facts) stream.write(`    ${fact}\n`);
  if (picture) stream.write(`    ${link('voir en grand', picture)}\n`);
  stream.write(
    '    [Entrée] accepter   [d] découpe   [v] vitre   [t] tout accepter   [q] arrêter\n',
  );
}

/** Reads every sheet of the batch; a model with no sheet simply has nothing to answer. */
async function sheetsOf(jobs: BatchJob[]): Promise<Map<string, { job: BatchJob; sheet: Sheet }>> {
  const sheets = new Map<string, { job: BatchJob; sheet: Sheet }>();
  for (const job of jobs) {
    const sheet = await readSheet(job.cache);
    if (sheet) sheets.set(nameOf(job), { job, sheet });
  }
  return sheets;
}

export async function reviewCutouts(
  jobs: BatchJob[],
  options: CutoutReviewOptions = {},
): Promise<CutoutReviewSummary> {
  const stream = options.stream ?? process.stderr;
  const loaded = await sheetsOf(jobs);
  const pending = pendingOf(new Map([...loaded].map(([id, one]) => [id, one.sheet])));
  if (pending.length === 0) return { pending: 0, answered: 0, recompiled: [] };
  const interactive = options.interactive ?? Boolean(stream.isTTY);
  stream.write(
    `\n${pending.length} texture(s) à trancher sur ${new Set(pending.flatMap((one) => one.models)).size} modèle(s)\n`,
  );
  if (!interactive) {
    for (const one of pending)
      stream.write(
        `  ${basename(one.image)} · proposition ${one.proposal ? 'découpe' : 'vitre'} · ${one.models.join(', ')}\n`,
      );
    stream.write('  Répondez depuis un terminal, ou éditez decoupes.json à la main.\n');
    return { pending: pending.length, answered: 0, recompiled: [] };
  }
  const answers = await ask(stream, options, loaded, pending);
  return await apply(stream, options, loaded, pending, answers);
}

/** The pass itself: one question per texture, until an answer or a stop. */
async function ask(
  stream: NodeJS.WriteStream,
  options: CutoutReviewOptions,
  loaded: Map<string, { job: BatchJob; sheet: Sheet }>,
  pending: PendingCutout[],
): Promise<Map<string, boolean>> {
  const thumbnails = new Map<string, Thumbnail>();
  for (const [, one] of loaded)
    for (const [sha, thumbnail] of await readThumbnails(one.job.cache, options.scope ?? 'full'))
      if (!thumbnails.has(sha)) thumbnails.set(sha, thumbnail);
  const answers = new Map<string, boolean>();
  let rest = false;
  for (const [index, one] of pending.entries()) {
    if (rest) {
      answers.set(one.sha256, one.proposal);
      continue;
    }
    const job = loaded.get(one.models[0] ?? '')?.job;
    const thumbnail = thumbnails.get(one.sha256);
    const picture = job ? await pictureOf(job, one, thumbnail) : null;
    show(stream, one, `${index + 1}/${pending.length}`, thumbnail, picture);
    const answer = await askAnswer(one.proposal, options.input ?? process.stdin);
    if (answer === 'quit') break;
    if (answer === 'rest') {
      rest = true;
      answers.set(one.sha256, one.proposal);
      continue;
    }
    answers.set(one.sha256, answer === 'cutout');
  }
  return answers;
}

/** Writes the answers, compiles the models they changed, and says what happened. */
async function apply(
  stream: NodeJS.WriteStream,
  options: CutoutReviewOptions,
  loaded: Map<string, { job: BatchJob; sheet: Sheet }>,
  pending: PendingCutout[],
  answers: Map<string, boolean>,
): Promise<CutoutReviewSummary> {
  const changed: BatchJob[] = [];
  for (const [, one] of loaded)
    if (await answerSheet(one.job.cache, one.sheet, answers)) changed.push(one.job);
  const cutouts = [...answers.values()].filter(Boolean).length;
  stream.write(
    `\n  ${cutouts} découpe(s), ${answers.size - cutouts} vitre(s) · ${changed.length} modèle(s) à recompiler\n`,
  );
  if (changed.length > 0) {
    const rerun =
      options.rerun ??
      (async (list: BatchJob[]) => (await import('./index.mts')).prepareMany(list));
    await rerun(changed);
  }
  return {
    pending: pending.length,
    answered: answers.size,
    recompiled: changed.map(nameOf),
  };
}
