// Figures the report does not measure itself, in one place: those the reference published,
// the two bytes-per-triangle markers, and the pass groups read from the engine table with
// the backlog line that attacks them.
/**
 * Published figures of the reference (`docs/REFERENCE_UE5.md`, SIGGRAPH 2021 talk, PS5 demo
 * at 2496×1404 upscaled to 4K), and the marker the bench does not measure: bytes per triangle
 * of our format (`docs/FORMAT.md`). Those of the Three witnesses are measured (`trianglesUniques`).
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

/** Sum of p50 of the passes that `garde` keeps, or `null` if none. */
export function sommePasses(releve, garde) {
  const passes = (releve?.passes ?? []).filter(garde);
  if (!passes.length) return null;
  return passes.reduce((total, p) => total + (p.p50 ?? 0), 0);
}

/** Pass groups, read from the engine table (block and stage), with the backlog line. */
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
