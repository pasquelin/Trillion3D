import type { CameraPose } from '../contracts/index.ts';
/** The camera paths a benchmark can replay, each with what it measures. */
export const CAMERA_SCENARIOS = [
  {
    id: 'initial-load',
    available: true,
    scope:
      'Preparation wall time and actual resource/page progress; not a cold OS/GPU cache guarantee',
  },
  { id: 'stationary', available: true, scope: 'Fixed selected camera' },
  { id: 'slow-orbit', available: true, scope: 'Geometric orbit' },
  { id: 'fast-orbit', available: true, scope: 'Geometric orbit with rapid angular changes' },
  { id: 'near-far', available: true, scope: 'Same target, camera distance sweep' },
  {
    id: 'round-trip',
    available: true,
    scope:
      'Same exact resident path forward/reverse; eviction is measured when the exact-cluster backend is selected',
  },
  ...['visibility-jump', 'memory-pressure', 'long-session', 'pop-in', 'stop-resume'].map((id) => ({
    id,
    available: false,
    scope:
      'Requires a calibrated path or an unimplemented backend capability; user-recorded paths can already be replayed',
  })),
];
/** A list of camera poses along a named path, from a home pose. */
export function makeCameraPath(
  kind: 'stationary' | 'slow-orbit' | 'fast-orbit' | 'near-far' | 'round-trip',
  home: CameraPose,
  samples = 60,
): CameraPose[] {
  if (!Number.isInteger(samples) || samples < 2 || samples > 6000)
    throw new Error('samples must be 2..6000');
  const [dx, dy, dz] = home.position.map((v, i) => v - home.target[i]);
  return Array.from({ length: samples }, (_, i) => {
    let t = i / (samples - 1);
    if (kind === 'round-trip') t = t < 0.5 ? t * 2 : 2 - t * 2;
    const angle =
        kind === 'stationary' || kind === 'near-far'
          ? 0
          : t * (kind === 'fast-orbit' ? Math.PI * 2 : Math.PI / 4),
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
