/**
 * The corners of a segment's two triangles, as bits by the rank (0 to 5) of the corner among the
 * six a segment is drawn with: whether it lies at the segment's tip (the next control point), and
 * whether it lies on the strand's right. A group built for a strip of triangles (a curve given one
 * control point more at its end) cuts the ribbon along one diagonal, any other along the other.
 */
export const HAIR_RIBBON_CORNERS = {
  strip: { tips: 0b110100, rights: 0b011010 },
  list: { tips: 0b101010, rights: 0b011100 },
} as const
