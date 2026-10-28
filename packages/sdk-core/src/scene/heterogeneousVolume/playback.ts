import type { ResolvedHeterogeneousVolume } from './contracts.ts'

/**
 * The frame a heterogeneous volume shows after `dt` seconds, `frameCount` frames in its texture
 * (`UHeterogeneousVolumeComponent::TickComponent`, `HeterogeneousVolumeComponent.cpp:668-681`): it
 * advances by `frameRate` a second while it plays, then starts again at its start when it loops,
 * else stays within its start and its end. The end is the last frame of the texture where the volume
 * names none, and the start never passes it. Fractional: the two frames it lies between blend.
 */
export function advanceHeterogeneousVolumeFrame(
  volume: ResolvedHeterogeneousVolume,
  frameCount: number,
  dt: number,
): number {
  const end = Math.min(volume.endFrame ?? frameCount - 1, frameCount - 1)
  const start = Math.min(volume.startFrame, end)
  let frame = volume.playing ? volume.frame + dt * volume.frameRate : volume.frame
  if (volume.looping) frame = ((frame - start) % (end - start + 1)) + start
  else frame = Math.min(Math.max(frame, start), end)
  return frame
}
