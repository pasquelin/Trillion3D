// Les sections « performance » du rapport global, seconde moitié : la courbe des résolutions, les
// passes de la carte et les étapes du processeur. Chaque graphe lit les relevés de
// `rapportGlobalLecture.mjs` et ne calcule rien d'autre que des sommes de p50 nommées comme telles.
import { barres, deuxCols, html, nombre, tableau } from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, LIBELLE, trouve } from './rapportGlobalLecture.mjs';
import { GROUPES, sommePasses } from './rapportGlobalChiffres.mjs';

export function sectionResolutions(ex) {
  const points = [
    ['res-624', '624×351'],
    ['res-1248', '1248×702'],
    ['res-1872', '1872×1053'],
    ['mobile', '2496×1404'],
  ];
  const lignes = (lire, seuil = 1) =>
    points.map(([run, libelle]) => ({
      libelle,
      valeurs: DEUX_VUES.map((v) => lire(trouve(ex, run, v, seuil)) ?? null),
    }));
  const seuils = [
    ['res-1248-e0', 0, 'qualité maximale (0 px d’erreur)'],
    ['res-1248', 1, 'qualité normale (1 px d’erreur)'],
    ['res-1248-e2', 2, 'qualité réduite (2 px d’erreur)'],
  ];
  return [
    '<p>Même scène, même trajectoire, même qualité ; seule la taille de l’image change. Une image plus petite devrait coûter moins : la mesure de Lumière 18 disait le contraire, à cause du raster de calcul qui ne s’admet que quand la mémoire le permet.</p>',
    deuxCols(
      barres({
        id: 'g-res-gpu',
        titre: 'Image entière, carte graphique, p50, par résolution',
        unite: 'ms',
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.gpuP50),
      }),
      barres({
        id: 'g-res-mat',
        titre: 'Passe matériaux (WG material surfaces v1), p50, par résolution',
        unite: 'ms',
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.passe('WG material surfaces v1')?.p50),
      }),
    ),
    deuxCols(
      barres({
        id: 'g-res-tri',
        titre: 'Triangles sélectionnés par résolution',
        sousTitre:
          'en qualité normale, la sélection ne grossit pas ses grappes quand l’écran rétrécit',
        unite: 'triangles',
        decimales: 0,
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.triangles),
      }),
      barres({
        id: 'g-res-seuils',
        titre: 'À 1248×702 : image entière selon la qualité demandée',
        unite: 'ms',
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: seuils.map(([run, seuil, libelle]) => ({
          libelle,
          valeurs: DEUX_VUES.map((v) => trouve(ex, run, v, seuil)?.gpuP50 ?? null),
        })),
      }),
    ),
  ].join('');
}

/** Les passes de la carte, une par barre, pour une vue. */
export function sectionPasses(ex) {
  const blocs = (r) => GROUPES.map(([libelle, garde]) => [libelle, sommePasses(r, garde)]);
  const out = [
    '<p>Chaque passe porte sa propre durée ; les groupes ci-dessous sont des sommes de p50 et ne valent pas l’enveloppe. Sur apple metal-3, l’horodatage de la dernière passe d’un groupe absorbe celles qui la précèdent : une étiquette isolée peut mentir, seule une différence d’enveloppe entre deux exécutions tranche.</p>',
  ];
  for (const vue of ['sol', 'generale']) {
    const r = trouve(ex, 'mobile', vue, 1);
    if (!r) continue;
    out.push(
      `<h3>${LIBELLE[vue]}, qualité normale — enveloppe ${nombre(r.gpuP50, 2, 'ms')} p50 / ${nombre(r.gpuP95, 2, 'ms')} p95 (${r.gpuReleves} relevés, ${html(r.gpuMethode ?? 'sans méthode')})</h3>`,
    );
    const passes = r.passes.toSorted((a, b) => (b.p50 ?? 0) - (a.p50 ?? 0));
    out.push(
      deuxCols(
        barres({
          id: `g-blocs-${vue}`,
          titre: 'Groupes de passes, somme des p50',
          unite: 'ms',
          series: ['ms'],
          lignes: blocs(r).map(([libelle, v]) => ({ libelle, valeurs: [v] })),
        }),
        barres({
          id: `g-passes-${vue}`,
          titre: 'Toutes les passes, p50',
          unite: 'ms',
          decimales: 3,
          series: ['ms'],
          lignes: passes.map((p) => ({ libelle: p.nom.replace(/^WG /, ''), valeurs: [p.p50] })),
        }),
      ),
    );
  }
  return out.join('');
}

/** Les étapes du processeur et leurs compteurs. */
export function sectionEtapes(ex) {
  const r = trouve(ex, 'mobile', 'sol', 1);
  if (!r) return '<p>Aucun relevé.</p>';
  return [
    '<p>Ce que le processeur fait pour une image, étape par étape (vue sol, qualité normale). « non mesuré » n’est pas zéro : l’étape n’a pas de chronomètre, et la raison est dite.</p>',
    deuxCols(
      barres({
        id: 'g-etapes',
        titre: 'Étapes processeur, p50 / p95',
        unite: 'ms',
        series: ['p50', 'p95'],
        lignes: r.etapes
          .filter((e) => e.cpuP50 !== null)
          .map((e) => ({ libelle: e.libelle, valeurs: [e.cpuP50, e.cpuP95] })),
      }),
      tableau(
        ['Étape', 'CPU p50 / p95', 'GPU p50', 'Compteurs ou raison'],
        r.etapes.map((e) => [
          e.libelle,
          e.cpuP50 === null
            ? (e.raisonCpu ?? 'non mesuré')
            : `${nombre(e.cpuP50, 2)} / ${nombre(e.cpuP95, 2)}`,
          e.gpuP50 === null ? (e.raisonGpu ?? 'non mesuré') : nombre(e.gpuP50, 3),
          e.compteurs
            ? Object.entries(e.compteurs)
                .map(([k, v]) => `${k} ${nombre(v, 0)}`)
                .join(', ')
            : '',
        ]),
      ),
    ),
  ].join('');
}
