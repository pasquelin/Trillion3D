import { viewKey } from './viewKey.ts'

/**
 * A value one stage publishes for the passes after it, by view (`viewKey`): given with the image
 * being drawn, none (`undefined`) where the stage made none, read through the view's gpu group.
 * The value is held weakly with the key and owned by the stage that made it: nothing is released here.
 */
export function viewPublished<T extends object>() {
  const published = new WeakMap<object, T>()
  return {
    /** The value the last image of `gpu` published, none where it published none. */
    of: (gpu: { viewKey?: object }): T | undefined => published.get(viewKey(gpu)),
    /** Gives the value of the image being drawn, or none (`undefined`). */
    publish(gpu: { viewKey?: object }, value: T | undefined) {
      if (value) published.set(viewKey(gpu), value)
      else published.delete(viewKey(gpu))
    },
  }
}
