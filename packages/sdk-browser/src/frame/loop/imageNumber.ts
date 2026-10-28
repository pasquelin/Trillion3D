/**
 * THE IMAGE NUMBER (`run.frame`), advanced once per frame entry (`renderWebgpuPages`) after the image's passes have encoded, so that the hold's decision and every pass read the same number.
 * An image drawn counts, and so does a still image held (`frameHeld`): the page waits for it. A frame held on an answer in flight or on targets not granted drew nothing and is no image:
 * the number depends on the scene and the images drawn, never on how long a compile took.
 */
export function advanceImageNumber(
  run: { frame: number; readonly frameHeld: boolean; readonly heldEmpty: boolean },
  held: boolean,
) {
  if (!held || (run.frameHeld && !run.heldEmpty)) run.frame++
}
