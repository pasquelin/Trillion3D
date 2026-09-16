// Lot 3, mathCamera.ts : projection perspective en profondeur INVERSÉE et plan lointain infini
// (proche → 1, infini → 0), image de caméra (vue, vue-projection, plans), et allocation : les
// tampons d’une `CameraFrame` sont réécrits, jamais réalloués.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4 } from './mathMatrix4Inverse.ts';
import { multiplyMatrix4 } from './mathMatrix4.ts';
import { createCameraFrame, perspectiveProjection, updateCameraFrame } from './mathCamera.ts';

const proche = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** La profondeur normalisée d’un point de l’axe optique à `distance` de l’œil. */
function profondeur(p: ArrayLike<number>, distance: number) {
  const z = -distance;
  return (p[10] * z + p[14]) / (p[11] * z + p[15]);
}

test('perspectiveProjection : le plan proche se projette sur 1', () => {
  const near = 1;
  const p = perspectiveProjection(new Float64Array(16), 90, 1, near, 1);
  assert.ok(proche(profondeur(p, near), 1), `proche → 1 : ${profondeur(p, near)}`);
});

test('perspectiveProjection : plan lointain infini — la profondeur tend vers 0 sans l’atteindre', () => {
  const near = 0.5;
  const p = perspectiveProjection(new Float64Array(16), 60, 1.5, near, 1);
  // Aucun plan lointain n’entre dans la formule : la ligne de profondeur ne porte que `near`.
  assert.deepEqual([p[10], p[14]], [0, near]);
  for (const distance of [1e3, 1e6, 1e12]) {
    const z = profondeur(p, distance);
    assert.ok(z > 0, `distance ${distance} : profondeur ${z} doit rester strictement positive`);
    assert.ok(z < 1, `distance ${distance} : profondeur ${z} doit rester sous le plan proche`);
  }
});

test('perspectiveProjection : à 10⁶ unités, deux points voisins gardent des profondeurs distinctes en simple précision', () => {
  const near = 0.1;
  const p = perspectiveProjection(new Float64Array(16), 60, 1.5, near, 1);
  // Le cas que la projection directe écrasait : deux surfaces séparées d’un mètre, très loin.
  const proche32 = Math.fround(profondeur(p, 1e6));
  const loin32 = Math.fround(profondeur(p, 1e6 + 1));
  assert.notEqual(proche32, loin32, `10⁶ et 10⁶+1 rendent la même profondeur ${proche32}`);
  assert.ok(proche32 > loin32, 'le plus proche doit porter la plus grande profondeur');
});

test('perspectiveProjection : l’ordre relatif des profondeurs suit l’ordre des distances', () => {
  const p = perspectiveProjection(new Float64Array(16), 45, 1, 0.1, 1);
  const distances = [0.1, 0.5, 1, 7.25, 100, 5_000, 1e6];
  const profondeurs = distances.map((d) => profondeur(p, d));
  for (let i = 1; i < profondeurs.length; i++)
    assert.ok(
      profondeurs[i] < profondeurs[i - 1],
      `${distances[i]} doit être plus loin que ${distances[i - 1]} : ` +
        `${profondeurs[i]} contre ${profondeurs[i - 1]}`,
    );
});

test('perspectiveProjection : doubler le zoom réduit de moitié la taille apparente (termes [0] et [5] doublent)', () => {
  const base = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 1);
  const zoome = perspectiveProjection(new Float64Array(16), 50, 16 / 9, 0.1, 2);
  assert.ok(proche(zoome[0], base[0] * 2));
  assert.ok(proche(zoome[5], base[5] * 2));
});

test('perspectiveProjection : dernière colonne perspective standard (0,0,-1,0)', () => {
  const p = perspectiveProjection(new Float64Array(16), 45, 1, 1, 1);
  assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 0, -1, 0]);
});

test('updateCameraFrame : vue = inverse de la matrice monde, vue-projection = projection · vue', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  const world = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1]); // translation pure
  updateCameraFrame(frame, projection, world);
  const vueAttendue = invertMatrix4(new Float64Array(16), world);
  assert.deepEqual([...frame.view], [...vueAttendue]);
  const vpAttendue = multiplyMatrix4(new Float64Array(16), projection, vueAttendue);
  assert.deepEqual([...frame.viewProjection], [...vpAttendue]);
});

test('updateCameraFrame : une matrice monde singulière rend une vue nulle, comme l’inverse de la référence', () => {
  const frame = createCameraFrame();
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  const singuliere = new Float64Array(16);
  updateCameraFrame(frame, projection, singuliere);
  assert.deepEqual([...frame.view], new Array(16).fill(0));
});

test('allocation : les tampons d’une CameraFrame sont les mêmes objets d’une image à l’autre', () => {
  const frame = createCameraFrame();
  const vue = frame.view,
    vp = frame.viewProjection,
    plans = frame.planes;
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  updateCameraFrame(frame, projection, IDENTITY);
  updateCameraFrame(
    frame,
    projection,
    Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]),
  );
  assert.equal(frame.view, vue);
  assert.equal(frame.viewProjection, vp);
  assert.equal(frame.planes, plans);
  assert.equal(updateCameraFrame(frame, projection, IDENTITY), frame, 'rend le même objet');
});
