import { worldStretch } from '../geometry/selection/rootWorld.ts'
import { noteDeformed } from '../frame/render/movedGeometry.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { readAnimationSetting } from '../../../sdk-core/src/contracts/animationOptions.ts'
import { holdReach } from './halfFloat.ts'
import { updateWavePages } from './wavePages.ts'
import { followRootBlocks } from './outputs.ts'
import type { SessionDeformation } from './session.ts'

/** The animation's setting `field` the session holds (`animationOptions.ts`), by its one
 *  resolver, read at each frame. */

/** Root `rank` reaches `reach` this frame, `moved` saying whether what it draws moved: its reach
 *  set for the CPU cut (`ClusterRoot.reach`) and in its mark for the GPU cut, and, when it moved
 *  or its reach changed, the root declared to the shadow scheduler with its rest box grown by the
 *  most it reached. */
function followReach(rt: WebgpuPagesRuntime, rank: number, reach: number, moved: boolean) {
  const root = rt.layout.selectionRoots[rank],
    before = root.reach ?? 0
  const grew = holdReach(rt, rank, reach)
  if (moved || grew) noteDeformed(rt, rank, Math.max(before, reach) * worldStretch(root))
}

/** The tracks of the animation banks this frame (`bankTracks.ts`): their table written from the
 *  clocks under the run-time settings, each banked root's state taken for the view `cam`, the rows
 *  of a root whose state changed pointed at what it reads now, and every banked root's reach
 *  followed. */
function playTracks(rt: WebgpuPagesRuntime, deformation: SessionDeformation, cam: EngineCamera) {
  const { tracks } = deformation
  if (!tracks.count) return
  tracks.write(
    readAnimationSetting(rt, 'animationBankTimeScale'),
    readAnimationSetting(rt, 'animationBankInterpolation'),
  )
  tracks.play(cam, readAnimationSetting(rt, 'animationMinScreenSize'))
  const { roots } = tracks
  for (let k = 0; k < roots.length; k++) {
    const { rank, root, flipped, reach, moved } = roots[k]
    if (flipped) {
      followRootBlocks(rt, root, rank)
      // Whether it deforms is what it reads: its shadow word is written again.
      rt.lights.mobility.touch(rank)
    }
    followReach(rt, rank, reach, moved)
  }
}

/**
 * Brings the session's GPU deformation to this image, once its poses are uploaded: each
 * deformed root's record rewritten — this frame's palette, weights and wave phases beside the last
 * frame's — and the block sent to the float pool when one moved; each root's reach followed
 * (`followReach`); each page the waves alone carry bounded where they carry it (`wavePages.ts`).
 * Every record deforms, whatever its root's size on screen. The roots that can play a track of
 * the animation banks follow theirs (`playTracks`): the GPU poses the tracks' records
 * (`bankWgsl.ts`), and such a root rests under its screen size. Returns whether a record moved.
 */
export function updateWebgpuDeformation(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const deformation = rt.vis.deformation,
    device = rt.gpu.device,
    pool = rt.vis.concatPos
  if (!deformation?.any || !device || !pool) return false
  const roots = rt.layout.selectionRoots,
    frame = deformation.frame
  const moved = deformation.update(rt.run.frame)
  for (let i = 0; i < roots.length; i++) {
    const entry = deformation.entryOf(i)
    if (frame.bases[entry] && !deformation.tracks.plays(i))
      followReach(rt, i, frame.reach[entry], frame.dirty[entry] === 1)
  }
  playTracks(rt, deformation, cam)
  updateWavePages(rt, deformation)
  if (moved) device.queue.writeBuffer(pool, deformation.base * 4, frame.block)
  return moved
}
