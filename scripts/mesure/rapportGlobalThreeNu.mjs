// La section « face à Three.js nu » du rapport global : le rendu naïf de la même scène, mêmes poses
// et mêmes lampes, face au moteur, dans la même exécution. C'est le témoin qui survit au retrait de
// Three du moteur, et c'est là que se lisent les points faibles : chaque endroit où le moteur est
// plus lent, plus lourd ou plus loin de l'image qu'un rendu qui ne fait rien d'intelligent.
import {
  barres,
  deuxCols,
  delta,
  nombre,
  octets,
  pixels as px,
  secondes,
  tableau,
} from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, paire, VUES } from './rapportGlobalLecture.mjs';

export function sectionThreeNu(ex) {
  const paires = (run, vues) => vues.map((v) => [v, ...paire(ex, run, v)]).filter(([, t]) => t);
  const pleine = paires('three-nu', VUES);
  if (!pleine.length) return '<p>L’exécution <code>three-nu</code> manque.</p>';
  const lignesTemps = pleine.map(([v, t, m]) => ({
    libelle: v,
    valeurs: [t.imageSyncP50, m.gpuP50],
  }));
  const lignesCpu = pleine.map(([v, t, m]) => ({ libelle: v, valeurs: [t.cpuP50, m.cpuP50] }));
  const tableTemps = pleine.map(([v, t, m]) => [
    v,
    nombre(t.imageSyncP50, 2),
    nombre(t.imageSyncP95, 2),
    nombre(m.gpuP50, 2),
    nombre(m.gpuP95, 2),
    nombre(t.rafP50, 2),
    nombre(t.cpuP50, 2),
    nombre(m.cpuP50, 2),
    secondes(t.preparationMs),
    secondes(m.preparationMs),
  ]);
  const tableCharge = pleine.map(([v, t, m]) => [
    v,
    nombre(t.appelsDeDessin, 0),
    nombre(m.appelsDeDessin, 0),
    nombre(t.trianglesDessines, 0),
    nombre(m.triangles, 0),
    octets(t.geometrieOctets),
    octets(m.geometrieOctets),
    octets(t.texturesEngagees),
    octets(m.texturesEngagees),
    t.reseau ? octets(Object.values(t.reseau).reduce((a, b) => a + b, 0)) : '—',
    m.reseau ? octets(Object.values(m.reseau).reduce((a, b) => a + b, 0)) : '—',
  ]);
  const fidelite = [
    ['three-nu', 'soleil et ombres'],
    ['three-nu-sans-ombres', 'soleil sans ombres'],
    ['three-nu-lampes-4', 'soleil + 4 ponctuelles avec ombres'],
    ['three-nu-1248', '1248×702, soleil et ombres'],
  ].flatMap(([run, libelle]) =>
    paires(run, VUES).map(([v, t, m]) => [
      `${libelle} · ${v}`,
      nombre(t.imageSyncP50, 2),
      nombre(m.gpuP50, 2),
      delta(m.gpuP50, t.imageSyncP50, 2),
      px(m.ecart),
      px(m.temoinAA),
    ]),
  );
  const quart = paires('three-nu-1248', DEUX_VUES);
  return [
    '<p>Three.js nu : le glTF source chargé par <code>GLTFLoader</code>, <code>MeshStandardMaterial</code>, tout dessiné à chaque image, une carte d’ombre de 4096² pour le soleil, un cube de 1024² par ponctuelle, ACES et sRGB. Aucune sélection, aucune diffusion, aucun antialiasing temporel, aucun rebond. Sa durée d’image est un <strong>temps mur synchronisé</strong> (<code>render</code> puis la lecture d’un pixel, qui attend la carte) : une seule mesure, pas une somme, et pas la même chose qu’une enveloppe de passes GPU — les deux colonnes se lisent côte à côte, pas l’une contre l’autre au dixième près. WebGL ne donne pas de temps par passe.</p>',
    deuxCols(
      barres({
        id: 'g-nu-temps',
        titre: 'Une image : Three nu (temps mur synchronisé) et moteur (enveloppe carte), p50',
        unite: 'ms',
        series: ['Three nu', 'moteur WebGPU'],
        lignes: lignesTemps,
      }),
      barres({
        id: 'g-nu-cpu',
        titre: 'Processeur par image, p50',
        unite: 'ms',
        series: ['Three nu', 'moteur WebGPU'],
        lignes: lignesCpu,
      }),
    ),
    tableau(
      [
        'Vue',
        'Three mur p50',
        'Three mur p95',
        'Moteur GPU p50',
        'Moteur GPU p95',
        'Three rAF p50',
        'Three CPU p50',
        'Moteur CPU p50',
        'Three préparation',
        'Moteur préparation',
      ],
      tableTemps,
    ),
    '<h3>Ce que chacun dessine et tient</h3>',
    tableau(
      [
        'Vue',
        'Appels Three',
        'Appels moteur',
        'Triangles Three (dessinés)',
        'Triangles moteur (sélectionnés)',
        'Géométrie Three',
        'Géométrie moteur',
        'Textures Three (estimées, mips)',
        'Textures moteur (engagées)',
        'Réseau Three',
        'Réseau moteur',
      ],
      tableCharge,
    ),
    '<h3>Fidélité : l’écart d’image entre les deux, et ce que coûte chaque éclairage</h3><p>L’écart en pixels est celui de la dernière image mesurée, même pose des deux côtés. Sans ombres, il ne reste que les matériaux et la lumière directe : c’est l’écart le plus parlant. Avec ombres, Three n’a qu’une carte là où le moteur a des cascades — l’écart porte d’abord les ombres.</p>',
    tableau(
      [
        'Exécution · vue',
        'Three mur p50',
        'Moteur GPU p50',
        'Δ (moteur − Three)',
        'Écart d’image',
        'Témoin A/A du moteur',
      ],
      fidelite,
    ),
    '<p>Les images se comparent dans la fiche « Les deux images sont-elles les mêmes ? » en tête du rapport.</p>',
    quart.length
      ? `<h3>À 1248×702</h3><p>${quart.map(([v, t, m]) => `${v} : Three ${nombre(t.imageSyncP50, 2, 'ms')}, moteur ${nombre(m.gpuP50, 2, 'ms')}`).join(' · ')}.</p>`
      : '',
  ].join('');
}
