import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultLightingSceneLights, createLightingScene, exportLightingGltf, LIGHTING_CAMERA_POSES, type Scene, type Vec3} from './lightingExperimentScene.ts';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {const size = Math.hypot(...v); return [v[0] / size, v[1] / size, v[2] / size];};
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Independent rectangle visibility oracle: testing the fixture before transport approximation.
function firstHit(scene: Scene, origin: Vec3, direction: Vec3): string | undefined {
 let distance = Infinity, id: string | undefined;
 for (const surface of scene.surfaces) {
  const normal = unit(cross(surface.u, surface.v)), denominator = dot(direction, normal);
  if (Math.abs(denominator) < 1e-10) continue;
  const t = dot(sub(surface.origin, origin), normal) / denominator;
  if (t <= 1e-7 || t >= distance) continue;
  const point: Vec3 = [origin[0] + t * direction[0], origin[1] + t * direction[1], origin[2] + t * direction[2]];
  const local = sub(point, surface.origin);
  const u = dot(local, surface.u) / dot(surface.u, surface.u), v = dot(local, surface.v) / dot(surface.v, surface.v);
  if (u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) {distance = t; id = surface.id;}
 }
 return id;
}

test('lighting scene retains patch identities under door movement and relighting, within the declared scene budget', () => {
 const closed = createLightingScene({doorAngle: 0, lightIntensity: 1, patchSize: 1});
 const open = createLightingScene({doorAngle: Math.PI / 2, lightIntensity: 0, patchSize: 1});
 assert.ok(closed.patches.length <= 350);
 assert.equal(closed.patches.length, open.patches.length);
 assert.equal(new Set(closed.surfaces.map(surface => surface.id)).size, closed.surfaces.length);
 for (let i = 0; i < closed.patches.length; i++) {
  const a = closed.patches[i], b = open.patches[i], surface = closed.surfaces[a.surface];
  assert.equal(a.id, b.id);
  assert.equal(a.surface, b.surface);
  close(a.area, b.area);
  close(Math.hypot(...a.normal), 1);
  assert.deepEqual(b.emission, [0, 0, 0]);
  if (!surface.moving) assert.deepEqual(a.center, b.center);
  if (surface.kind === 'mirror') assert.deepEqual(a.albedo, [0, 0, 0]);
 }
 for (let i = 0; i < closed.surfaces.length; i++) {
  const surface = closed.surfaces[i];
  assert.match(surface.id, /^[a-z0-9_]+$/);
  close(closed.patches.filter(patch => patch.surface === i).reduce((sum, patch) => sum + patch.area, 0), Math.hypot(...cross(surface.u, surface.v)));
 }
 const emitter = closed.surfaces.find(surface => surface.id === 'ceiling_emitter')!;
 emitter.emission.forEach((value, channel) => close(value, [12, 8.4, 5.4][channel]));
 assert.ok(cross(emitter.u, emitter.v)[1] < 0);
});

test('the thick partition blocks rays outside its opening and the closed leaf seals that opening', () => {
 const closed = createLightingScene({doorAngle: 0, lightIntensity: 1});
 const open = createLightingScene({doorAngle: Math.PI / 2, lightIntensity: 1});
 assert.equal(firstHit(closed, [2, 1, 0], [-1, 0, 0]), 'door_px');
 assert.equal(firstHit(open, [2, 1, 0], [-1, 0, 0]), 'west_wall_px');
 assert.equal(firstHit(open, [2, 2.4, 0], [-1, 0, 0]), 'partition_header_px');
 assert.equal(firstHit(open, [2, 1, 1.2], [-1, 0, 0]), 'partition_front_px');
 assert.equal(firstHit(open, [2, 1, -1.2], [-1, 0, 0]), 'partition_back_px');
});

test('both mirrors reflect the right-room camera into the red room when the door opens', () => {
 const open = createLightingScene({doorAngle: Math.PI / 2, lightIntensity: 1});
 const closed = createLightingScene({doorAngle: 0, lightIntensity: 1});
 for (const surface of open.surfaces.filter(surface => surface.kind === 'mirror')) {
  const center = surface.origin.map((value, i) => value + 0.5 * (surface.u[i] + surface.v[i])) as Vec3;
  const incoming = unit(sub(center, LIGHTING_CAMERA_POSES.right_room.position));
  assert.equal(firstHit(open, LIGHTING_CAMERA_POSES.right_room.position, incoming), surface.id);
  const normal = unit(cross(surface.u, surface.v));
  const reflected = incoming.map((value, i) => value - 2 * dot(incoming, normal) * normal[i]) as Vec3;
  assert.equal(firstHit(open, center, reflected), 'west_wall_px', surface.id);
  assert.match(firstHit(closed, center, reflected) ?? '', /^door_/, surface.id);
 }
});

test('glTF preserves each surface, HDR emission, sphere winding and adapter binding in its binary geometry', () => {
 const scene = createLightingScene({doorAngle: 0.7, lightIntensity: 2, roughness: 0.37});
 const {gltf, binary} = exportLightingGltf(scene);
 type Accessor = {bufferView: number; componentType: number; count: number; type: string; min: number[]; max: number[]};
 const accessors = gltf.accessors as Accessor[];
 const views = gltf.bufferViews as {byteOffset: number; byteLength: number}[];
 const meshes = gltf.meshes as {name: string; primitives: {attributes: {POSITION: number; NORMAL: number; TEXCOORD_0: number}; indices: number; material: number}[]}[];
 const nodes = gltf.nodes as {name: string; mesh: number; extras: {surfaceId?: string; surfaceIndex?: number}}[];
 const materials = gltf.materials as {emissiveFactor?: number[]; extensions?: {KHR_materials_emissive_strength: {emissiveStrength: number}}; pbrMetallicRoughness: {roughnessFactor: number; metallicFactor: number}}[];
 const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
 const read = (index: number): number[] => {
  const a = accessors[index], view = views[a.bufferView], components = a.type === 'VEC3' ? 3 : a.type === 'VEC2' ? 2 : 1;
  return Array.from({length: a.count * components}, (_, i) => a.componentType === 5123 ? data.getUint16(view.byteOffset + i * 2, true) : data.getFloat32(view.byteOffset + i * 4, true));
 };
 assert.deepEqual(gltf.buffers, [{uri: 'scene.bin', byteLength: binary.byteLength}]);
 assert.equal(meshes.length, scene.surfaces.length + 1);
 for (const view of views) {
  assert.equal(view.byteOffset % 4, 0);
  assert.ok(view.byteOffset + view.byteLength <= binary.byteLength);
 }
 scene.surfaces.forEach((surface, i) => {
  assert.equal(meshes[i].name, surface.id);
  assert.equal(nodes[i].name, surface.id);
  assert.equal(nodes[i].extras.surfaceId, surface.id);
  assert.equal(nodes[i].extras.surfaceIndex, i);
  const primitive = meshes[i].primitives[0];
  assert.deepEqual(read(primitive.indices), [0, 1, 2, 0, 2, 3]);
  const positions = read(primitive.attributes.POSITION);
  const expected = [...surface.origin, ...surface.origin.map((value, j) => value + surface.u[j]),
   ...surface.origin.map((value, j) => value + surface.u[j] + surface.v[j]), ...surface.origin.map((value, j) => value + surface.v[j])];
  assert.deepEqual(positions, expected.map(Math.fround));
 });
 const emitter = materials[scene.surfaces.findIndex(surface => surface.id === 'ceiling_emitter')];
 emitter.emissiveFactor!.forEach((value, channel) => close(value * emitter.extensions!.KHR_materials_emissive_strength.emissiveStrength, [24, 16.8, 10.8][channel]));
 const sphere = meshes.at(-1)!;
 assert.equal(sphere.name, 'glossy_sphere');
 const primitive = sphere.primitives[0], positions = read(primitive.attributes.POSITION), indices = read(primitive.indices);
 assert.equal(materials[primitive.material].pbrMetallicRoughness.metallicFactor, 1);
 assert.equal(materials[primitive.material].pbrMetallicRoughness.roughnessFactor, 0.37);
 const vertex = (i: number): Vec3 => positions.slice(i * 3, i * 3 + 3) as Vec3;
 for (let i = 0; i < indices.length; i += 3) {
  const a = vertex(indices[i]), b = vertex(indices[i + 1]), c = vertex(indices[i + 2]);
  assert.ok(dot(cross(sub(b, a), sub(c, a)), sub(a, scene.sphere!.center)) > 0);
 }
});

test('lighting scene rejects nonfinite parameters and an excessive patch allocation', () => {
 for (const options of [
  {doorAngle: NaN, lightIntensity: 1}, {doorAngle: 0, lightIntensity: -1},
  {doorAngle: 0, lightIntensity: 1, patchSize: 0}, {doorAngle: 0, lightIntensity: 1, patchSize: 1e-9},
  {doorAngle: 0, lightIntensity: 1, roughness: 1.1},
 ]) assert.throws(() => createLightingScene(options), RangeError);
});

test('independent colored panels move and switch without changing geometry identity or other emitters', () => {
 const lights = createDefaultLightingSceneLights();
 const initial = createLightingScene({doorAngle: 0, lightIntensity: 1, lights});
 const changed = createDefaultLightingSceneLights();
 changed[0].intensity = 0;
 changed[1].position = [1.5, 2.7, -1];
 changed[1].color = [0.2, 1, 0.1];
 changed.reverse();
 const next = createLightingScene({doorAngle: 0, lightIntensity: 1, lights: changed});
 assert.deepEqual(next.surfaces.map(surface => surface.id), initial.surfaces.map(surface => surface.id));
 assert.deepEqual(next.patches.map(patch => [patch.id, patch.surface]), initial.patches.map(patch => [patch.id, patch.surface]));
 const sources = initial.surfaces.filter(surface => surface.id.startsWith('ceiling_emitter'));
 assert.equal(sources.length, 3);
 assert.ok(sources.every(surface => surface.moving));
 const get = (scene: Scene, id: string) => scene.surfaces.find(surface => surface.id === id)!;
 assert.deepEqual(get(next, 'ceiling_emitter').emission, [0, 0, 0]);
 assert.deepEqual(get(next, 'ceiling_emitter').origin, get(initial, 'ceiling_emitter').origin);
 assert.notDeepEqual(get(next, 'ceiling_emitter_cyan').origin, get(initial, 'ceiling_emitter_cyan').origin);
 get(next, 'ceiling_emitter_cyan').emission.forEach((value, channel) => close(value, [0.2, 1, 0.1][channel] * 3.6));
 assert.deepEqual(get(next, 'ceiling_emitter_magenta'), get(initial, 'ceiling_emitter_magenta'));
 const combined = createLightingScene({doorAngle: 0, lightIntensity: 0.5, lights});
 for (const source of sources) get(combined, source.id).emission.forEach((value, channel) => close(value, source.emission[channel] * 0.5));
 assert.deepEqual(lights, createDefaultLightingSceneLights(), 'caller controls and defaults are not mutated');
 const originalSingle = createLightingScene({doorAngle: 0, lightIntensity: 1,
  lights: [{id: 'warm', color: [1, 11 / 12, 0.75], intensity: 1, position: [-2.5, 2.96, 0]}]});
 assert.equal(originalSingle.surfaces.length, 93);
 assert.equal(originalSingle.patches.length, 280);
 assert.deepEqual(get(originalSingle, 'ceiling_emitter').emission, [12, 11, 9]);
 assert.throws(() => createLightingScene({doorAngle: 0, lightIntensity: 1, lights: [lights[0], lights[0]]}), /Invalid lighting scene area panel/);
});
