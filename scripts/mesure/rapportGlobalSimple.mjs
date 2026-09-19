// La première page du rapport global : une question par fiche, une barre par série — les témoins
// Three.js (nu, à niveaux de détail), notre moteur, Unreal — et une phrase qui dit ce que ça veut
// dire. Aucun jargon : les détails sont plus bas dans le rapport. Les chiffres d'Unreal sont ceux
// de `rapportGlobalReference.mjs` ; quand un témoin n'a rien publié, sa barre l'écrit au lieu de
// se taire. Les fiches sans chiffre du banc sont dans `rapportGlobalSimpleFixes.mjs`.
import { html, moins } from './rapportGlobalGraphes.mjs';
import { trouve } from './rapportGlobalLecture.mjs';
import { comparateur } from './rapportGlobalComparateur.mjs';
import { bilan } from './rapportGlobalBilan.mjs';
import { fiche, fichePar, grille, NOTRE, pairesImages, TEMOINS } from './rapportGlobalFiches.mjs';
import { FICHE_PETITE_MACHINE, fichesFixes } from './rapportGlobalSimpleFixes.mjs';
import { UNREAL } from './rapportGlobalChiffres.mjs';

/** `v / div`, ou `null` si la valeur manque. */
const en = (v, div) => (typeof v === 'number' ? v / div : null);
const [REFERENCE] = TEMOINS;

export function sectionSimple(ex, dossier) {
  const vues = [
    ['generale', 'overview'],
    ['sol', 'from the street'],
  ];
  // Une exécution à deux côtés met le témoin en `avant` et le moteur en `apres` : `t` lit le
  // témoin, `m` le moteur, dans l'exécution du témoin de référence.
  const t = (run, v) => trouve(ex, run, v, 1, 'avant');
  const m = (run, v) => trouve(ex, run, v, 1, 'apres');
  // Les valeurs d'une fiche : chaque témoin dans son exécution `<moteur><suffixe>`, notre moteur
  // dans celle de la référence, puis Unreal ; `lire` prend un relevé (ou `null`).
  const serie = (suffixe, v, lire, unreal) => [
    ...TEMOINS.map((w) => lire(t(w.moteur + suffixe, v))),
    lire(m(REFERENCE.moteur + suffixe, v)),
    unreal,
  ];
  const fixe = trouve(ex, 'fixe', 'sol', 1);
  const fiches = [
    fichePar(
      'f-image',
      'How long to draw a frame? (sun and shadows)',
      'ms',
      vues,
      (v) => serie('', v, (r) => r?.imageMs, UNREAL.imageMs),
      'Shorter bar = faster. Under 16.7 ms is smooth. From above, the engine wins. From the street it matches Three: shadows.',
    ),
    fichePar(
      'f-cpu',
      'How long does the CPU work per frame?',
      'ms',
      vues,
      (v) => serie('', v, (r) => r?.cpuP50, UNREAL.cpuMs),
      'The engine leaves almost everything to the GPU, like Unreal. Three sorts thousands of objects on the CPU, LOD or not.',
      2,
    ),
    fichePar(
      'f-tri',
      'How many triangles are drawn per frame?',
      'millions',
      vues,
      (v) =>
        serie(
          '',
          v,
          (r) => en(r?.trianglesDessines ?? r?.triangles, 1e6),
          UNREAL.trianglesParImage / 1e6,
        ),
      'Not a race: Unreal aims for one triangle per pixel (25 M at 4K). Three draws everything, even hidden; LOD drops distant meshes; we pick by cluster.',
    ),
    fichePar(
      'f-appels',
      'How many draw calls per frame?',
      'calls',
      vues,
      (v) => serie('', v, (r) => r?.appelsDeDessin, 'one per material'),
      'A call is one request to the GPU. Fewer is better. The engine issues 18, Three hundreds — LOD does not change that.',
      0,
    ),
    fichePar(
      'f-ombres',
      'What do four extra shadowed lights cost on top of the sun?',
      'ms',
      [['sol', 'from the street']],
      (v) => {
        const [avec, sans] = [
          serie('-lampes-4', v, (r) => r?.imageMs),
          serie('', v, (r) => r?.imageMs),
        ];
        return [...avec.slice(0, -1).map((a, i) => moins(a, sans[i])), 'not published'];
      },
      'The extra time when four lights cast shadows. The engine beats Three here, but this is still where it loses the most time.',
    ),
    fichePar(
      'f-petit',
      'And on a small screen (1248×702)?',
      'ms',
      vues,
      (v) => serie('-1248', v, (r) => r?.imageMs, 'not published'),
      'A smaller screen should be faster. It is, for everyone.',
    ),
    fichePar(
      'f-textures',
      'How much memory for textures?',
      'GB',
      [['sol', 'from the street']],
      (v) =>
        serie('-sans-ombres', v, (r) => en(r?.texturesEngagees, 1e9), 'fixed pool, configurable'),
      'Everyone keeps the whole city in memory, uncompressed. Unreal sets a pool and compresses. That is the largest gap.',
      2,
    ),
    ...fichesFixes({
      temoins: TEMOINS.map((w) => t(`${w.moteur}-sans-ombres`, 'sol')),
      fixe,
    }),
    fiche(
      'f-fidelite',
      'Do the images match?',
      comparateur({ dossier, id: 'cmp-fidelite', paires: pairesImages(ex), notre: NOTRE }),
      ['bon', 'to the eye, yes'],
      `Same scene, same camera, same frame on the path. Pick the witness: it is on the left, ${NOTRE} always on the right; the slider follows the mouse.`,
      true,
    ),
    FICHE_PETITE_MACHINE,
  ];
  return `${bilan(ex)}<p class="sous">One bar per engine and per question: <strong>Three.js vanilla</strong> (plain draw, no tricks), <strong>Three.js LOD</strong> (the classic method: three detail levels per object), <strong>${html(NOTRE)}</strong>, <strong>Unreal</strong> (its published numbers, on its console). Shorter bar = better. Green = good, yellow = same as Three, red = a problem.</p><div class="fiches">${grille(fiches)}</div>`;
}
