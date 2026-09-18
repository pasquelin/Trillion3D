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
      'Image entière, carte graphique (vue sol, p50)',
      nombre(sol?.gpuP50, 1, 'ms'),
      `p95 ${nombre(sol?.gpuP95, 1, 'ms')} · 2496×1404, soleil, caméra mobile`,
    ),
    tuile(
      'Processeur par image (vue sol, p50)',
      nombre(sol?.cpuP50, 2, 'ms'),
      `p95 ${nombre(sol?.cpuP95, 2, 'ms')} · la référence dit « presque nul »`,
    ),
    tuile(
      'Vue la plus chère',
      pire ? `${LIBELLE[pire.vue]} : ${nombre(pire.gpuP50, 1, 'ms')}` : 'non mesuré',
      'enveloppe carte graphique p50, qualité normale',
    ),
    tuile(
      'Triangles sélectionnés (vue générale)',
      nombre(gen?.triangles, 0),
      `la référence en rastérise ${nombre(UNREAL.trianglesParImage / 1e6, 0)} M par image, fixe`,
    ),
    tuile(
      'Scène immobile',
      fixe
        ? fixe.gpuReleves === 0
          ? 'aucun travail carte'
          : `${fixe.gpuReleves} relevés carte`
        : 'non mesuré',
      fixe ? `processeur ${nombre(fixe.cpuP50, 2, 'ms')} par image` : '',
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
    '<p>Caméra mobile, soleil avec ses cascades d’ombre, textures cuites, 2496×1404, 60 images mesurées puis 120 images de profil. « Qualité » : l’erreur qu’on tolère à l’écran — 0 px, le moteur prend la géométrie la plus fine ; 1 px, il s’autorise un pixel d’écart, invisible à l’œil, et dessine moins. La vue « détail » est un segment immobile de la trajectoire (deux points identiques) : l’image y est tenue et la carte n’y fait rien, même avec la caméra « mobile ». Le seuil d’erreur 0 demande la géométrie la plus fine ; le seuil 1 tolère un pixel d’erreur à l’écran. L’« image entière » est l’enveloppe des passes de la carte, du premier horodatage au dernier : les passes se recouvrent sur cet appareil, une somme les compterait deux fois.</p>',
    deuxCols(
      barres({
        id: 'g-gpu-vues',
        titre: 'Image entière, carte graphique, p50',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('gpuP50'),
      }),
      barres({
        id: 'g-gpu-vues-p95',
        titre: 'Image entière, carte graphique, p95',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('gpuP95'),
      }),
    ),
    deuxCols(
      barres({
        id: 'g-cpu-vues',
        titre: 'Processeur par image, p50',
        sousTitre: 'coupe, relevé, résidence, encodage compris',
        unite: 'ms',
        series: QUALITES,
        lignes: lignes('cpuP50'),
      }),
      barres({
        id: 'g-tri-vues',
        titre: 'Triangles sélectionnés',
        unite: 'triangles',
        decimales: 0,
        series: QUALITES,
        lignes: lignes('triangles'),
      }),
    ),
    tableau(
      [
        'Vue',
        'Qualité',
        'Non couverts',
        'Appels de dessin',
        'Pages résidentes',
        'Hi-Z testés / rejetés (grappes)',
        'Témoin A/A (px)',
        'Image tenue',
        'Charge machine début → fin',
      ],
      VUES.flatMap((v) =>
        [0, 1]
          .map((s) => trouve(ex, 'mobile', v, s))
          .filter(Boolean)
          .map((r) => [
            LIBELLE[r.vue],
            r.seuil === 0 ? 'maximale' : r.seuil === 1 ? 'normale' : 'réduite',
            nombre(r.trianglesNonCouverts, 0),
            nombre(r.appelsDeDessin, 0),
            nombre(r.pagesResidentes, 0),
            r.hiZ ? `${nombre(r.hiZ.tested, 0)} / ${nombre(r.hiZ.rejected, 0)}` : 'non mesuré',
            pixels(r.temoinAA),
            r.imageTenue === null ? '—' : r.imageTenue ? 'oui' : 'non',
            r.charge
              ? `${nombre(r.charge.debut[0], 1)} → ${nombre(r.charge.fin[0], 1)}`
              : 'non mesuré',
          ]),
      ),
    ),
  ].join('');
}

/** La courbe des résolutions : à quart de pixels, l'image est plus lente. */
