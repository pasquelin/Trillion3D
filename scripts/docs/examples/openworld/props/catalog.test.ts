import test from 'node:test';
import assert from 'node:assert/strict';
import type { PropMesh } from '../plan/contract.ts';
import {
  isDoubleSided,
  partMeshes,
  sharedProps,
  SURFACES,
  triangleCount,
  VEHICLE_SPECS,
  vehicleProp,
  vehicleProps,
} from './index.ts';
import { propProblems } from './validate.ts';

/**
 * Measured triangles of each shared prop and each vehicle. The kit's budget for all of them
 * together is 2 000 000 unique triangles: dense meshes, each shared by many nodes.
 */
const TRIANGLES: Record<string, number> = {
  'tree-pine-small': 12_650,
  'tree-pine-large': 32_674,
  'tree-oak-small': 10_012,
  'tree-oak-large': 24_190,
  'tree-birch-small': 11_624,
  'tree-birch-large': 30_672,
  'tree-palm-small': 8_568,
  'tree-palm-large': 20_200,
  'bush-round': 4_722,
  'bush-wild': 4_730,
  'rock-boulder': 12_288,
  'rock-slab': 6_912,
  'rock-spire': 6_912,
  'street-lamp': 2_456,
  'traffic-light': 2_684,
  'road-sign': 1_644,
  bench: 2_436,
  'fence-segment': 1_800,
  'power-pylon': 11_016,
  'wind-turbine-tower': 3_272,
  'wind-turbine-rotor': 5_610,
  'container-red': 4_460,
  'container-blue': 4_460,
  'gantry-crane': 17_012,
  sailboat: 11_852,
  motorboat: 10_208,
  'cargo-ship': 28_824,
  'tree-stand-alpine-0': 34_908,
  'tree-stand-alpine-1': 36_028,
  'tree-stand-alpine-2': 36_028,
  'tree-stand-alpine-3': 36_028,
  'tree-stand-alpine-4': 35_132,
  'tree-stand-broadleaf-0': 17_584,
  'tree-stand-broadleaf-1': 16_920,
  'tree-stand-broadleaf-2': 17_568,
  'tree-stand-broadleaf-3': 17_136,
  'tree-stand-broadleaf-4': 16_688,
  'tree-stand-birch-0': 36_000,
  'tree-stand-birch-1': 36_000,
  'tree-stand-birch-2': 36_000,
  'tree-stand-birch-3': 36_000,
  'tree-stand-palm-0': 22_592,
};
const VEHICLE_TRIANGLES: Record<string, number> = {
  'vehicle-sports-car': 26_892,
  'vehicle-hatchback': 26_892,
  'vehicle-sedan': 26_892,
  'vehicle-van': 26_892,
  'vehicle-box-truck': 36_600,
  'vehicle-city-bus': 26_892,
  'vehicle-airliner': 54_974,
  'vehicle-light-plane': 19_844,
  'vehicle-helicopter': 22_268,
};

const bytes = (props: readonly PropMesh[]) =>
  Buffer.concat(
    props.flatMap((p) =>
      p.parts.flatMap((part) =>
        [part.positions, part.normals!, part.indices].map((a) => Buffer.from(a.buffer)),
      ),
    ),
  );

test('shared props are sound, within budget, and measured prop by prop', () => {
  const props = sharedProps(332),
    counts = Object.fromEntries(props.map((p) => [p.id, triangleCount(p)]));
  assert.deepEqual(counts, TRIANGLES);
  const vehicles = Object.fromEntries(vehicleProps().map((p) => [p.id, triangleCount(p)])),
    total = [...Object.values(counts), ...Object.values(vehicles)].reduce((a, b) => a + b, 0);
  assert.deepEqual(vehicles, VEHICLE_TRIANGLES);
  assert.ok(total <= 2_000_000, `${total} triangles`);
  assert.deepEqual(props.flatMap(propProblems), []);
});

test('the same seed gives the same bytes; another seed moves the lumps', () => {
  assert.ok(bytes(sharedProps(332)).equals(bytes(sharedProps(332))));
  assert.ok(!bytes(sharedProps(332)).equals(bytes(sharedProps(333))));
});

test('vehicle specs are small JSON and carry what the page and physics need', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(VEHICLE_SPECS)), VEHICLE_SPECS);
  for (const spec of VEHICLE_SPECS) {
    // Parameters, not triangles: a spec stays a few kilobytes however dense its mesh.
    assert.ok(JSON.stringify(spec).length < 16_000, `${spec.id} spec is small`);
    const tyres = spec.parts.filter((part) => part.role === 'wheel' && part.shape === 'torus');
    assert.deepEqual(
      [...new Set(tyres.map((part) => part.anchor))].sort(),
      spec.anchors.wheels.map((_, i) => i),
      spec.id,
    );
    if (spec.kind !== 'airliner')
      tyres.forEach((part) =>
        assert.deepEqual(part.position, spec.anchors.wheels[part.anchor!].position),
      );
    const [min, max] = spec.bounds;
    assert.ok(min[1] >= -1e-6 && max[1] > min[1], `${spec.id} stands on the ground`);
    assert.ok(spec.anchors.lamps.length > 0, `${spec.id} has lamps`);
    if (spec.kind === 'plane' || spec.kind === 'helicopter') assert.ok(spec.anchors.spinner);
  }
  const plane = VEHICLE_SPECS.find((spec) => spec.id === 'light-plane')!;
  const span = plane.bounds[1][0] - plane.bounds[0][0];
  assert.ok(span > 8.5 && span < 9.5, 'light plane spans about 9 m');
  const airliner = VEHICLE_SPECS.find((spec) => spec.id === 'airliner')!;
  const length = airliner.bounds[1][2] - airliner.bounds[0][2];
  assert.ok(length > 36 && length < 42, 'airliner is about 40 m long');
});

test('vehicle props are sound, and a body can leave its moving parts out', () => {
  assert.deepEqual(vehicleProps().flatMap(propProblems), []);
  const plane = VEHICLE_SPECS.find((spec) => spec.id === 'light-plane')!,
    body = vehicleProp(plane, ['propeller', 'wheel']);
  assert.equal(body.id, 'vehicle-light-plane-without-propeller-wheel');
  assert.ok(triangleCount(body) < triangleCount(vehicleProp(plane)));
});

test('repeated parts expand to their copies; only cards are double-sided', () => {
  const car = VEHICLE_SPECS.find((spec) => spec.id === 'sedan')!,
    spokes = car.parts.find((part) => part.repeat)!;
  assert.equal(partMeshes(car, spokes).length, spokes.repeat!.count);
  assert.ok(isDoubleSided(SURFACES.leaves) && isDoubleSided(SURFACES.sail));
  assert.ok(!isDoubleSided(SURFACES.concrete) && !isDoubleSided(SURFACES.hullWhite));
});
