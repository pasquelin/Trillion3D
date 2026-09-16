// C2 : la pyramide Hi-Z du chemin par image passe d'un `number[][][]` réalloué à un seul
// `Float32Array` repris d'une image à l'autre (hizPyramidFlat.ts). La référence est l'implémentation
// d'avant le lot C, toujours présente et inchangée : `hizBuildPyramid`/`hizFootprintFar` de
// `hizOracles.ts`, exportées telles quelles pour continuer à servir d'oracle. L'égalité attendue est
// bit à bit (`Object.is`), sans tolérance : la réduction est un minimum, jamais une
// opération arithmétique qui pourrait arrondir différemment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hizBuildPyramid,
  hizFootprintFar,
  hizBuildFlat,
  hizFlatLayout,
  hizFootprintFarFlat,
  type HizFlat,
} from './index.ts';

/** Les niveaux imbriqués attendus, comparés valeur par valeur au tampon plat. */
function assertSamePyramid(flat: HizFlat, nested: number[][][], message: string) {
  assert.equal(flat.count, nested.length, `${message} : nombre de niveaux`);
  for (let level = 0; level < flat.count; level++) {
    const rows = nested[level];
    const height = rows.length,
      width = height ? rows[0].length : 0;
    assert.equal(flat.widths[level], width, `${message} niveau ${level} largeur`);
    assert.equal(flat.heights[level], height, `${message} niveau ${level} hauteur`);
    const base = flat.offsets[level];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        assert.ok(
          Object.is(flat.data[base + y * width + x], rows[y][x]),
          `${message} niveau ${level} [${y},${x}] : ${flat.data[base + y * width + x]} ≠ ${rows[y][x]}`,
        );
  }
}

function rows(depth: Float32Array, width: number, height: number) {
  const out: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = depth[y * width + x];
    out.push(row);
  }
  return out;
}

test('une image de taille nulle est rejetée, plate comme imbriquée', () => {
  assert.throws(() => hizFlatLayout(0, 4), /HIZ_DEPTH_SIZE/);
  assert.throws(() => hizFlatLayout(4, 0), /HIZ_DEPTH_SIZE/);
  assert.throws(() => hizBuildFlat(new Float32Array(0), 0, 0), /HIZ_DEPTH_SIZE/);
});

test('une image 1×1 ne réduit rien, des deux côtés', () => {
  const depth = new Float32Array([0.42]);
  const flat = hizBuildFlat(depth, 1, 1);
  const nested = hizBuildPyramid(rows(depth, 1, 1));
  assertSamePyramid(flat, nested, '1×1');
  assert.equal(flat.count, 1);
});

test('des dimensions impaires (33×19) réduisent identiquement', () => {
  const depth = new Float32Array(33 * 19);
  for (let i = 0; i < depth.length; i++) depth[i] = Math.sin(i * 0.37) * 0.5 + 0.5;
  const flat = hizBuildFlat(depth, 33, 19);
  const nested = hizBuildPyramid(rows(depth, 33, 19));
  assertSamePyramid(flat, nested, '33×19');
});

test('NaN, Infinity, -Infinity et -0 se propagent à l’identique', () => {
  const depth = new Float32Array(8 * 8);
  depth.fill(0.3);
  const hostiles = [NaN, Infinity, -Infinity, -0];
  for (let i = 0; i < hostiles.length; i++) depth[i * 9] = hostiles[i];
  const flat = hizBuildFlat(depth, 8, 8);
  const nested = hizBuildPyramid(rows(depth, 8, 8));
  assertSamePyramid(flat, nested, 'valeurs hostiles');
});

test('`into` est repris d’une image à l’autre sans changer le résultat', () => {
  const first = new Float32Array(4 * 4);
  first.fill(0.1);
  let into = hizBuildFlat(first, 4, 4);
  const buffer = into.data;
  const second = new Float32Array(4 * 4);
  second.fill(0.9);
  second[5] = NaN;
  into = hizBuildFlat(second, 4, 4, into);
  assert.equal(into.data, buffer, 'même tampon réutilisé');
  const nested = hizBuildPyramid(rows(second, 4, 4));
  assertSamePyramid(into, nested, 'image reprise');
});

test('hizFootprintFarFlat rend le même verdict que hizFootprintFar, y compris hors champ', () => {
  const depth = new Float32Array(33 * 19);
  for (let i = 0; i < depth.length; i++) depth[i] = ((i * 31) % 97) / 97;
  depth[18 * 33 + 32] = 1;
  const flat = hizBuildFlat(depth, 33, 19);
  const nested = hizBuildPyramid(rows(depth, 33, 19));
  const cas: Array<[number, number, number, number, number]> = [
    [0, 0, 33, 19, 0],
    [0, 0, 32, 18, 2],
    [5, 5, 5, 5, 1],
    [-3, -3, 40, 25, 0],
    [0, 0, 1, 1, 99],
  ];
  for (const [x0, y0, x1, y1, level] of cas) {
    const attendu = hizFootprintFar(nested, x0, y0, x1, y1, level);
    const obtenu = hizFootprintFarFlat(flat, x0, y0, x1, y1, level);
    assert.ok(
      Object.is(attendu, obtenu),
      `[${x0},${y0},${x1},${y1}]@${level}: ${attendu} ≠ ${obtenu}`,
    );
  }
});
