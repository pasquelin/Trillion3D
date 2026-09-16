/**
 * Couleurs du socle mathématique : la courbe de transfert sRGB par morceaux, telle que le dépôt
 * l'écrit partout (seuils 0,04045 et 0,0031308, pente 12,92, exposant 2,4), la même que le
 * compilateur Rust et que la composition WGSL. La bibliothèque 3D de référence arrondit ses
 * constantes (`c · 0,0773993808`, `c · 0,9478672986 + 0,0521327014`) : l'écart est chiffré au banc
 * `sdk-browser/bench/socle-math.bench.mjs`, et ce n'est pas elle qui décide ici.
 */

import type { NumberSink } from './mathMatrix4.ts';

/** Valeur sRGB encodée dans `[0, 1]` vers sa valeur linéaire. */
export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Valeur linéaire vers sa valeur sRGB encodée, négatifs ramenés à zéro avant l'exposant. */
export function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
}

/** `t` ramené dans `[0, 1[` par le modulo euclidien de la référence : `((t % 1) + 1) % 1`. */
const wrapUnit = (t: number) => ((t % 1) + 1) % 1;

/** Une composante de la conversion TSL → RVB, la rampe par morceaux de la référence. */
function hueComponent(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

/**
 * Teinte, saturation et luminosité vers trois composantes linéaires écrites en `out[o..o+2]`.
 *
 * C'est `setHSL` de la référence, terme à terme : teinte repliée, saturation et luminosité bornées à
 * `[0, 1]`, saturation nulle rendue en gris, puis la rampe par morceaux. Aucune courbe de transfert
 * n'est appliquée — l'espace de travail de la référence est déjà linéaire, sa conversion y est
 * l'identité.
 */
export function hslToLinearRgb(out: NumberSink, o: number, h: number, s: number, l: number) {
  const hue = wrapUnit(h),
    saturation = Math.max(0, Math.min(1, s)),
    lightness = Math.max(0, Math.min(1, l));
  if (saturation === 0) {
    out[o] = out[o + 1] = out[o + 2] = lightness;
    return;
  }
  const p =
      lightness <= 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation,
    q = 2 * lightness - p;
  out[o] = hueComponent(q, p, hue + 1 / 3);
  out[o + 1] = hueComponent(q, p, hue);
  out[o + 2] = hueComponent(q, p, hue - 1 / 3);
}
