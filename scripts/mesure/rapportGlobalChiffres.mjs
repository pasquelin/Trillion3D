// Les chiffres que le rapport ne mesure pas lui-même, en un seul endroit : ceux que la référence a
// publiés, les deux repères d'octets par triangle, et les groupes de passes lus dans la table du
// moteur avec la ligne du backlog qui s'y attaque.
/**
 * Les chiffres publiés de la référence (`docs/REFERENCE_UE5.md`, talk SIGGRAPH 2021, démo PS5 à
 * 2496×1404 remontée en 4K), et le repère que le banc ne mesure pas : les octets par triangle de
 * notre format (`docs/FORMAT.md`). Ceux des témoins Three sont mesurés (`trianglesUniques`).
 */
export const UNREAL = {
  trianglesParGrappe: 128,
  grappesParGroupe: [8, 32],
  pageKio: 128,
  poolMo: 512,
  octetsParTriangle: 8.7,
  trianglesParImage: 25e6,
  visibiliteMs: 2.5,
  materiauxMs: 2.084,
  cpuMs: 0.05,
};
UNREAL.imageMs = UNREAL.visibiliteMs + UNREAL.materiauxMs;
export const OCTETS_PAR_TRIANGLE = { nous: 48 };

/** Somme des p50 des passes que `garde` retient, ou `null` si aucune. */
export function sommePasses(releve, garde) {
  const passes = (releve?.passes ?? []).filter(garde);
  if (!passes.length) return null;
  return passes.reduce((total, p) => total + (p.p50 ?? 0), 0);
}

/** Les groupes de passes, lus dans la table du moteur (bloc et étape), avec la ligne du backlog. */
export const GROUPES = [
  [
    'Tampon de visibilité (sélection, partition, Hi-Z, raster)',
    (p) => p.bloc === 'visibility',
    'Géométrie 9, 26',
  ],
  ['Passe matériaux', (p) => p.bloc === 'materials', 'Géométrie 13'],
  ['Ombres', (p) => p.etape === 'shadows', 'Lumière 6, 13'],
  [
    'Éclairage (listes de lampes + différé)',
    (p) => p.etape === 'lightLists' || p.etape === 'lighting',
    'Lumière 18',
  ],
  ['Antialiasing temporel', (p) => p.etape === 'antialiasing', 'Lumière 16'],
  ['Présentation', (p) => p.etape === 'present', '—'],
  ['Transparents', (p) => p.etape === 'transparents', 'Compilateur 10'],
  ['Rebond', (p) => p.etape === 'bounce', 'Lumière 7'],
];
export const visibilite = GROUPES[0][1];
