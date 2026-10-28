/**
 * THE IMAGE NUMBER (`run.frame`), advanced at one place, once per frame entry (`renderWebgpuPages`). An image drawn counts, and so does
 * a still image held (`frameHeld`): the page waits for it. A frame held on an answer still in flight, or on targets not granted (`holdWebgpuFrame`), drew nothing and
 * is no image, so that a world whose programs compile meanwhile meets the same image number as a world that did not (the lighting's noise,
 * the caches' clocks and the pages' order follow it): our image depends on the scene and on the images drawn, never on how long a
 * compile took.
 */
export function advanceImageNumber(
  run: { frame: number; readonly frameHeld: boolean; readonly heldEmpty: boolean },
  held: boolean,
) {
  if (!held || (run.frameHeld && !run.heldEmpty)) run.frame++
}
