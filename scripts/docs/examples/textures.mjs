import { encodePng } from '../../../packages/sdk-node/png.mts';

/** A square PNG of `size` texels whose texel (x, y) is the `[r, g, b, a]` `sample` returns, 0..1. */
function image(size, sample) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      sample(x / size, y / size).forEach((value, channel) => {
        rgba[(y * size + x) * 4 + channel] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      });
  return encodePng(size, size, rgba);
}

/** A checkerboard of `cells` squares per side, sRGB colours `a` and `b`. */
export const checker = (cells, a, b) =>
  image(256, (u, v) => ((Math.floor(u * cells) + Math.floor(v * cells)) % 2 ? a : b));

/** Vertical stripes, `count` per width, sRGB colours `a` and `b`. */
export const stripes = (count, a, b) => image(256, (u) => (Math.floor(u * count) % 2 ? a : b));

/**
 * The tangent-space normal map of a brick wall: `rows` courses of bricks, every second course
 * offset by half a brick, each brick a slightly rounded slab standing out of the mortar. The map
 * is the normalised gradient of that height field, encoded as glTF reads it (green up).
 */
export function brickNormals(rows, columns, size = 512) {
  const height = (u, v) => {
    const course = Math.floor(v * rows),
      shift = course % 2 ? 0.5 / columns : 0,
      x = ((u + shift) * columns) % 1,
      y = (v * rows) % 1,
      mortar = 0.08,
      inside = Math.min(x, 1 - x, (y * columns) / rows, ((1 - y) * columns) / rows);
    return inside < mortar ? 0 : Math.min(1, (inside - mortar) / 0.06);
  };
  const step = 1 / size;
  return image(size, (u, v) => {
    const dx = (height(u + step, v) - height(u - step, v)) * 4,
      dy = (height(u, v + step) - height(u, v - step)) * 4,
      length = Math.hypot(dx, dy, 1);
    return [0.5 - dx / length / 2, 0.5 + dy / length / 2, 0.5 + 1 / length / 2, 1];
  });
}

/** A leaf: green inside an almond outline with a darker midrib, transparent outside it. */
export const leaf = () =>
  image(256, (u, v) => {
    const along = v,
      width = 0.42 * Math.sin(Math.PI * along) ** 0.8,
      across = Math.abs(u - 0.5),
      inside = across < width,
      rib = across < 0.012 && along > 0.05 && along < 0.9;
    return inside ? [rib ? 0.2 : 0.3 - along * 0.08, rib ? 0.35 : 0.55, 0.12, 1] : [0, 0, 0, 0];
  });
