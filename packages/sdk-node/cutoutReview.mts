import { basename } from 'node:path';
import type { BatchJob } from './contracts.ts';
import {
  answerSheet,
  pendingOf,
  readSheet,
  type PendingCutout,
  type Sheet,
} from './cutoutSheet.mts';
import { embeddedImages, readThumbnails, type Thumbnail } from './cutoutThumb.mts';
import { LEGENDE, pictureOf, show } from './cutoutShow.mts';
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

function nameOf(job: BatchJob): string {
  return job.id ?? basename(job.cache);
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
  for (const ligne of LEGENDE) stream.write(`${ligne}\n`);
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
  const scope = options.scope ?? 'full';
  const thumbnails = new Map<string, Thumbnail>();
  const embedded = new Map<string, (view: number) => Buffer | null>();
  for (const [name, one] of loaded) {
    for (const [sha, thumbnail] of await readThumbnails(one.job.cache, scope))
      if (!thumbnails.has(sha)) thumbnails.set(sha, thumbnail);
    embedded.set(name, await embeddedImages(one.job.cache, scope));
  }
  const answers = new Map<string, boolean>();
  let rest = false;
  for (const [index, one] of pending.entries()) {
    if (rest) {
      answers.set(one.sha256, one.proposal);
      continue;
    }
    const model = one.models[0] ?? '';
    const job = loaded.get(model)?.job;
    const thumbnail = thumbnails.get(one.sha256);
    const picture = job
      ? await pictureOf(job, one, thumbnail, embedded.get(model) ?? (() => null))
      : null;
    await show(stream, one, `${index + 1}/${pending.length}`, thumbnail, picture);
    let answer = await askAnswer(one.proposal, options.input ?? process.stdin);
    // Le rappel ne répond pas à la place de personne : il réaffiche la règle et repose la question.
    while (answer === 'help') {
      for (const ligne of LEGENDE) stream.write(`${ligne}\n`);
      answer = await askAnswer(one.proposal, options.input ?? process.stdin);
    }
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
