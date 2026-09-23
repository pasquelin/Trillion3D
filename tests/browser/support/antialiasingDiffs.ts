// Pixel classification for the temporal antialiasing proof: which pixels of an image moved, at an
// edge or inside a surface, once accumulation is on.

/** Reach of accumulation around an edge, in pixels: half a jitter and the current image's
 *  3×3 filter cover one and a half pixels, hence two whole pixels. */
const PORTEE = 2;

/** True when, in `pixels`, a pixel within `PORTEE` of `(x, y)` has another colour: an edge. */
export function auBord(pixels: number[], x: number, y: number, largeur: number, hauteur: number) {
  const i = (y * largeur + x) * 4;
  for (let dy = -PORTEE; dy <= PORTEE; dy++)
    for (let dx = -PORTEE; dx <= PORTEE; dx++) {
      const px = x + dx,
        py = y + dy;
      if (px < 0 || py < 0 || px >= largeur || py >= hauteur) continue;
      const j = (py * largeur + px) * 4;
      if (
        pixels[i] !== pixels[j] ||
        pixels[i + 1] !== pixels[j + 1] ||
        pixels[i + 2] !== pixels[j + 2]
      )
        return true;
    }
  return false;
}

/** Pixels where `a` and `b` differ by more than `tolerance` per channel, classed edge / interior
 *  from `b`, the image without accumulation. */
export function ecarts(
  a: number[],
  b: number[],
  tolerance: number,
  largeur: number,
  hauteur: number,
) {
  let bords = 0,
    interieur = 0,
    max = 0;
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
      max = Math.max(max, d);
      if (d <= tolerance) continue;
      if (auBord(b, x, y, largeur, hauteur)) bords++;
      else interieur++;
    }
  return { bords, interieur, max };
}
