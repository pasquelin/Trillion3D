// Profondeur INVERSÉE : une boîte n'est cachée que si sa borne la plus proche est PLUS PETITE que
// l'occulteur le plus lointain de son empreinte. Une borne sûre MAJORE donc ce que le cluster
// écrira — l'inverse exact du sens qu'elle avait en profondeur directe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_LAYER_BIAS_UNITS } from '../sdk-core/index.ts';
import { hizNearestBound } from './hizNearestBound.ts';
import { hizRejects, type HizBounds, type HizPyramid } from './hiz.ts';

const f32 = new Float32Array(1),
  bits = new Uint32Array(f32.buffer);
const patternOf = (value: number) => {
  f32[0] = value;
  return bits[0];
};

/** Deux `float32` voisins, et un double entre eux dont l'arrondi au plus proche **descend**. */
function voisins() {
  f32[0] = 0.75;
  const low = f32[0];
  bits[0] += 1;
  const high = f32[0];
  return { low, high, between: low + (high - low) * 0.2 };
}

test('la borne envoyée au noyau ne descend jamais sous la profondeur qu elle majore', () => {
  const { low, high, between } = voisins();
  assert.ok(Math.fround(between) < between, 'le cas choisi doit arrondir vers le bas');
  assert.equal(Math.fround(between), low);
  assert.ok(hizNearestBound(between, 0) >= between);
  assert.equal(hizNearestBound(between, 0), high);
  // Sur toute une plage de profondeurs, y compris des valeurs déjà représentables et des valeurs
  // juste au-dessous d'un `float32`, la borne reste au-dessus de son entrée.
  for (const base of [1e-7, 0.001, 0.5, low, high, 0.9999999, 1]) {
    for (const value of [base, base * (1 + 1e-9), base * (1 - 1e-9)]) {
      const bound = hizNearestBound(value, 0);
      assert.ok(bound >= value, `hizNearestBound(${value})=${bound}`);
      assert.equal(bound, Math.fround(bound), 'la borne est un float32 exact');
      assert.ok(bound < value * (1 + 1e-6), 'et elle ne monte que d un ulp');
    }
  }
  // Zéro et les valeurs négatives — qui ne rejettent jamais rien — sont rendues telles quelles.
  assert.equal(hizNearestBound(0, 3), 0);
  assert.equal(hizNearestBound(-0.25, 3), -0.25);
});

test('une couche coplanaire ajoute à la borne exactement les unités dont elle avance le cluster', () => {
  const nearest = 0.875;
  assert.equal(hizNearestBound(nearest, 0), Math.fround(nearest * (1 + 2 ** -24)));
  for (const layer of [1, 2, 7, 15]) {
    const bound = hizNearestBound(nearest, layer);
    assert.equal(
      patternOf(bound),
      patternOf(hizNearestBound(nearest, 0)) + layer * DEPTH_LAYER_BIAS_UNITS,
      `couche ${layer}`,
    );
    assert.ok(bound > nearest);
  }
  // Une profondeur au ras du plan proche ne peut pas le dépasser.
  assert.ok(hizNearestBound(1, 15) <= 1);
});

/** Une pyramide d'un seul texel, dont la profondeur est `far`. */
function pyramide(far: number): HizPyramid {
  return {
    data: Float32Array.from([far]),
    offsets: Int32Array.from([0]),
    widths: Int32Array.from([1]),
    heights: Int32Array.from([1]),
    count: 1,
  };
}

const box = (nearestDepth: number): HizBounds => ({
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  nearestDepth,
  clipsNear: false,
});

test('la borne corrigée ne peut que faire dessiner davantage, jamais moins', () => {
  const { low, high, between } = voisins();
  // La pyramide voit exactement `high` : la borne arrondie au plus proche rejetterait un cluster qui
  // peint encore son pixel, la borne corrigée ne le rejette pas.
  const pyramid = pyramide(high);
  assert.equal(hizRejects(pyramid, box(Math.fround(between))), true);
  assert.equal(hizRejects(pyramid, box(hizNearestBound(between, 0))), false);
  // Et sur un cluster franchement derrière, le rejet reste acquis.
  assert.equal(hizRejects(pyramid, box(hizNearestBound(low - (high - low) * 64, 0))), true);
  // Un cluster de couche 1 dont le coin est derrière l'occulteur d'exactement le biais de sa couche
  // sera dessiné devant lui : sans la correction il serait rejeté, avec elle il ne l'est plus.
  const derriere = new Float32Array(1);
  derriere[0] = high;
  new Uint32Array(derriere.buffer)[0] -= DEPTH_LAYER_BIAS_UNITS;
  assert.equal(hizRejects(pyramid, box(derriere[0])), true);
  assert.equal(hizRejects(pyramid, box(hizNearestBound(derriere[0], 1))), false);
});
