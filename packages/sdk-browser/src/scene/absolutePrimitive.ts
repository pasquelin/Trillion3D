import type { Primitive } from '../../../sdk-core/src/index.ts'

/** A primitive's page addresses made absolute against `base`, the folder its manifest was read
 *  from: what a session merging several models, or mounting one's primitive later, reads. */
export function absolutePrimitive(primitive: Primitive, base: string): Primitive {
  const at = (url: string) => new URL(url, base).href
  return {
    ...primitive,
    pages: primitive.pages.map((page) => ({
      ...page,
      url: at(page.url),
      ...(page.geometry ? { geometry: { ...page.geometry, url: at(page.geometry.url) } } : {}),
    })),
    streams: primitive.streams
      ? {
          ...primitive.streams,
          pages: primitive.streams.pages.map((b) => ({ ...b, url: at(b.url) })),
        }
      : primitive.streams,
  }
}
