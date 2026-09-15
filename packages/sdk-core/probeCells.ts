import { PROXY_TRIANGLE_FLOATS, type SceneProxy } from './proxyContracts.ts';
import { type ProbeGrid } from './bounceContracts.ts';

/**
 * Les mailles de la grille qui méritent une sonde.
 *
 * Une grille régulière posée sur l'emprise d'une scène passe l'essentiel de son budget sur du vide :
 * sur une place de ville, les trois quarts des étages de sondes sont du ciel, et personne ne lira
 * jamais ce qu'ils savent. Or l'irradiance n'est relue qu'en des points de surface, et un point de
 * surface n'interpole que les huit sondes de sa maille. Il suffit donc de garder les mailles qui
 * touchent de la géométrie, plus une couronne d'une maille autour d'elles : les huit coins d'une
 * maille occupée sont alors toujours présents, et rien de ce qui sert n'est perdu.
 *
 * Le reste — le ciel vide, le cœur d'un bloc plein — n'est pas mis à jour : le budget de rayons de
 * l'image va aux sondes qui comptent. Une sonde absente n'a jamais été écrite, donc elle se déclare
 * inutilisable et ne pèse rien dans l'interpolation : là où aucune sonde ne voit le point, le
 * rebond vaut exactement zéro, comme avant.
 *
 * Rien ici ne nomme une scène ni ne regarde la caméra : une emprise, une grille, des triangles.
 */
export function probeCellsOf(proxy: SceneProxy, grid: ProbeGrid): Uint32Array {
  const [nx, ny, nz] = grid.counts;
  const total = nx * ny * nz;
  const keep = new Uint8Array(total);
  const triangles = proxy.data.triangles;
  const low = [0, 0, 0],
    high = [0, 0, 0];
  for (
    let base = 0;
    base + PROXY_TRIANGLE_FLOATS <= triangles.length;
    base += PROXY_TRIANGLE_FLOATS
  ) {
    for (let axis = 0; axis < 3; axis++) {
      const origin = grid.origin[axis],
        step = grid.spacing[axis];
      const a = (triangles[base + axis] - origin) / step,
        b = (triangles[base + 3 + axis] - origin) / step,
        c = (triangles[base + 6 + axis] - origin) / step;
      // La maille d'un sommet, puis la couronne d'une maille : `-1` et `+1` autour de l'intervalle.
      low[axis] = Math.floor(Math.min(a, b, c)) - 1;
      high[axis] = Math.floor(Math.max(a, b, c)) + 1;
    }
    mark(keep, grid.counts, low, high);
  }
  const cells: number[] = [];
  for (let cell = 0; cell < total; cell++) if (keep[cell]) cells.push(cell);
  return Uint32Array.from(cells);
}

/** Marque toutes les mailles d'un pavé, bornes comprises, en restant dans la grille. */
function mark(
  keep: Uint8Array,
  counts: readonly [number, number, number],
  low: number[],
  high: number[],
) {
  const [nx, ny, nz] = counts;
  // Hors grille des deux côtés : un pavé entièrement au-delà d'une borne ne marque rien.
  if (low[0] >= nx || low[1] >= ny || low[2] >= nz) return;
  if (high[0] < 0 || high[1] < 0 || high[2] < 0) return;
  const x0 = Math.max(0, low[0]),
    y0 = Math.max(0, low[1]),
    z0 = Math.max(0, low[2]);
  const x1 = Math.min(nx - 1, high[0]),
    y1 = Math.min(ny - 1, high[1]),
    z1 = Math.min(nz - 1, high[2]);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const row = nx * (y + ny * z);
      for (let x = x0; x <= x1; x++) keep[row + x] = 1;
    }
}
