/** An upload image's words from an offset to its end, read three ways. */
export type WordViews = {
  u: Uint32Array<ArrayBuffer>
  i: Int32Array<ArrayBuffer>
  f: Float32Array<ArrayBuffer>
}

const VIEWS = new WeakMap<ArrayBuffer, Map<number, WordViews>>()

/** The unsigned, signed and float word views of `image` from `byteOffset` to its end, made once
 *  per image and offset: a writer that fills the image every frame allocates nothing. */
export function wordViews(image: ArrayBuffer, byteOffset = 0): WordViews {
  let at = VIEWS.get(image)
  if (!at) VIEWS.set(image, (at = new Map()))
  let views = at.get(byteOffset)
  if (!views)
    at.set(
      byteOffset,
      (views = {
        u: new Uint32Array(image, byteOffset),
        i: new Int32Array(image, byteOffset),
        f: new Float32Array(image, byteOffset),
      }),
    )
  return views
}
