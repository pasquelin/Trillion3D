// Lighting options for harness: lights, sun, bounce, and intensity for `options.ts`.

/** Lighting options: lights, sun, bounce, intensity, and shadows. */
export function lightingSettings(
  flags: Map<string, string>,
  number: (name: string, fallback: number) => number,
) {
  return {
    // Bounced light is disabled by default in the engine: benchmark enables it on demand.
    bounce: (flags.get('bounce') ?? 'off') === 'on',
    // Contract lights placed by generic rule in `lamps.ts`: count, shadow status, and motion.
    lights: number('lights', 0),
    lightShadows: (flags.get('shadows') ?? 'on') !== 'off',
    // `--intensity` sets point light emission uniformly across scenes.
    lightIntensity: number('intensity', 40),
    // `--range` sets the range of each grid light as a multiple of its cell (0.75 by default):
    // above one, several lights reach the same pixel.
    lightRangeFactor: number('range', 0.75),
    movingLight: flags.get('moving-light') === 'true',
    // `--file-lights off` opens the scene without imported lights from source file.
    importedLights: (flags.get('file-lights') ?? 'on') !== 'off',
    // `--sun` adds the generic directional light from `lamps.ts` with its shadow maps.
    sun: flags.get('sun') === 'true',
    // `--moving-node <node>` moves a named node in a small circle each frame.
    movingNode: flags.get('moving-node') ?? null,
    movingNodeRadius: number('moving-node-radius', 1),
  };
}
