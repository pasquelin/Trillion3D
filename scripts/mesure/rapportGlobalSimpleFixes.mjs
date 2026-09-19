// First-page cards that are not read from a two-side run: bytes per triangle (measured at
// witnesses that count their unique triangles, format figures for us and Unreal), the
// split against Unreal, work in a still scene, the small machine. One value per series, in
// bar order: the witnesses, our engine, Unreal.
import { barresSeries, fiche, NOTRE } from './rapportGlobalFiches.mjs';
import { OCTETS_PAR_TRIANGLE, UNREAL } from './rapportGlobalChiffres.mjs';

/** Geometry bytes per unique triangle of a reading, or `null` without both figures. */
const octetsParTriangle = (r) =>
  typeof r?.geometrieOctets === 'number' && r?.trianglesUniques > 0
    ? r.geometrieOctets / r.trianglesUniques
    : null;

/** The card with no bench figure, placed after the image comparator. */
export const FICHE_PETITE_MACHINE = fiche(
  'f-petite-machine',
  'And on a small machine, with less memory?',
  `<ul class="trois"><li><strong>Three.js</strong>, vanilla or LOD: all or nothing. If the city does not fit, the tab dies.</li><li><strong>${NOTRE}</strong>: it stops with an error.</li><li><strong>Unreal</strong>: it shows a coarser image, but it keeps going.</li></ul>`,
  ['mauvais', 'it stops instead of degrading'],
  'The worst finding in the report: when memory runs out, the engine crashes instead of showing a coarser image. Fix this first.',
);

/**
 * The three cards to place before the image comparator. `temoins`: the "from the street,
 * still camera, no shadows" reading of each witness, in bar order; `fixe` that of the
 * engine at a still camera.
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
  // Witnesses come from their run without shadows, still camera; the engine from `fixe`.
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
