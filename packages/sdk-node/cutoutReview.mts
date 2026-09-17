import { basename } from 'node:path';
import type { CutoutModel, CutoutReviewOptions, CutoutReviewSummary } from './contracts.ts';
import {
  answerSheet,
  pendingOf,
  readSheet,
  type PendingCutout,
  type Sheet,
} from './cutoutSheet.mts';
import { imageKind } from './cutoutDraw.mts';
import { readThumbnails, type Thumbnail } from './cutoutThumb.mts';
import { askAnswer, LEGENDE, pictureOf, show } from './cutoutShow.mts';

/**
 * The cutout questions of a whole batch, asked once and applied everywhere.
 *
 * A batch of one is still a batch: the same path serves a single import and nine of them. Answers
 * are keyed by the image's bytes, so a leaf shared by two scenes is shown once and answered once,
 * and the answer lands in every sheet that knows it.
 *
 * The pass asks and writes; it does NOT compile. It names the models an answer moved and hands them
 * back — the caller owns the budget, the progress line and the cancellation, and is the only one
 * able to compile them the way it compiled them the first time.
 *
 * Nobody is asked anything when the output is not a terminal: the pending textures are listed and
 * the run ends, which is what a log, a pipe or an automated chain wants.
 */
interface Loaded {
  model: CutoutModel;
  name: string;
  sheet: Sheet;
}

function nameOf(model: CutoutModel): string {
  return model.id ?? basename(model.cache);
}

/** Reads every sheet of the batch; a model with no sheet simply has nothing to answer. */
async function sheetsOf(models: CutoutModel[]): Promise<Loaded[]> {
  const loaded: Loaded[] = [];
  for (const model of models) {
    const sheet = await readSheet(model.cache);
    if (sheet) loaded.push({ model, name: nameOf(model), sheet });
  }
  return loaded;
}

export async function reviewCutouts(
  models: CutoutModel[],
  options: CutoutReviewOptions = {},
): Promise<CutoutReviewSummary> {
  const stream = options.stream ?? process.stderr;
  const loaded = await sheetsOf(models);
  const pending = pendingOf(loaded);
  if (pending.length === 0) return { pending: 0, answered: 0, changed: [] };
  const named = new Set(pending.flatMap((one) => one.models));
  stream.write(`\n${pending.length} texture(s) à trancher sur ${named.size} modèle(s)\n`);
  if (!(options.interactive ?? Boolean(stream.isTTY))) {
    for (const one of pending)
      stream.write(
        `  ${basename(one.image)} · proposition ${one.proposal ? 'découpe' : 'vitre'} · ${one.models.join(', ')}\n`,
      );
    stream.write('  Répondez depuis un terminal, ou éditez la feuille de réponses à la main.\n');
    return { pending: pending.length, answered: 0, changed: [] };
  }
  for (const ligne of LEGENDE) stream.write(`${ligne}\n`);
  // Seuls les modèles qui ont quelque chose à trancher sont ouverts : les autres n'ont aucune image
  // à montrer, et leur produit compilé pèse des dizaines de mégaoctets.
  const concerned = loaded.filter((one) => named.has(one.name));
  const answers = await ask(stream, options, concerned, pending);
  const changed: CutoutModel[] = [];
  for (const one of loaded)
    if (await answerSheet(one.model.cache, one.sheet, answers)) changed.push(one.model);
  const cutouts = [...answers.values()].filter(Boolean).length;
  stream.write(
    `\n  ${cutouts} découpe(s), ${answers.size - cutouts} vitre(s) · ${changed.length} modèle(s) à recompiler\n`,
  );
  return { pending: pending.length, answered: answers.size, changed };
}

/** The thumbnails of the concerned models, by image: a texture two models share is read once. */
async function thumbnailsOf(concerned: Loaded[]): Promise<Map<string, Thumbnail>> {
  const thumbnails = new Map<string, Thumbnail>();
  for (const one of concerned)
    for (const [sha, thumbnail] of await readThumbnails(one.model.cache, one.model.scope))
      if (!thumbnails.has(sha)) thumbnails.set(sha, thumbnail);
  return thumbnails;
}

/** The pass itself: one question per texture, until an answer or a stop. */
async function ask(
  stream: NonNullable<CutoutReviewOptions['stream']>,
  options: CutoutReviewOptions,
  concerned: Loaded[],
  pending: PendingCutout[],
): Promise<Map<string, boolean>> {
  // La capacité du terminal est résolue une fois, comme le flux : elle ne change pas d'une question
  // à l'autre, et la résoudre au fond de la pile cacherait une décision d'entrée.
  const kind = imageKind();
  const owners = new Map(concerned.map((one) => [one.name, one.model]));
  const thumbnails = await thumbnailsOf(concerned);
  const answers = new Map<string, boolean>();
  for (const [index, one] of pending.entries()) {
    const owner = owners.get(one.models[0] ?? '');
    const thumbnail = thumbnails.get(one.sha256);
    const picture = owner ? await pictureOf(owner, one, thumbnail) : null;
    await show(stream, kind, `${index + 1}/${pending.length}`, one, { thumbnail, picture });
    let answer = await askAnswer(one.proposal, options.input ?? process.stdin);
    // Le rappel ne répond pas à la place de personne : il réaffiche la règle et repose la question.
    while (answer === 'help') {
      for (const ligne of LEGENDE) stream.write(`${ligne}\n`);
      answer = await askAnswer(one.proposal, options.input ?? process.stdin);
    }
    if (answer === 'quit') break;
    if (answer === 'rest') {
      for (const left of pending.slice(index)) answers.set(left.sha256, left.proposal);
      break;
    }
    answers.set(one.sha256, answer === 'cutout');
  }
  return answers;
}
