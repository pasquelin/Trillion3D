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
    'Visibility buffer (selection, partition, Hi-Z, raster)',
    (p) => p.bloc === 'visibility',
    'Geometry 9, 26',
  ],
  ['Materials pass', (p) => p.bloc === 'materials', 'Geometry 13'],
  ['Shadows', (p) => p.etape === 'shadows', 'Light 6, 13'],
  [
    'Lighting (light lists + deferred)',
    (p) => p.etape === 'lightLists' || p.etape === 'lighting',
    'Light 18',
  ],
  ['Temporal antialiasing', (p) => p.etape === 'antialiasing', 'Light 16'],
  ['Present', (p) => p.etape === 'present', '—'],
  ['Transparents', (p) => p.etape === 'transparents', 'Compiler 10'],
  ['Bounce', (p) => p.etape === 'bounce', 'Light 7'],
];
export const visibilite = GROUPES[0][1];
