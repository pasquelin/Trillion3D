import { surfaceOf, type PageSurface } from '../../../../packages/sdk-browser/src/page/surface.ts';
// Bench inputs: realistic (a cut of thousands of pages in front of a camera) and hostile
// (degenerate triangles, vertices behind the camera, NaN, Infinity, -0, empty or inverted boxes).
// Everything comes from a seeded generator: two runs see the exact same floats.
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { graine } from '../../../core/index.ts';

export function camera(z = 6, near = 0.1, aspect = 16 / 9) {
  const cam = G.perspectiveCamera(55, aspect, near, 200);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

const MAUVAIS = [NaN, Infinity, -Infinity, -0];

/** A page of triangles as `coupe` produces it: geometry, material and its world-space box. */
export interface ScenePage {
  array: Uint32Array;
  attributes: { position: G.GraphAttribute };
  matrix: G.Matrix4;
  material: PageSurface;
  clusterId: string;
  url: string;
  min: number[];
  max: number[];
  triangles: number;
}

/** A box only, without geometry: what Hi-Z projects and sorts. */
export interface SceneBox {
  min: number[];
  max: number[];
  matrix: G.Matrix4;
  url: string;
  array: Uint32Array;
}

/** `[x0, y0, x1, y1, huge]`: a screen rectangle that `hizTestRect` must classify. */
export type SceneRect = [number, number, number, number, boolean];

/**
 * A page of `triangles` triangles placed at random in a tile. `hostile` replaces some
 * vertices with values the hot path must walk without flinching: a degenerate zero-area
 * triangle, a vertex behind the camera, a non-finite coordinate or a negative zero.
 */
function page(
  alea: () => number,
  index: number,
  triangles: number,
  hostile: boolean,
  material: G.GraphSurface,
  size: number,
): ScenePage {
  const positions = new Float32Array(triangles * 3 * 3),
    indices = new Uint32Array(triangles * 3);
  const px = (alea() - 0.5) * 8,
    py = (alea() - 0.5) * 5,
    pz = (alea() - 0.5) * 4;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t++) {
    const degenere = hostile && t % 37 === 0,
      derriere = hostile && t % 53 === 0,
      casse = hostile && t % 101 === 0;
    const cx = px + (alea() - 0.5) * 3,
      cy = py + (alea() - 0.5) * 2,
      cz = pz + (alea() - 0.5) * 0.5;
    for (let v = 0; v < 3; v++) {
      const at = (t * 3 + v) * 3,
        source = degenere ? 0 : v;
      const y = cy + (source % 2 ? size * 0.9 : -size * 0.9);
      let x = cx + (source - 1) * size,
        z = cz + (alea() - 0.5) * 0.1;
      if (derriere) z = 30;
      if (casse) x = MAUVAIS[(t + v) % MAUVAIS.length];
      positions[at] = x;
      positions[at + 1] = y;
      positions[at + 2] = z;
      // Reversed winding: the triangles face the camera, the visbuffer keeps them.
      indices[t * 3 + v] = t * 3 + (2 - v);
      for (let axe = 0; axe < 3; axe++) {
        const valeur = positions[at + axe];
        if (Number.isFinite(valeur)) {
          if (valeur < min[axe]) min[axe] = valeur;
          if (valeur > max[axe]) max[axe] = valeur;
        }
      }
    }
  }
  for (let axe = 0; axe < 3; axe++) {
    if (!Number.isFinite(min[axe])) min[axe] = 0;
    if (!Number.isFinite(max[axe])) max[axe] = 0;
  }
  const attributes = { position: new G.GraphAttribute(positions, 3) };
  return {
    array: indices,
    attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(material),
    clusterId: `0/0/${index}`,
    url: `page-${index}.bin`,
    min,
    max,
    triangles,
  };
}

/** A complete cut: `pages` pages of `triangles` triangles each, in front of the camera. */
export function coupe({
  pages = 200,
  triangles = 24,
  hostile = true,
  seed = 7,
  size = 0.16,
  material,
}: {
  pages?: number;
  triangles?: number;
  hostile?: boolean;
  seed?: number;
  size?: number;
  material?: G.GraphSurface;
} = {}): ScenePage[] {
  const alea = graine(seed),
    mat = material ?? G.basicSurface({ color: 0x88aa44 });
  const liste: ScenePage[] = [];
  for (let i = 0; i < pages; i++) liste.push(page(alea, i, triangles, hostile, mat, size));
  return liste;
}

/**
 * Boxes only, without geometry: what Hi-Z projects and sorts. `degenerees` adds the empty
 * box, the inverted box (min > max), the infinite box and the box that crosses the near plane.
 */
export function boites({
  count = 20000,
  seed = 11,
  degenerees = true,
}: { count?: number; seed?: number; degenerees?: boolean } = {}): SceneBox[] {
  const alea = graine(seed),
    liste: SceneBox[] = [];
  for (let i = 0; i < count; i++) {
    const cx = (alea() - 0.5) * 40,
      cy = (alea() - 0.5) * 24,
      cz = -alea() * 80;
    const demi = 0.05 + alea() * 1.5;
    let min = [cx - demi, cy - demi, cz - demi],
      max = [cx + demi, cy + demi, cz + demi];
    if (degenerees && i % 997 === 0) max = [...min];
    if (degenerees && i % 1499 === 0) {
      const echange = min;
      min = max;
      max = echange;
    }
    if (degenerees && i % 2003 === 0) {
      min = [-Infinity, -Infinity, -Infinity];
      max = [Infinity, Infinity, Infinity];
    }
    if (degenerees && i % 311 === 0) {
      min = [cx - demi, cy - demi, -0.05];
      max = [cx + demi, cy + demi, 8];
    }
    liste.push({
      min,
      max,
      matrix: new G.Matrix4(),
      url: `boite-${i}.bin`,
      array: new Uint32Array(3 * (1 + (i % 40))),
    });
  }
  return liste;
}

/** Screen rectangles that `hizTestRect` must classify: full screen, empty, off-field, huge. */
export function rectangles({
  count = 20000,
  seed = 13,
  width = 1280,
  height = 720,
}: { count?: number; seed?: number; width?: number; height?: number } = {}): SceneRect[] {
  const alea = graine(seed),
    liste: SceneRect[] = [];
  for (let i = 0; i < count; i++) {
    const x0 = Math.floor((alea() - 0.2) * width),
      y0 = Math.floor((alea() - 0.2) * height);
    const largeur = Math.floor(alea() ** 4 * width * 2),
      hauteur = Math.floor(alea() ** 4 * height * 2);
    liste.push([x0, y0, x0 + largeur, y0 + hauteur, i % 173 === 0]);
  }
  liste.push([0, 0, width - 1, height - 1, false], [5, 5, 4, 4, false], [0, 0, 0, 0, false]);
  liste.push([-1000, -1000, -999, -999, false], [0, 0, 1 << 20, 1 << 20, false]);
  return liste;
}
