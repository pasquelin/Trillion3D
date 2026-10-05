// what lamp shadows cost on the CPU: world-space cluster spheres packed for the shadow pass.
import * as THREE from 'three';
import { packClusterSpheres } from '../../../packages/sdk-browser/src/webgpu/shadow/spheres.ts';
import { graine, mesure, rapport } from '../../core/index.ts';
import { SPHERE_FLOATS, referenceClusterSphere } from '../../oracles/browser/lamp-shadows.ts';
import { pageRecFixture } from './support/pageRecFixture.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/types.ts';

const alea = graine(83);

// One record in ten is empty: the pass must write a zero radius there, never read a missing card.
// The output buffer belongs to the case, allocated once, as the engine holds its own.
function clusters(nombre: number) {
  const recs: (PageRec | undefined)[] = [],
    roots: { world: THREE.Matrix4 }[] = [];
  for (let i = 0; i < nombre; i++) {
    const elements = new Float64Array(16);
    for (let j = 0; j < 16; j++) elements[j] = (alea() - 0.5) * 10;
    const min = [(alea() - 0.5) * 5, (alea() - 0.5) * 5, (alea() - 0.5) * 5];
    const max = [min[0] + alea() * 5, min[1] + alea() * 5, min[2] + alea() * 5];
    // Each record ranks a root of its own, which carries its world.
    roots.push({ world: new THREE.Matrix4().fromArray(elements) });
    recs.push(i % 10 === 9 ? undefined : pageRecFixture({ min, max }));
  }
  return { recs, roots, packed: new Float32Array(nombre * SPHERE_FLOATS) };
}

const mesSpheres = await mesure({
  name: 'world-space cluster spheres',
  fichier: 'packages/sdk-browser/src/webgpu/shadow/spheres.ts',
  cas: [
    { name: '20 000 clusters', input: clusters(20000), size: 20000 },
    { name: '1 cluster', input: clusters(1), size: 1 },
    { name: 'none', input: clusters(0), size: 0 },
  ],
  calcul: ({ recs, roots, packed }) =>
    // Each row ranks a root of its own: its packed rank is the row index (#1235).
    packClusterSpheres(recs, roots, packed, 0, recs.length - 1, (row) => row),
  attendu: ({ recs, roots }) => {
    const output = new Float32Array(recs.length * SPHERE_FLOATS);
    recs.forEach(
      (rec, i) =>
        rec &&
        referenceClusterSphere({ ...rec, matrix: roots[i].world }, output, i * SPHERE_FLOATS),
    );
    return output;
  },
});

rapport('lampes-ombres', [mesSpheres], 'the spheres yield the same values');
