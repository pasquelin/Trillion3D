// Les sections « performance » du rapport global, première moitié : les tuiles de tête et l'image
// entière par vue. Chaque graphe lit les relevés de
// `rapportGlobalLecture.mjs` et ne calcule rien d'autre que des sommes de p50 nommées comme telles.
import { barres, deuxCols, nombre, pixels, tableau, tuile } from './rapportGlobalGraphes.mjs';
import { LIBELLE, QUALITES, trouve, VUES } from './rapportGlobalLecture.mjs';
import { UNREAL } from './rapportGlobalChiffres.mjs';

/** Les tuiles de tête : les chiffres qu'on retient. */
export function tuiles(ex) {
  const sol = trouve(ex, 'mobile', 'sol', 1);
  const gen = trouve(ex, 'mobile', 'generale', 1);
  const fixe = trouve(ex, 'fixe', 'sol', 1);
  const pire = VUES.map((v) => trouve(ex, 'mobile', v, 1))
    .filter(Boolean)
    .sort((a, b) => (b.gpuP50 ?? 0) - (a.gpuP50 ?? 0))[0];
  return `<div class="tuiles">${[
    tuile(
      'Whole frame, GPU (street view, p50)',
      nombre(sol?.gpuP50, 1, 'ms'),
      `p95 ${nombre(sol?.gpuP95, 1, 'ms')} · 2496×1404, sun, moving camera`,
    ),
    tuile(
      'CPU per frame (street view, p50)',
      nombre(sol?.cpuP50, 2, 'ms'),
      `p95 ${nombre(sol?.cpuP95, 2, 'ms')} · the reference says “almost zero”`,
    ),
    tuile(
      'Most expensive view',
      pire ? `${LIBELLE[pire.vue]}: ${nombre(pire.gpuP50, 1, 'ms')}` : 'not measured',
      'GPU envelope p50, normal quality',
    ),
    tuile(
      'Selected triangles (overview)',
      nombre(gen?.triangles, 0),
      `the reference rasterizes ${nombre(UNREAL.trianglesParImage / 1e6, 0)} M per frame, fixed`,
    ),
    tuile(
      'Still scene',
      fixe
        ? fixe.gpuReleves === 0
          ? 'no GPU work'
          : `${fixe.gpuReleves} GPU samples`
        : 'not measured',
      fixe ? `CPU ${nombre(fixe.cpuP50, 2, 'ms')} per frame` : '',
    ),
  ].join('')}</div>`;
}

/** L'image entière par vue et par seuil : enveloppe carte graphique, processeur. */
export function sectionVues(ex) {
  const lignes = (champ) =>
    VUES.map((v) => ({
      libelle: LIBELLE[v],
      valeurs: [0, 1].map((s) => trouve(ex, 'mobile', v, s)?.[champ] ?? null),
    }));
  return [
    '<p>Moving camera, sun with shadow cascades, cooked textures, 2496×1404, 60 measured frames then 120 profile frames. “Quality”: error tolerated on screen — 0 px, the engine takes the finest geometry; 1 px, it allows one pixel of error, invisible, and draws less. The “close-up” view is a still segment of the path (two identical points): the frame is held and the GPU does nothing, even with a “moving” camera. Error threshold 0 asks for the finest geometry; threshold 1 allows one pixel of screen error. The “whole frame” is the GPU-pass envelope, first timestamp to last: passes overlap on this device, a sum would count them twice.</p>',
    deuxCols(
      barres({
        id: 'g-gpu-vues',
        titre: 'Whole frame, GPU, p50',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('gpuP50'),
      }),
      barres({
        id: 'g-gpu-vues-p95',
        titre: 'Whole frame, GPU, p95',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('gpuP95'),
      }),
    ),
    deuxCols(
      barres({
        id: 'g-cpu-vues',
        titre: 'CPU per frame, p50',
        sousTitre: 'cut, sample, residency, encode included',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('cpuP50'),
      }),
      barres({
        id: 'g-tri-vues',
        titre: 'Selected triangles',
        unite: 'triangles',
        decimales: 0,
        series: QUALITES,
        lignes: lignes('triangles'),
      }),
    ),
    tableau(
      [
        'View',
        'Quality',
        'Uncovered',
        'Draw calls',
        'Resident pages',
        'Hi-Z tested / rejected (clusters)',
        'A/A witness (px)',
        'Frame held',
        'Machine load start → end',
      ],
      VUES.flatMap((v) =>
        [0, 1]
          .map((s) => trouve(ex, 'mobile', v, s))
          .filter(Boolean)
          .map((r) => [
            LIBELLE[r.vue],
            r.seuil === 0 ? 'maximum' : r.seuil === 1 ? 'normal' : 'reduced',
            nombre(r.trianglesNonCouverts, 0),
            nombre(r.appelsDeDessin, 0),
            nombre(r.pagesResidentes, 0),
            r.hiZ ? `${nombre(r.hiZ.tested, 0)} / ${nombre(r.hiZ.rejected, 0)}` : 'not measured',
            pixels(r.temoinAA),
            r.imageTenue === null ? '—' : r.imageTenue ? 'yes' : 'no',
            r.charge
              ? `${nombre(r.charge.debut[0], 1)} → ${nombre(r.charge.fin[0], 1)}`
              : 'not measured',
          ]),
      ),
    ),
  ].join('');
}

/** La courbe des résolutions : à quart de pixels, l'image est plus lente. */
