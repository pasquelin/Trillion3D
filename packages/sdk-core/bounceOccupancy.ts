import { PROXY_TRIANGLE_FLOATS, type SceneProxy } from './proxyContracts.ts';
import type { BounceCascades } from './bounceCascades.ts';

/**
 * Où il vaut la peine de tenir une sonde : la carte d'occupation des cascades.
 *
 * Une cascade posée sur une ville passe l'essentiel de ses mailles sur du ciel vide et sur le cœur
 * plein des blocs, où personne ne relira jamais une irradiance. L'ordonnanceur a donc besoin de
 * savoir, avant de dépenser un rayon, si une maille touche de la géométrie. C'est une propriété du
 * monde, pas de la caméra : elle se calcule une fois, à la construction, et vaut pour toutes les
 * positions que les niveaux mobiles prendront ensuite.
 *
 * La carte du niveau le plus fin est marquée par les boîtes des triangles du proxy, plus une
 * couronne d'une maille : les huit coins d'une maille occupée sont alors toujours tenus, et rien de
 * ce qui sert n'est perdu. Les niveaux suivants en sont la réduction exacte — deux mailles pour
 * une sur chaque axe, puisque leurs écartements sont des puissances de deux du plus fin — puis
 * dilatés à leur tour d'une maille, pour la même raison.
 *
 * Rien ici ne nomme une scène ni ne regarde la caméra : une emprise, des triangles, des mailles.
 */
export interface BounceOccupancy {
  /** Vrai quand la maille d'un niveau, dans le réseau global de ce niveau, mérite une sonde. */
  occupied(level: number, x: number, y: number, z: number): boolean;
  /** Mailles marquées et mailles totales du niveau le plus fin : le gain, publié. */
  marked: number;
  cells: number;
  bytes: number;
}

/** Marque un pavé de mailles, bornes comprises, en restant dans la carte. */
function mark(map: Uint8Array, dims: number[], low: number[], high: number[]) {
  const x0 = Math.max(0, low[0]),
    y0 = Math.max(0, low[1]),
    z0 = Math.max(0, low[2]);
  const x1 = Math.min(dims[0] - 1, high[0]),
    y1 = Math.min(dims[1] - 1, high[1]),
    z1 = Math.min(dims[2] - 1, high[2]);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const row = dims[0] * (y + dims[1] * z);
      for (let x = x0; x <= x1; x++) map[row + x] = 1;
    }
}

/** La réduction d'une carte : une maille du niveau suivant est marquée si l'une des huit l'est. */
function reduce(map: Uint8Array, dims: number[]) {
  const next = dims.map((size) => Math.max(1, Math.ceil(size / 2)));
  const out = new Uint8Array(next[0] * next[1] * next[2]);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        if (!map[x + dims[0] * (y + dims[1] * z)]) continue;
        const half = [x >> 1, y >> 1, z >> 1];
        out[half[0] + next[0] * (half[1] + next[1] * half[2])] = 1;
      }
  return { map: out, dims: next };
}

/** Dilate une carte d'une maille dans les trois axes : la couronne que l'interpolation demande. */
function dilate(map: Uint8Array, dims: number[]) {
  const out = new Uint8Array(map.length);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        if (!map[x + dims[0] * (y + dims[1] * z)]) continue;
        mark(out, dims, [x - 1, y - 1, z - 1], [x + 1, y + 1, z + 1]);
      }
  return out;
}

export function createBounceOccupancy(
  proxy: SceneProxy,
  cascades: BounceCascades,
): BounceOccupancy {
  const spacing = cascades.levels[0].spacing;
  // L'origine et les dimensions sont alignées sur la plus grosse réduction : sans cela une maille
  // d'un niveau grossier ne serait pas exactement le bloc de huit du niveau précédent, et la
  // réduction mentirait d'une maille sur deux.
  const align = 2 ** (cascades.levels.length - 1);
  const floorTo = (value: number) => Math.floor(value / align) * align;
  const origin = [0, 1, 2].map((axis) => floorTo(Math.floor(proxy.bounds[axis] / spacing) - 2));
  const dims = [0, 1, 2].map((axis) =>
    Math.max(
      align,
      floorTo(Math.floor(proxy.bounds[3 + axis] / spacing) + 3 - origin[axis]) + align,
    ),
  );
  let map = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const cells = map.length;
  const triangles = proxy.data.triangles;
  const low = [0, 0, 0],
    high = [0, 0, 0];
  for (
    let base = 0;
    base + PROXY_TRIANGLE_FLOATS <= triangles.length;
    base += PROXY_TRIANGLE_FLOATS
  )
    for (let axis = 0; axis < 3; axis++) {
      const a = triangles[base + axis],
        b = triangles[base + 3 + axis],
        c = triangles[base + 6 + axis];
      low[axis] = Math.floor(Math.min(a, b, c) / spacing) - origin[axis];
      high[axis] = Math.floor(Math.max(a, b, c) / spacing) - origin[axis];
      if (axis === 2) mark(map, dims, low, high);
    }
  map = dilate(map, dims);
  const maps = [{ map, dims, origin }];
  let bytes = map.length;
  for (let level = 1; level < cascades.levels.length; level++) {
    const reduced = reduce(maps[level - 1].map, maps[level - 1].dims);
    const dilated = dilate(reduced.map, reduced.dims);
    maps.push({
      map: dilated,
      dims: reduced.dims,
      origin: maps[level - 1].origin.map((value) => value / 2),
    });
    bytes += dilated.length;
  }
  return {
    cells,
    bytes,
    marked: maps[0].map.reduce((sum, value) => sum + value, 0),
    occupied(level, x, y, z) {
      const entry = maps[Math.min(level, maps.length - 1)];
      const local = [x - entry.origin[0], y - entry.origin[1], z - entry.origin[2]];
      if (local.some((value, axis) => value < 0 || value >= entry.dims[axis])) return false;
      return entry.map[local[0] + entry.dims[0] * (local[1] + entry.dims[1] * local[2])] === 1;
    },
  };
}
