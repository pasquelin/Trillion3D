import type { CameraPose } from '../contracts/index.ts';
/** How far each path turns around the target over its length, in radians. */
const PATH_TURN: Record<Parameters<typeof makeCameraPath>[0], number> = {
  stationary: 0,
  'slow-orbit': Math.PI / 4,
  'fast-orbit': Math.PI * 2,
  'near-far': 0,
  'round-trip': Math.PI / 4,
};
/** The camera paths a benchmark can replay, each with what it measures. */
export const CAMERA_SCENARIOS = [
  {
    id: 'initial-load',
    scope:
      'Preparation wall time and actual resource/page progress; not a cold OS/GPU cache guarantee',
  },
  { id: 'stationary', scope: 'Fixed selected camera' },
  { id: 'slow-orbit', scope: 'Geometric orbit' },
  { id: 'fast-orbit', scope: 'Geometric orbit with rapid angular changes' },
  { id: 'near-far', scope: 'Same target, camera distance sweep' },
  {
    id: 'round-trip',
    scope:
      'Same exact resident path forward/reverse; eviction is measured when the exact-cluster backend is selected',
  },
  ...['visibility-jump', 'memory-pressure', 'long-session', 'pop-in', 'stop-resume'].map((id) => ({
    id,
    scope:
      'Requires a calibrated path or an unimplemented backend capability; user-recorded paths can already be replayed',
  })),
].map((scenario) => ({
  ...scenario,
  // The initial load is measured while the scene loads, on no path; the others replay theirs.
  available: scenario.id === 'initial-load' || Object.hasOwn(PATH_TURN, scenario.id),
}));
/** A list of camera poses along a named path, from a home pose. */
export function makeCameraPath(
  kind: 'stationary' | 'slow-orbit' | 'fast-orbit' | 'near-far' | 'round-trip',
  home: CameraPose,
  samples = 60,
): CameraPose[] {
  if (!Object.hasOwn(PATH_TURN, kind)) throw new Error(`unknown camera path: ${kind}`);
  if (!Number.isInteger(samples) || samples < 2 || samples > 6000)
    throw new Error('samples must be 2..6000');
  const [dx, dy, dz] = home.position.map((v, i) => v - home.target[i]);
  return Array.from({ length: samples }, (_, i) => {
    let t = i / (samples - 1);
    if (kind === 'round-trip') t = 1 - Math.abs(1 - 2 * t); // out over the first half, back over the second
    const angle = t * PATH_TURN[kind],
      scale = kind === 'near-far' ? 0.3 + 1.4 * t : 1;
    return {
      ...home,
      target: [...home.target],
      position: [
        home.target[0] + (dx * Math.cos(angle) - dz * Math.sin(angle)) * scale,
        home.target[1] + dy * scale,
        home.target[2] + (dx * Math.sin(angle) + dz * Math.cos(angle)) * scale,
      ],
    };
  });
}
