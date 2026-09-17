import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import type { BatchJob } from './contracts.ts';
import type { PendingCutout } from './cutoutSheet.mts';
import { alphaOf, type Thumbnail } from './cutoutThumb.mts';
import { drawFile, drawThumbnail, imageKind, link } from './cutoutDraw.mts';
import { encodePng } from './cutoutPng.mts';

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
 * One cutout question on screen: what it looks like, what it measures, and where to see it whole.
 *
 * Kept apart from the pass that asks, because these are two different jobs — deciding what to show
 * is not deciding what to do with the answer — and because a panel in an application will want the
 * same facts arranged its own way.
 */
/**
 * The picture to show and to offer, sharpest first: the texture's own file when the scene links one,
 * its own bytes drawn back out of the compiled scene when it embeds them instead, and only failing
 * both, the cache's 64-pixel thumbnail written out as an image. Whatever the source, the caller ends
 * up with one path — one to draw, one to open.
 */
export async function pictureOf(
  job: BatchJob,
  pending: PendingCutout,
  thumbnail: Thumbnail | undefined,
  embedded: (view: number) => Buffer | null,
): Promise<string | null> {
  const source = join(dirname(job.source), pending.image);
  if (
    await access(source).then(
      () => true,
      () => false,
    )
  )
    return source;
  const own =
    thumbnail?.sourceBufferView === undefined ? null : embedded(thumbnail.sourceBufferView);
  if (!own && !thumbnail) return null;
  const directory = join(job.cache, 'decoupes');
  await mkdir(directory, { recursive: true });
  const target = join(directory, `${pending.sha256.slice(0, 16)}.png`);
  await writeFile(target, own ?? encodePng(thumbnail!.width, thumbnail!.height, thumbnail!.rgba));
  return target;
}

/**
 * One texture on screen: the picture, its alpha, its numbers, and where to open it in full.
 *
 * The colour picture is the texture's own file when it is one — the terminal scales it into the box
 * itself, so what you judge is the real thing, not a 64-pixel echo. The alpha can only come from
 * the cache's thumbnail: it has to be computed from texels, and the file's are not decoded here.
 */
export async function show(
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
    const file = picture ? await readFile(picture).catch(() => null) : null;
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
