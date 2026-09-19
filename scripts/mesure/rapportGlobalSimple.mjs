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
    ['generale', 'vue de haut'],
    ['sol', 'depuis la rue'],
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
      'Combien de temps pour dessiner une image ? (soleil et ombres)',
      'ms',
      vues,
      (v) => serie('', v, (r) => r?.imageMs, UNREAL.imageMs),
      'Barre courte = rapide. Sous 16,7 ms, c’est fluide. De haut, le moteur gagne. Depuis la rue, il fait comme Three : à cause des ombres.',
    ),
    fichePar(
      'f-cpu',
      'Combien de temps le processeur travaille par image ?',
      'ms',
      vues,
      (v) => serie('', v, (r) => r?.cpuP50, UNREAL.cpuMs),
      'Le moteur laisse presque tout faire à la carte graphique, comme Unreal. Three fait trier des milliers d’objets par le processeur, LOD ou pas.',
      2,
    ),
    fichePar(
      'f-tri',
      'Combien de triangles sont dessinés par image ?',
      'millions',
      vues,
      (v) =>
        serie(
          '',
          v,
          (r) => en(r?.trianglesDessines ?? r?.triangles, 1e6),
          UNREAL.trianglesParImage / 1e6,
        ),
      'Ce n’est pas une course : Unreal vise un triangle par pixel (25 M en 4K). Three dessine tout, même caché ; le LOD en enlève au loin ; nous choisissons par paquet.',
    ),
    fichePar(
      'f-appels',
      'Combien d’ordres de dessin par image ?',
      'appels',
      vues,
      (v) => serie('', v, (r) => r?.appelsDeDessin, 'un par matériau'),
      'Un ordre = une demande à la carte graphique. Moins il y en a, mieux c’est. Le moteur en envoie 18, Three des centaines — le LOD n’y change rien.',
      0,
    ),
    fichePar(
      'f-ombres',
      'Que coûtent les ombres de quatre lampes en plus du soleil ?',
      'ms',
      [['sol', 'depuis la rue']],
      (v) => {
        const [avec, sans] = [
          serie('-lampes-4', v, (r) => r?.imageMs),
          serie('', v, (r) => r?.imageMs),
        ];
        return [...avec.slice(0, -1).map((a, i) => moins(a, sans[i])), 'non publié'];
      },
      'Le temps en plus quand quatre lampes font de l’ombre. Le moteur s’en sort bien mieux que Three, mais c’est là qu’il perd le plus de temps.',
    ),
    fichePar(
      'f-petit',
      'Et sur un petit écran (1248×702) ?',
      'ms',
      vues,
      (v) => serie('-1248', v, (r) => r?.imageMs, 'non publié'),
      'Un écran plus petit doit aller plus vite. C’est le cas pour tous.',
    ),
    fichePar(
      'f-textures',
      'Combien de mémoire pour les textures ?',
      'Go',
      [['sol', 'depuis la rue']],
      (v) =>
        serie('-sans-ombres', v, (r) => en(r?.texturesEngagees, 1e9), 'réserve fixe, réglable'),
      'Tous gardent toute la ville en mémoire, sans compresser. Unreal se fixe une réserve et compresse. C’est le plus gros retard.',
      2,
    ),
    ...fichesFixes({
      temoins: TEMOINS.map((w) => t(`${w.moteur}-sans-ombres`, 'sol')),
      fixe,
    }),
    fiche(
      'f-fidelite',
      'Les images sont-elles les mêmes ?',
      comparateur({ dossier, id: 'cmp-fidelite', paires: pairesImages(ex), notre: NOTRE }),
      ['bon', 'à l’œil, oui'],
      `Même scène, même caméra, même image de la trajectoire. Choisis le témoin : il est à gauche, ${NOTRE} toujours à droite, le trait suit la souris.`,
      true,
    ),
    FICHE_PETITE_MACHINE,
  ];
  return `${bilan(ex)}<p class="sous">Une barre par moteur et par question : <strong>Three.js nu</strong> (dessin simple, sans astuce), <strong>Three.js LOD</strong> (la méthode classique : trois niveaux de détail par objet), <strong>${html(NOTRE)}</strong>, <strong>Unreal</strong> (ses chiffres publiés, sur sa console). Barre courte = mieux. Vert = bien, jaune = pareil que Three, rouge = problème.</p><div class="fiches">${grille(fiches)}</div>`;
}
