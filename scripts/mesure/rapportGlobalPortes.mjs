// La section « une option, deux exécutions » du rapport global : les portes (antialiasing,
// profil, textures, raster, chemin de calcul, isolation). Chaque ligne met deux relevés face à face et publie la différence
// d'enveloppe et de pixels, sans jamais additionner processeur et carte.
import { delta, nombre, pixels as px, tableau } from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, paire, trouve } from './rapportGlobalLecture.mjs';

/** Une ligne de porte : deux relevés (a = référence, b = variante) et ce qui les sépare. */
function porte(libelle, a, b, note = '') {
  return [
    libelle,
    nombre(a?.gpuP50, 2),
    nombre(b?.gpuP50, 2),
    delta(b?.gpuP50, a?.gpuP50, 2),
    nombre(a?.cpuP50, 2),
    nombre(b?.cpuP50, 2),
    delta(b?.cpuP50, a?.cpuP50, 2),
    note,
  ];
}

/** Les portes : l'exécution de référence, la variante, ce qu'on y lit. */
const PORTES = [
  [
    'mobile',
    'aa-off',
    'antialiasing temporel off',
    'le coût de l’accumulation temporelle, par l’enveloppe',
  ],
  [
    'mobile',
    'profil-off',
    'profil par étape off',
    'le profil off ne publie pas d’enveloppe : lire le processeur',
  ],
  [
    'mobile',
    'textures-host',
    'textures depuis les images sources',
    'contre la pyramide cuite du cache',
  ],
  ['mobile', 'isolation', 'page isolée (mémoire partagée)', ''],
  ['math-js', 'math-wasm', 'calculs en lot : js → wasm', 'les deux chemins imposés, même scène'],
];

export function sectionPortes(ex) {
  const lignes = DEUX_VUES.flatMap((vue) =>
    PORTES.map(([ref, variante, libelle, note]) =>
      porte(`${vue} · ${libelle}`, trouve(ex, ref, vue, 1), trouve(ex, variante, vue, 1), note),
    ),
  );
  for (const [run, res] of [
    ['raster-1248', '1248×702'],
    ['raster-2496', '2496×1404'],
  ])
    for (const vue of DEUX_VUES) {
      const [calcul, materiel] = paire(ex, run, vue);
      lignes.push(
        porte(
          `${vue} · ${res} · raster matériel (défaut) → raster de calcul (variante)`,
          materiel,
          calcul,
          `écart d’image ${px(calcul?.ecart)} ; coupe identique : ${calcul?.coupeIdentique ?? '—'}`,
        ),
      );
    }
  const temoins = ['mobile', ...PORTES.slice(0, 3).map(([, v]) => v)];
  const aaPixels = DEUX_VUES.map((vue) => [
    vue,
    ...temoins.map((run) => px(trouve(ex, run, vue, 1)?.temoinAA)),
  ]);
  return [
    '<p>Deux exécutions dont une seule option diffère. La colonne « Δ » est la différence des enveloppes p50 de la carte graphique, la seule lecture qui vaut sur cet appareil ; l’écart entre deux exécutions identiques est de l’ordre de 0,7 ms, rien de plus petit ne conclut.</p>',
    tableau(
      [
        'Porte',
        'GPU référence',
        'GPU variante',
        'Δ GPU',
        'CPU référence',
        'CPU variante',
        'Δ CPU',
        'Lecture',
      ],
      lignes,
    ),
    '<h3>Le témoin A/A de chaque exécution</h3><p>Le même côté joué deux fois : des pixels qui bougent ici sont du bruit du moteur, pas une différence d’option.</p>',
    tableau(['Vue', ...temoins], aaPixels),
  ].join('');
}
