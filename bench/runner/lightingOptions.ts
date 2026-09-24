// Lighting options for harness: lights, sun, bounce, and intensity for `options.ts`.

/** Lighting options: lights, sun, bounce, intensity, and shadows. */
export function lightingSettings(
  flags: Map<string, string>,
  number: (name: string, fallback: number) => number,
) {
  return {
    // Bounced light is disabled by default in the engine: benchmark enables it on demand.
    bounce: (flags.get('rebond') ?? 'off') === 'on',
    // Contract lights placed by generic rule in `lamps.ts`: count, shadow status, and motion.
    lights: number('lampes', 0),
    lightShadows: (flags.get('ombres') ?? 'on') !== 'off',
    // `--intensite` sets point light emission uniformly across scenes.
    lightIntensity: number('intensite', 40),
    // `--portee` sets the range of each grid light as a multiple of its cell (0.75 by default):
    // above one, several lights reach the same pixel.
    lightRangeFactor: number('portee', 0.75),
    movingLight: flags.get('lampe-mobile') === 'true',
    // `--lampes-fichier off` opens the scene without imported lights from source file.
    importedLights: (flags.get('lampes-fichier') ?? 'on') !== 'off',
    // `--soleil` adds the generic directional light from `lamps.ts` with its shadow maps.
    sun: flags.get('soleil') === 'true',
    // Shadow stage budget in GPU milliseconds per frame.
    shadowBudgetMs: flags.has('budget-ombres') ? number('budget-ombres', 1) : null,
    // `--ombres-pages off` invalidates whole face whenever an object moves in range.
    shadowPages: (flags.get('ombres-pages') ?? 'on') !== 'off',
    // `--empreinte-ombres` flushes shadow page queue, reads depth atlas, and publishes digest.
    shadowDigest: flags.get('empreinte-ombres') === 'true',
    // `--objet-mobile <node>` moves a named node in a small circle each frame.
    movingNode: flags.get('objet-mobile') ?? null,
    movingNodeRadius: number('objet-rayon', 1),
  };
}
