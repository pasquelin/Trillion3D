// Les fiches de la première page qui ne se lisent pas dans une exécution à deux côtés : les octets
// par triangle (mesurés chez les témoins qui comptent leurs triangles uniques, chiffres de format
// pour nous et Unreal), le découpage face à Unreal, le travail à scène immobile, la petite
// machine. Une valeur par série, dans l'ordre des barres : les témoins, notre moteur, Unreal.
import { barresSeries, fiche, NOTRE } from './rapportGlobalFiches.mjs';
import { OCTETS_PAR_TRIANGLE, UNREAL } from './rapportGlobalChiffres.mjs';

/** Les octets de géométrie par triangle unique d'un relevé, ou `null` sans les deux chiffres. */
const octetsParTriangle = (r) =>
  typeof r?.geometrieOctets === 'number' && r?.trianglesUniques > 0
    ? r.geometrieOctets / r.trianglesUniques
    : null;

/** La fiche sans chiffre du banc, posée après le comparateur d'images. */
export const FICHE_PETITE_MACHINE = fiche(
  'f-petite-machine',
  'And on a small machine, with less memory?',
  `<ul class="trois"><li><strong>Three.js</strong>, vanilla or LOD: all or nothing. If the city does not fit, the tab dies.</li><li><strong>${NOTRE}</strong>: it stops with an error.</li><li><strong>Unreal</strong>: it shows a coarser image, but it keeps going.</li></ul>`,
  ['mauvais', 'it stops instead of degrading'],
  'The worst finding in the report: when memory runs out, the engine crashes instead of showing a coarser image. Fix this first.',
);

/**
 * Les trois fiches à poser avant le comparateur d'images. `temoins` : le relevé « depuis la rue,
 * caméra fixe, sans ombres » de chaque témoin, dans l'ordre des barres ; `fixe` celui du moteur à
 * caméra fixe.
 */
export const fichesFixes = ({ temoins, fixe }) => [
  fiche(
    'f-octets',
    'How much memory per triangle?',
    barresSeries('f-octets-g', 'bytes per triangle', [
      {
        libelle: 'geometry in memory',
        valeurs: [
          ...temoins.map(octetsParTriangle),
          OCTETS_PAR_TRIANGLE.nous,
          UNREAL.octetsParTriangle,
        ],
      },
    ]),
    ['mauvais', '5× heavier than Unreal'],
    'Three: everything the glTF carries (positions, normals, tangents, two UV sets, indices), measured; its LOD levels add their indices. Us: ~48, uncompressed. Unreal: 8.7, everything compressed.',
  ),
  fiche(
    'f-structure',
    'Same layout as Unreal?',
    `<ul class="trois"><li><strong>128 triangles per cluster</strong>: yes, same.</li><li><strong>Clusters grouped 8 to 32</strong>: yes, same.</li><li><strong>128 KiB pages</strong>: yes, same.</li><li><strong>Fixed memory pool</strong>: Unreal 512 MB; we count pages, not bytes.</li></ul>`,
    ['bon', 'yes, same numbers'],
    'The engine is built like Unreal, with the same numbers. What is missing is not the structure: it is compression and a bounded pool.',
  ),
  // Les témoins viennent de leur exécution sans ombres, caméra fixe ; le moteur de `fixe`.
  fiche(
    'f-immobile',
    'When nothing moves, does the engine still work?',
    barresSeries('f-immobile-g', 'ms', [
      {
        libelle: 'from the street',
        valeurs: [
          ...temoins.map((r) => r?.imageMs),
          fixe && fixe.gpuReleves === 0 ? 0 : fixe?.imageMs,
          0,
        ],
      },
    ]),
    fixe && fixe.gpuReleves === 0
      ? ['bon', 'nothing: the frame is held']
      : ['mauvais', 'it redraws'],
    'Three redraws everything, every frame. The engine holds the image and does nothing, like Unreal. On a laptop, that is battery life.',
  ),
];
