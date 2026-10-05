// The cut's error decision agrees between the CPU and the GPU on an off-axis sample. Twenty
// thousand clusters in a primitive rotated and stretched non-uniformly — view centre to the field's
// edges, depths down to the near plane, errors drawn so the projected error falls around the
// threshold — inside boxes that span the frustum, so only the error decision is compared: the cut
// rule on `clusterPixels` (f64 values), and the WGSL kernel (all f32). A disagreement is admitted
// only within the band f32 rounding of spheres and matrices can flip.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { maxStretch } from '../../../packages/sdk-core/src/index.ts';
import {
  clusterPixels,
  projectedClusterError,
} from '../../../packages/sdk-browser/src/page/selection/math.ts';
import { drawsCluster } from '../../../packages/sdk-browser/src/page/cut/rule.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts';
import { lois, xorshift32 } from '../kit/randomDraw.ts';
import { runSelectionKernel } from './selectionKernel.ts';

const CLUSTERS = 20000,
  THRESHOLD = 0.75;
const VIEWPORT: [number, number] = [1600, 900];
/** Half-side of the boxes: wide enough to hold the whole frustum. */
const WIDE = 1e5;

interface Cluster {
  url: string;
  lodError: number;
  parentError: number;
  sphere: number[];
  parentSphere: number[];
  min: number[];
  max: number[];
}

function sample() {
  const { hasard: chance, entre: between, log } = lois(xorshift32(0x2545f491));
  const camera = G.perspectiveCamera(75, VIEWPORT[0] / VIEWPORT[1], 0.05, 2000);
  camera.position.set(3, -2, 7);
  camera.lookAt(-4, 1, -20);
  camera.updateMatrixWorld(true);
  const world = new G.Matrix4().compose(
    new G.Vector3(1, 2, -3),
    new G.Quaternion().setFromEuler(new G.Euler(0.4, -0.9, 0.3)),
    new G.Vector3(0.6, 1.7, 1.1),
  );
  const modelView = new G.Matrix4().multiplyMatrices(camera.matrixWorldInverse, world);
  const view = modelView.elements,
    toObject = modelView.clone().invert();
  const stretch = maxStretch(world.elements) * maxStretch(camera.matrixWorldInverse.elements);
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), THRESHOLD, VIEWPORT);
  const focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]);
  const [p00, p11] = [camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]];
  const projected = (error: number, sphere: number[]) =>
    projectedClusterError(error, sphere, 0, view, stretch, focal, camera.near);
  const clusters: Cluster[] = Array.from({ length: CLUSTERS }, (_, i) => {
    const radius = log(1e-3, 2);
    const margin = radius * stretch * 2.2;
    const depth =
      chance() < 0.25 ? camera.near + margin + camera.near * log(1e-4, 1) : margin + log(0.2, 400);
    const v = new G.Vector3(
      (between(-1, 1) * depth) / p00,
      (between(-1, 1) * depth) / p11,
      -depth,
    ).applyMatrix4(toObject);
    const sphere = [v.x, v.y, v.z, radius];
    const shift = radius * between(0, 0.2);
    const parentSphere = [v.x + shift, v.y, v.z, radius * 1.2 + shift];
    const unit = projected(radius * 0.01, sphere);
    const lodError = Number.isFinite(unit)
      ? radius * 0.01 * ((THRESHOLD * log(0.3, 3)) / unit)
      : 0.01;
    const parentError = Math.min(lodError * log(1, 4), radius);
    const [min, max] = [
      [-WIDE, -WIDE, -WIDE],
      [WIDE, WIDE, WIDE],
    ];
    return {
      url: String(i),
      lodError: Math.min(lodError, parentError),
      parentError,
      sphere,
      parentSphere,
      min,
      max,
    };
  });
  return { camera, world, view, stretch, focal, uniforms, clusters, projected };
}

test('CPU and GPU take the same clusters, but within the f32 rounding band', async () => {
  const { camera, world, view, stretch, focal, uniforms, clusters, projected } = sample();
  // The kernel works in the render frame: the world is brought to the eye, as the engine does.
  const packed = packDagSelection([{ world, pages: clusters }]);
  packedWorldsToRenderOrigin(packed, [{ world, pages: [] }], uniforms.cameraWorld);
  const { adapter, readings } = await runSelectionKernel([{ name: 'sample', packed, uniforms }]);
  const onGpu = new Uint8Array(CLUSTERS);
  for (const page of readings[0].pages) onGpu[page] = 1;
  const pixels = new Float64Array(2);
  /** The relative distance to the threshold of the nearer of a cluster's two errors. */
  const margin = (c: Cluster) =>
    Math.min(
      ...[projected(c.lodError, c.sphere), projected(c.parentError, c.parentSphere)].map(
        (p) => Math.abs(p - THRESHOLD) / THRESHOLD,
      ),
    );
  const disagreements = clusters
    .map((c, i) => {
      const [own, parent] = clusterPixels(c, view, stretch, focal, camera.near, 1, pixels);
      return { i, cpu: drawsCluster(true, parent, own, true, THRESHOLD), gpu: !!onGpu[i] };
    })
    .filter(({ cpu, gpu }) => cpu !== gpu)
    .map(({ i }) => margin(clusters[i]));
  const worst = Math.max(0, ...disagreements);
  console.log(
    JSON.stringify({
      adapter,
      kept: readings[0].pages.length,
      disagreements: disagreements.length,
      worst,
    }),
  );
  assert.ok(readings[0].pages.length > 0, 'the GPU keeps nothing');
  assert.ok(worst < 1e-5, `a disagreement ${worst} off the threshold, outside f32 rounding`);
});
