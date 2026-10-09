/**
 * THE WORLD'S TRANSITIONS, DITHERED IN TIME.
 *
 * Where a placement hands over to its world group, or a super-root to the region above it, the cut
 * switches at the threshold: held there, a camera on the move would see the switch at one distance.
 * Each cut holds the world DAG instead to the frame's threshold `t` scaled by `s` in
 * `(1 − WORLD_FADE, 1]`, a new one each cut the camera moved for, and its placements' links with it
 * (`worldCovers`, `thresholdOf`, `shader/placementTreeWgsl.ts`): a group whose error projects to `p`
 * within `(t · (1 − WORLD_FADE), t]` is drawn by its placements in a share
 * `(p/t − 1 + WORLD_FADE) / WORLD_FADE` of those cuts and by its super-roots in the others, never
 * both in one, and the temporal antialiasing averages them into a cross-fade over that band. `s`
 * never exceeds one: the world's error never passes the frame's threshold. A camera that stops
 * keeps its last scale whatever it cuts — pages arriving cut again —: the image settles on one
 * choice, and no hand-over flickers.
 *
 * The scales follow the golden-ratio sequence, of low discrepancy: any run of cuts covers the band
 * evenly, its first cuts already spread over it.
 */
import { GOLDEN_FRACTION } from '../../../../math/src/constants.ts'
import { fract } from '../../../../math/src/scalar/reals.ts'

/** The band's width, a fraction of the threshold: an octave, the world group above a cluster
 *  holding at least twice its error where the cook's reduction halves its triangles. A wider band
 *  fades over a longer distance and draws finer on average. */
const WORLD_FADE = 0.5

/** The scale of the world DAG's threshold at cut `cut`: the sequence steps by `(√5 − 1) / 2`. */
export const worldFadeScale = (cut: number) => 1 - WORLD_FADE * fract(cut * GOLDEN_FRACTION)
