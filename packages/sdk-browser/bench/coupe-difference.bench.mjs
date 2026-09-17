// Lot « coupe par différence » : les lecteurs de la coupe ne reparcourent plus la liste que le
// relevé publie. Référence = le code d'avant, recopié dans `oracles/coupe-difference.mjs`.
//
// Chaque tour est une IMAGE complète du chemin mesuré : les deux côtés appliquent la même différence
// (`delta.apply`, déjà là avant le lot et commune aux deux), puis l'un reparcourt la coupe et
// l'autre lit ses compteurs. Ce qui est chronométré est donc l'étape entière que l'image paie, la
// part commune comprise, et jamais le seul morceau qui change.
import { RequestStamps, collectPendingUrls } from '../pageSelection.ts';
import { createCutDelta } from '../webgpuCutDelta.ts';
import { createCutCounts } from '../webgpuCutCounts.ts';
import { createCutPending } from '../webgpuCutPending.ts';
import { createBudgetRanking } from '../webgpuBudgetRanking.ts';
import { compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import {
  createReferenceRanking,
  levelHistogram,
  referenceCutComplete,
  referenceCutCounts,
  referencePendingUrls,
} from './oracles/coupe-difference.mjs';

const alea = graine(97);
/** L'ordre de grandeur de la scène du banc : 160 000 grappes au catalogue, 20 000 dans la coupe. */
const PAGES = 160000,
  COUPE = 20000,
  NIVEAUX = 13;
// Le niveau appartient à la PAGE, pas au placement : deux placements d'une grappe sont la même
// grappe, au même niveau, dans une seule fente de cache.
const niveaux = new Int32Array(PAGES);
for (let k = 0; k < PAGES; k++) niveaux[k] = Math.floor(alea() * NIVEAUX);
const pages = [];
for (let i = 0; i < PAGES; i++)
  pages.push({
    url: `p${i >> 1}`,
    requestIndex: i >> 1,
    keyIndex: i >> 1,
    packedIndex: i,
    level: niveaux[i >> 1],
    triangles: 1 + Math.floor(alea() * 128),
    transparent: alea() < 0.1,
    // Une page sur deux cents attend encore ses octets, comme une traversée à cache tiède.
    array: alea() < 0.995 ? new Uint32Array(3) : undefined,
  });
const residentOffsetWords = new Int32Array(PAGES);
for (let i = 0; i < PAGES; i++) residentOffsetWords[i] = alea() < 0.99 ? i * 4 : -1;

/**
 * Trois régimes, huit images chacun, sur la même coupe de vingt mille grappes :
 *
 * - la caméra qui glisse : la fenêtre se décale de mille grappes par image, cinq pour cent de la
 *   coupe entre et sort — ce que coûte une navigation ordinaire ;
 * - la pose immobile : la carte republie la même suite, image après image ;
 * - le saut de caméra : la coupe est entièrement renouvelée à chaque image. C'est le pire cas d'une
 *   différence, et il est mesuré pour ce qu'il est.
 *
 * L'aller-retour du glissement referme la boucle : la première image d'un tour suit la dernière du
 * tour précédent, et le banc ne mesure pas un saut déguisé en glissement.
 */
const fenetre = (depart) => {
  const ids = [];
  for (let k = 0; k < COUPE; k++) ids.push((depart + k) % PAGES);
  ids.sort((a, b) => a - b);
  return ids;
};
const glisse = [0, 1000, 2000, 3000, 4000, 3000, 2000, 1000].map(fenetre);
const immobile = Array.from({ length: 8 }, () => glisse[0]);
const saut = Array.from({ length: 8 }, (_, image) => fenetre(image * 40000 + 7));

const regimes = [
  ['caméra qui glisse (5 % de la coupe)', glisse],
  ['pose immobile', immobile],
  ['saut de caméra (coupe renouvelée)', saut],
];
const casDe = (images) => [
  { nom: `8 images de ${COUPE} pages`, entree: images, taille: COUPE * 8 },
];

// Tout ce qui vit d'une image à l'autre est bâti UNE FOIS, des deux côtés : c'est ce que le moteur
// fait, et une allocation de cent soixante mille rangs par tour ne mesurerait que le ramasse-miettes.
// L'état des deux côtés persiste d'un tour au suivant ; leurs verdicts n'en dépendent pas — la
// référence recalcule tout à chaque image, et la différence rend les totaux de la coupe courante,
// quelle qu'ait été la précédente.
const stampsReference = new RequestStamps(PAGES),
  stampsOptimisee = new RequestStamps(PAGES);
const scratchReference = [],
  scratchOptimisee = [];
const desiredReference = [],
  deltaReference = createCutDelta(pages, desiredReference);
const desiredOptimisee = [],
  deltaOptimisee = createCutDelta(pages, desiredOptimisee);
const counts = createCutCounts(pages, residentOffsetWords, deltaOptimisee),
  pending = createCutPending(pages, deltaOptimisee);

const lecteursReference = (images) => {
  const desired = desiredReference,
    delta = deltaReference;
  const sortie = [];
  for (const ids of images) {
    delta.apply(ids);
    const totaux = referenceCutCounts(pages, ids, residentOffsetWords);
    const complete = referenceCutComplete(desired);
    const attendues = referencePendingUrls(desired, stampsReference, scratchReference);
    sortie.push({ totaux, complete, attendues: attendues.length });
  }
  return sortie;
};
const lecteursOptimisee = (images) => {
  const delta = deltaOptimisee;
  const sortie = [];
  for (const ids of images) {
    delta.apply(ids);
    const totaux = { ...counts.apply() };
    pending.apply();
    const complete = pending.count === 0;
    const attendues = collectPendingUrls(pending.records, scratchOptimisee, stampsOptimisee);
    sortie.push({ totaux, complete, attendues: attendues.length });
  }
  return sortie;
};

/** Le classement du budget : mêmes entrées et sorties des deux côtés — la coupe pesée, puis le
 *  préfixe résumé par ce que les deux versions doivent rendre identique, son nombre de pages par
 *  niveau. L'ordre interne d'un niveau n'est plus une promesse et n'est donc pas comparé. */
const ROOM = 6000;
const bootstrapKey = new Uint8Array(PAGES);
const keyOf = (page) => page.keyIndex;
const levelOfKey = new Int32Array(PAGES);
for (const page of pages) levelOfKey[page.keyIndex] = page.level;

const rankingReference = createReferenceRanking({ keyCount: PAGES, bootstrapKey, keyOf });
const ranking = createBudgetRanking({ keyCount: PAGES, bootstrapKey, keyOf });
const cutReference = [];
const deltaReferenceRang = createCutDelta(pages, cutReference),
  deltaRang = createCutDelta(pages);

/** Une image du classement : la différence entre et sort les pages pesées — ce que les deux
 *  versions font de la même façon —, puis le préfixe est écrit. */
const classement = (classeur, delta, cut) => (images) => {
  const sortie = [];
  for (const ids of images) {
    delta.apply(ids);
    const exited = delta.exitedCount,
      entered = delta.enteredCount;
    for (let i = 0; i < exited; i++) classeur.remove(pages[delta.exited[i]]);
    for (let i = 0; i < entered; i++) classeur.add(pages[delta.entered[i]]);
    const records = classeur.rank(ROOM, cut);
    sortie.push(
      records <= ROOM
        ? { length: 0, levels: [] }
        : {
            length: classeur.length,
            levels: levelHistogram(classeur.keys, classeur.length, levelOfKey),
          },
    );
  }
  return sortie;
};
const classementReference = classement(rankingReference, deltaReferenceRang, cutReference);
const classementOptimisee = classement(ranking, deltaRang, undefined);

const lignes = [];
for (const [regime, images] of regimes)
  lignes.push(
    await compare({
      calcul: `GEO-1 lecteurs de la coupe — ${regime}`,
      fichier: 'packages/sdk-browser/webgpuCutCounts.ts',
      cas: casDe(images),
      reference: lecteursReference,
      optimisee: lecteursOptimisee,
      options: { tours: 40, budgetMs: 3000, alterne: true },
    }),
  );
for (const [regime, images] of regimes)
  lignes.push(
    await compare({
      calcul: `GEO-1 classement du budget — ${regime}`,
      fichier: 'packages/sdk-browser/webgpuBudgetRanking.ts',
      cas: casDe(images),
      reference: classementReference,
      optimisee: classementOptimisee,
      options: { tours: 40, budgetMs: 3000, alterne: true },
    }),
  );

verifieEtDepose(
  'coupe-difference',
  'GEO-1 : les lecteurs de la coupe rendent les mêmes verdicts',
  lignes,
);
