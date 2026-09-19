import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import type { CutoutModel, CutoutReviewOptions } from './contracts.ts';
import type { PendingCutout } from './cutoutSheet.mts';
import { alphaOf, embeddedImages, type Thumbnail } from './cutoutThumb.mts';
import { drawFile, drawThumbnail, encodePng, link, type ImageKind } from './cutoutDraw.mts';

/**
 * Ce que les deux mots veulent dire, rappelé avant la première question et à la demande.
 *
 * Personne ne tranche à l'aveugle : celui qui répond n'a pas travaillé sur ce lot, et « découpe ou
 * vitre » ne dit rien tout seul. La règle tient en quatre lignes, et la dernière est celle qui
 * compte — dans le doute, la réponse sans conséquence existe.
 */
export const LEGENDE = [
  '  Une DÉCOUPE est présente ou absente en chaque point — feuille, grillage, branche :',
  '  dans l’image en noir et blanc, presque tout est blanc ou noir, le gris ne suit que le bord.',
  '  Une VITRE laisse passer la lumière partout : elle est grise sur toute sa surface.',
  '  Dans le doute, répondez vitre : rien ne change.',
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
  embedded: EmbeddedImages = new Map(),
): Promise<string | null> {
  const source = join(dirname(model.source), pending.image);
  if (
    await access(source).then(
      () => true,
      () => false,
    )
  )
    return source;
  // Les octets de l'image ne sont ouverts que pour une texture EMBARQUÉE, donc jamais pour une
  // scène qui lie ses fichiers : le `source.bin` d'un modèle pèse des dizaines de mégaoctets.
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

/**
 * Les images embarquées des modèles d'une passe, par cache : ouvertes à la première question qui en
 * demande et pas avant, et rendues avec la passe — un `source.bin` pèse des dizaines de mégaoctets,
 * un hôte durable n'a pas à les garder d'un lot à l'autre.
 */
export type EmbeddedImages = Map<string, Promise<(view: number) => Buffer | null>>;
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
    `${measure.betweenPercent ?? '?'} % de pixels entre les deux, dont ${measure.atContourPercent ?? '?'} % au bord`,
    `${measure.absentPercent ?? '?'} % de vide · ${pending.blendPrimitives} primitive(s) en mélange`,
    `${pending.models.join(', ')}`,
    `proposition : ${pending.proposal ? 'DÉCOUPE' : 'VITRE'}`,
  ];
  stream.write(`\n  ${rank}  ${basename(pending.image)}\n`);
  if (thumbnail) {
    // Un terminal sans protocole d'image ne saurait rien faire de ces octets : ils ne sont pas lus.
    const file = picture && kind !== 'blocks' ? await readFile(picture).catch(() => null) : null;
    const colour = (file && drawFile(file, kind)) ?? drawThumbnail(thumbnail, kind);
    const alpha = drawThumbnail(alphaOf(thumbnail), kind);
    for (let row = 0; row < Math.max(colour.length, alpha.length); row++)
      stream.write(`  ${colour[row] ?? ''}  ${alpha[row] ?? ''}\n`);
  }
  for (const fact of facts) stream.write(`    ${fact}\n`);
  if (picture) stream.write(`    ${link('voir en grand', picture)}\n`);
  stream.write(
    '    [Entrée] accepter   [d] découpe   [v] vitre   [t] tout accepter   [?] rappel   [q] arrêter\n',
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
