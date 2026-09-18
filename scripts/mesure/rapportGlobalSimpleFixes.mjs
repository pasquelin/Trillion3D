// Les fiches de la première page qui ne se lisent pas dans une exécution à deux côtés : les octets
// par triangle (mesurés chez les témoins qui comptent leurs triangles uniques, chiffres de format
// pour nous et the reference engine), le découpage face à the reference engine, le travail à scène immobile, la petite
// machine. Une valeur par série, dans l'ordre des barres : les témoins, notre moteur, the reference engine.
import { barresSeries, fiche } from './rapportGlobalFiches.mjs';
import { OCTETS_PAR_TRIANGLE, REFERENCE } from './rapportGlobalChiffres.mjs';

/** Les octets de géométrie par triangle unique d'un relevé, ou `null` sans les deux chiffres. */
const octetsParTriangle = (r) =>
  typeof r?.geometrieOctets === 'number' && r?.trianglesUniques > 0
    ? r.geometrieOctets / r.trianglesUniques
    : null;

/** La fiche sans chiffre du banc, posée après le comparateur d'images. */
export const FICHE_PETITE_MACHINE = fiche(
  'f-petite-machine',
  'Et sur une petite machine, avec moins de mémoire ?',
  `<ul class="trois"><li><strong>Three.js</strong>, nu ou LOD : tout ou rien. Si la ville ne tient pas, l’onglet meurt.</li><li><strong>Notre moteur</strong> : il s’arrête avec une erreur.</li><li><strong>the reference engine</strong> : il montre une image moins fine, mais il continue.</li></ul>`,
  ['mauvais', 'il s’arrête au lieu de dégrader'],
  'Le plus grave du rapport : quand la mémoire manque, le moteur casse au lieu de montrer une image moins belle. À corriger en premier.',
);

/**
 * Les trois fiches à poser avant le comparateur d'images. `temoins` : le relevé « depuis la rue,
 * caméra fixe, sans ombres » de chaque témoin, dans l'ordre des barres ; `fixe` celui du moteur à
 * caméra fixe.
 */
export const fichesFixes = ({ temoins, fixe }) => [
  fiche(
    'f-octets',
    'Combien de mémoire par triangle ?',
    barresSeries('f-octets-g', 'octets par triangle', [
      {
        libelle: 'géométrie en mémoire',
        valeurs: [
          ...temoins.map(octetsParTriangle),
          OCTETS_PAR_TRIANGLE.nous,
          REFERENCE.octetsParTriangle,
        ],
      },
    ]),
    ['mauvais', '5 fois plus lourd qu’the reference engine'],
    'Three : tout ce que le glTF porte (positions, normales, tangentes, deux jeux d’uv, index), mesuré ; ses niveaux de détail ajoutent leurs index. Nous : ~48, sans compression. the reference engine : 8,7, tout est compressé.',
  ),
  fiche(
    'f-structure',
    'Même découpage qu’the reference engine ?',
    `<ul class="trois"><li><strong>128 triangles par paquet</strong> : oui, pareil.</li><li><strong>Paquets groupés par 8 à 32</strong> : oui, pareil.</li><li><strong>Pages de 128 Ko</strong> : oui, pareil.</li><li><strong>Réserve mémoire fixe</strong> : the reference engine 512 Mo ; nous, un nombre de pages, pas des octets.</li></ul>`,
    ['bon', 'oui, aux mêmes chiffres'],
    'Le moteur est construit comme the reference engine, avec les mêmes nombres. Ce qui manque n’est pas la structure : c’est la compression et la mémoire bornée.',
  ),
  // Les témoins viennent de leur exécution sans ombres, caméra fixe ; le moteur de `fixe`.
  fiche(
    'f-immobile',
    'Quand rien ne bouge, le moteur travaille-t-il ?',
    barresSeries('f-immobile-g', 'ms', [
      {
        libelle: 'depuis la rue',
        valeurs: [
          ...temoins.map((r) => r?.imageMs),
          fixe && fixe.gpuReleves === 0 ? 0 : fixe?.imageMs,
          0,
        ],
      },
    ]),
    fixe && fixe.gpuReleves === 0
      ? ['bon', 'rien : l’image est gardée']
      : ['mauvais', 'il redessine'],
    'Three redessine tout, tout le temps. Le moteur garde l’image et ne fait rien, comme the reference engine. Sur un portable, c’est la batterie.',
  ),
];
