/** The images a view or a scene keeps a resource for after it stopped asking for it: a short pause (a toggle for an image) remakes nothing. */
const IDLE_KEEP_IMAGES = 120

/** Whether something last used at image `since` has gone unused for `IDLE_KEEP_IMAGES` images at image `frame`. */
export const idleTooLong = (frame: number, since: number) => frame - since >= IDLE_KEEP_IMAGES
