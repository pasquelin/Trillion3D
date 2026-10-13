/**
 * The UV transform of a texture (`Texture.transform`): its stretch, turn and slide composed into a
 * 3 × 3 matrix, column-major — entries 0 to 2 the first column, 6 and 7 the slide. The pivot of the
 * turn is the origin: the expression is the general one with a centre of zero, written out, so the
 * doubles — and the f32 bits a sampling word takes of them — are those of the composition with a
 * centre (`-0` products included).
 */
export function composeUvTransform(
  into: Float64Array,
  offset: { readonly x: number; readonly y: number },
  repeat: { readonly x: number; readonly y: number },
  rotation: number,
) {
  const [tx, ty, sx, sy] = [offset.x, offset.y, repeat.x, repeat.y]
  const [cx, cy, c, s] = [0, 0, Math.cos(rotation), Math.sin(rotation)]
  into[0] = sx * c
  into[1] = -sy * s
  into[2] = 0
  into[3] = sx * s
  into[4] = sy * c
  into[5] = 0
  into[6] = -sx * (c * cx + s * cy) + cx + tx
  into[7] = -sy * (-s * cx + c * cy) + cy + ty
  into[8] = 1
}
