// La première page du rapport global : une question par fiche, trois barres — Three.js nu, notre
// moteur, Unreal — et une phrase qui dit ce que ça veut dire. Aucun jargon : les détails sont plus
// bas dans le rapport. Les chiffres d'Unreal sont ceux de `rapportGlobalReference.mjs` ; quand il
// n'a rien publié, la barre l'écrit au lieu de se taire.
import { barres, moins } from './rapportGlobalGraphes.mjs';
import { paire, trouve } from './rapportGlobalLecture.mjs';
import { comparateur } from './rapportGlobalComparateur.mjs';
import { bilan } from './rapportGlobalBilan.mjs';
import { fiche, fichePar, grille, pairesImages, SERIES } from './rapportGlobalFiches.mjs';
import { OCTETS_PAR_TRIANGLE, UNREAL } from './rapportGlobalChiffres.mjs';

const NON_PUBLIE = 'Unreal : non publié';
/** `v / div`, ou `null` si la valeur manque. */
const en = (v, div) => (typeof v === 'number' ? v / div : null);

export function sectionSimple(ex, dossier) {
  const vues = [
    ['generale', 'vue de haut'],
    ['sol', 'depuis la rue'],
  ];
  // Chaque exécution Three nu donne [Three, moteur] ; `t` lit Three, `m` le moteur.
  const nu = (v) => paire(ex, 'three-nu', v);
  const nuSans = (v) => paire(ex, 'three-nu-sans-ombres', v);
  const l4 = (v) => paire(ex, 'three-nu-lampes-4', v);
  const quart = (v) => paire(ex, 'three-nu-1248', v);
  const t = ([three]) => three;
  const m = ([, moteur]) => moteur;
  const fixe = trouve(ex, 'fixe', 'sol', 1);
  const fiches = [
    fichePar(
      'f-image',
      'Combien de temps pour dessiner une image ? (soleil et ombres)',
      'ms',
      vues,
      (v) => [t(nu(v))?.imageSyncP50 ?? null, m(nu(v))?.gpuP50 ?? null, UNREAL.imageMs],
      'Barre courte = rapide. Sous 16,7 ms, c’est fluide. De haut, le moteur gagne. Depuis la rue, il fait comme Three : à cause des ombres.',
    ),
    fichePar(
      'f-cpu',
      'Combien de temps le processeur travaille par image ?',
      'ms',
      vues,
      (v) => [t(nu(v))?.cpuP50 ?? null, m(nu(v))?.cpuP50 ?? null, UNREAL.cpuMs],
      'Le moteur laisse presque tout faire à la carte graphique, comme Unreal. Three fait trier des milliers d’objets par le processeur.',
      2,
    ),
    fichePar(
      'f-tri',
      'Combien de triangles sont dessinés par image ?',
      'millions',
      vues,
      (v) => [
        en(t(nu(v))?.trianglesDessines, 1e6),
        en(m(nu(v))?.triangles, 1e6),
        UNREAL.trianglesParImage / 1e6,
      ],
      'Ce n’est pas une course : Unreal vise un triangle par pixel (25 M en 4K), pour le détail. Nous tolérons 1 px d’erreur, donc moins. Three dessine tout, même caché.',
    ),
    fichePar(
      'f-appels',
      'Combien d’ordres de dessin par image ?',
      'appels',
      vues,
      (v) => [
        t(nu(v))?.appelsDeDessin ?? null,
        m(nu(v))?.appelsDeDessin ?? null,
        'Unreal : un par matériau',
      ],
      'Un ordre = une demande à la carte graphique. Moins il y en a, mieux c’est. Le moteur en envoie 18, Three des centaines.',
      0,
    ),
    fichePar(
      'f-ombres',
      'Que coûtent les ombres de quatre lampes en plus du soleil ?',
      'ms',
      [['sol', 'depuis la rue']],
      () => [
        moins(t(l4('sol'))?.imageSyncP50, t(nu('sol'))?.imageSyncP50),
        moins(m(l4('sol'))?.gpuP50, m(nu('sol'))?.gpuP50),
        NON_PUBLIE,
      ],
      'Le temps en plus quand quatre lampes font de l’ombre. Le moteur s’en sort bien mieux que Three, mais c’est là qu’il perd le plus de temps.',
    ),
    fichePar(
      'f-petit',
      'Et sur un petit écran (1248×702) ?',
      'ms',
      vues,
      (v) => [t(quart(v))?.imageSyncP50 ?? null, m(quart(v))?.gpuP50 ?? null, NON_PUBLIE],
      'Un écran plus petit doit aller plus vite. C’est le cas maintenant ; ce matin encore, c’était l’inverse (corrigé).',
    ),
    fichePar(
      'f-textures',
      'Combien de mémoire pour les textures ?',
      'Go',
      [['sol', 'depuis la rue']],
      () => [
        en(t(nuSans('sol'))?.texturesEngagees, 1e9),
        en(m(nuSans('sol'))?.texturesEngagees, 1e9),
        'Unreal : réserve fixe, réglable',
      ],
      'Les deux gardent toute la ville en mémoire, sans compresser. Unreal se fixe une réserve et compresse. C’est le plus gros retard.',
      2,
    ),
    fiche(
      'f-octets',
      'Combien de mémoire par triangle ?',
      barres({
        id: 'f-octets-g',
        titre: 'octets',
        unite: 'octets par triangle',
        gauche: 150,
        grand: true,
        series: SERIES,
        lignes: [
          {
            libelle: 'géométrie en mémoire',
            valeurs: [
              OCTETS_PAR_TRIANGLE.three,
              OCTETS_PAR_TRIANGLE.nous,
              UNREAL.octetsParTriangle,
            ],
          },
        ],
      }),
      ['mauvais', '5 fois plus lourd qu’Unreal'],
      'Three : 36 octets (positions, normales, uv, index). Nous : ~48, sans compression. Unreal : 8,7, tout est compressé. Chiffres de format, pas mesurés ici.',
    ),
    fiche(
      'f-structure',
      'Même découpage qu’Unreal ?',
      `<ul class="trois"><li><strong>128 triangles par paquet</strong> : oui, pareil.</li><li><strong>Paquets groupés par 8 à 32</strong> : oui, pareil.</li><li><strong>Pages de 128 Ko</strong> : oui, pareil.</li><li><strong>Réserve mémoire fixe</strong> : Unreal 512 Mo ; nous, un nombre de pages, pas des octets.</li></ul>`,
      ['bon', 'oui, aux mêmes chiffres'],
      'Le moteur est construit comme Unreal, avec les mêmes nombres. Ce qui manque n’est pas la structure : c’est la compression et la mémoire bornée.',
    ),
    fiche(
      'f-immobile',
      'Quand rien ne bouge, le moteur travaille-t-il ?',
      barres({
        id: 'f-immobile-g',
        titre: 'ms',
        unite: 'ms',
        gauche: 150,
        grand: true,
        series: SERIES,
        lignes: [
          {
            libelle: 'depuis la rue',
            valeurs: [
              t(nuSans('sol'))?.imageSyncP50 ?? null,
              fixe && fixe.gpuReleves === 0 ? 0 : (fixe?.gpuP50 ?? null),
              0,
            ],
          },
        ],
      }),
      fixe && fixe.gpuReleves === 0
        ? ['bon', 'rien : l’image est gardée']
        : ['mauvais', 'il redessine'],
      'Three redessine tout, tout le temps. Le moteur garde l’image et ne fait rien, comme Unreal. Sur un portable, c’est la batterie.',
    ),
    fiche(
      'f-fidelite',
      'Les deux images sont-elles les mêmes ?',
      comparateur({ dossier, id: 'cmp-fidelite', paires: pairesImages(ex) }),
      ['bon', 'à l’œil, oui'],
      'Même scène, même caméra. Le trait suit la souris : Three.js à gauche, le moteur à droite.',
    ),
    fiche(
      'f-petite-machine',
      'Et sur une petite machine, avec moins de mémoire ?',
      `<ul class="trois"><li><strong>Three.js</strong> : tout ou rien. Si la ville ne tient pas, l’onglet meurt.</li><li><strong>Notre moteur</strong> : il s’arrête avec une erreur.</li><li><strong>Unreal</strong> : il montre une image moins fine, mais il continue.</li></ul>`,
      ['mauvais', 'il s’arrête au lieu de dégrader'],
      'Le plus grave du rapport : quand la mémoire manque, le moteur casse au lieu de montrer une image moins belle. À corriger en premier.',
    ),
  ];
  return `${bilan(ex)}<p class="sous">Trois barres par question : <strong>Three.js</strong> (dessin simple, sans astuce), <strong>notre moteur</strong>, <strong>Unreal</strong> (ses chiffres publiés, sur sa console). Barre courte = mieux. Vert = bien, jaune = pareil que Three, rouge = problème.</p><div class="fiches">${grille(fiches, new Set([fiches.length - 2]))}</div>`;
}
