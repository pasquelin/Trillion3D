// The "one option, two runs" section of the global report: the gates (antialiasing,
// profile, textures, raster, compute path, isolation). Each row puts two readings face to
// face and publishes the envelope and pixel difference, without ever adding CPU and GPU.
import { delta, nombre, pixels as px, tableau } from './rapportGlobalGraphes.mjs';
import { TWO_VIEWS, paire, trouve } from './rapportGlobalLecture.mjs';

/** A gate row: two readings (a = reference, b = variant) and what separates them. */
function porte(libelle, a, b, note = '') {
  return [
    libelle,
    nombre(a?.gpuP50, 2),
    nombre(b?.gpuP50, 2),
    delta(b?.gpuP50, a?.gpuP50, 2),
    nombre(a?.cpuP50, 2),
    nombre(b?.cpuP50, 2),
    delta(b?.cpuP50, a?.cpuP50, 2),
    note,
  ];
}

/** The gates: the reference run, the variant, what is read there. */
const PORTES = [
  [
    'mobile',
    'aa-off',
    'temporal antialiasing off',
    'temporal accumulation cost, from the envelope',
  ],
  [
    'mobile',
    'profil-off',
    'per-step profile off',
    'profile off does not publish an envelope: read the CPU',
  ],
  [
    'mobile',
    'textures-host',
    'textures from source images',
    'versus the cooked pyramid in the cache',
  ],
  ['mobile', 'isolation', 'isolated page (shared memory)', ''],
  ['math-js', 'math-wasm', 'batched math: js → wasm', 'both paths forced, same scene'],
];

export function sectionPortes(ex) {
  const lignes = TWO_VIEWS.flatMap((vue) =>
    PORTES.map(([ref, variante, libelle, note]) =>
      porte(`${vue} · ${libelle}`, trouve(ex, ref, vue, 1), trouve(ex, variante, vue, 1), note),
    ),
  );
  for (const [run, res] of [
    ['raster-1248', '1248×702'],
    ['raster-2496', '2496×1404'],
  ])
    for (const vue of TWO_VIEWS) {
      const [calcul, materiel] = paire(ex, run, vue);
      lignes.push(
        porte(
          `${vue} · ${res} · hardware raster (default) → compute raster (variant)`,
          materiel,
          calcul,
          `image delta ${px(calcul?.ecart)}; identical cut: ${calcul?.coupeIdentique ?? '—'}`,
        ),
      );
    }
  const temoins = ['mobile', ...PORTES.slice(0, 3).map(([, v]) => v)];
  const aaPixels = TWO_VIEWS.map((vue) => [
    vue,
    ...temoins.map((run) => px(trouve(ex, run, vue, 1)?.temoinAA)),
  ]);
  return [
    '<p>Two runs that differ by a single option. The “Δ” column is the GPU p50 envelope difference, the only reading that holds on this device; the gap between two identical runs is about 0.7 ms, nothing smaller concludes.</p>',
    tableau(
      [
        'Gate',
        'GPU baseline',
        'GPU variant',
        'Δ GPU',
        'CPU baseline',
        'CPU variant',
        'Δ CPU',
        'Reading',
      ],
      lignes,
    ),
    '<h3>A/A witness of each run</h3><p>The same side played twice: pixels that move here are engine noise, not an option difference.</p>',
    tableau(['View', ...temoins], aaPixels),
  ].join('');
}
