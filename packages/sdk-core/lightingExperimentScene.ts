/** Geometry shared by the experimental transport solver and its browser fixture. */
export type Vec3 = [number, number, number];

/** Linear RGB and a world-space panel centre. Zero intensity keeps the panel present. */
export interface LightingSceneLight {
 id: string;
 color: Vec3;
 intensity: number;
 position: Vec3;
}

/** Independent copies for callers that animate individual controls. */
export function createDefaultLightingSceneLights(): LightingSceneLight[] {
 return [
  {id: 'warm', color: [1, 0.7, 0.45], intensity: 1, position: [-2.25, 2.96, 0]},
  {id: 'cyan', color: [0.03, 0.5, 1], intensity: 0.3, position: [2.5, 2.7, 1.2]},
  {id: 'magenta', color: [1, 0.05, 0.35], intensity: 0.2, position: [-2.8, 2.7, -1.8]},
 ];
}

/** origin is a corner; u and v span the complete rectangle. */
export interface Surface {
 id: string;
 origin: Vec3;
 u: Vec3;
 v: Vec3;
 albedo: Vec3;
 emission: Vec3;
 kind: 'diffuse' | 'mirror';
 moving: boolean;
 columns: number;
 rows: number;
}

/** u and v span the complete cell; cross(u, v) points along normal. */
export interface Patch {
 id: number;
 surface: number;
 center: Vec3;
 normal: Vec3;
 u: Vec3;
 v: Vec3;
 area: number;
 albedo: Vec3;
 emission: Vec3;
}

export interface Scene {
 surfaces: Surface[];
 patches: Patch[];
 sphere?: {center: Vec3; radius: number; roughness: number};
}

export const LIGHTING_CAMERA_POSES: Record<string, {position: Vec3; target: Vec3}> = {
 right_room: {position: [2.8, 1.5, 2.5], target: [-1, 1.2, -1]},
 doorway: {position: [2.7, 1.6, 1.1], target: [-2, 1.3, 0]},
 left_room: {position: [-2.8, 1.5, 2.5], target: [-1, 1.2, -1]},
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, factor: number): Vec3 => [v[0] * factor, v[1] * factor, v[2] * factor];
const subtract = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (v: Vec3): number => Math.hypot(...v);
const normalized = (v: Vec3): Vec3 => scale(v, 1 / length(v));
const BLACK: Vec3 = [0, 0, 0];
const WALL: Vec3 = [0.65, 0.65, 0.65];
type Face = 'nx' | 'px' | 'ny' | 'py' | 'nz' | 'pz';

/** Door angle zero closes the opening; PI/2 swings the leaf into the left room. */
export function createLightingScene(options: {
 doorAngle: number;
 lightIntensity: number;
 patchSize?: number;
 roughness?: number;
 /** Omit for all three panels; an explicit subset selects a fixed smaller fixture. */
 lights?: readonly LightingSceneLight[];
}): Scene {
 const {doorAngle, lightIntensity, patchSize = 1.2, roughness = 0.12} = options;
 if (!Number.isFinite(doorAngle) || !Number.isFinite(lightIntensity) || lightIntensity < 0
  || !Number.isFinite(patchSize) || patchSize <= 0 || !Number.isFinite(roughness) || roughness < 0 || roughness > 1
  || !Number.isFinite(lightIntensity * 12)) throw new RangeError('Invalid lighting experiment parameters');
 const lights = options.lights ?? createDefaultLightingSceneLights();
 if (lights.length > 16) throw new RangeError('Lighting scene supports at most 16 area panels');
 const lightIds = new Set<string>();
 for (const light of lights) {
  if (typeof light.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(light.id) || lightIds.has(light.id)
   || light.color.length !== 3 || light.color.some(value => !Number.isFinite(value) || value < 0 || value > 1)
   || light.position.length !== 3 || !light.position.every(Number.isFinite)
   || !Number.isFinite(light.intensity) || light.intensity < 0
   || !Number.isFinite(12 * light.intensity * lightIntensity)) throw new RangeError('Invalid lighting scene area panel');
  lightIds.add(light.id);
 }

 const surfaces: Surface[] = [];
 let patchCount = 0;
 const rectangle = (id: string, origin: Vec3, u: Vec3, v: Vec3, albedo: Vec3, detailed = true,
  moving = false, kind: Surface['kind'] = 'diffuse', emission: Vec3 = BLACK): void => {
  const columns = detailed ? Math.max(1, Math.ceil(length(u) / patchSize - 1e-10)) : 1;
  const rows = detailed ? Math.max(1, Math.ceil(length(v) / patchSize - 1e-10)) : 1;
  patchCount += columns * rows;
  if (patchCount > 16_384) throw new RangeError('Lighting scene exceeds 16384 transport patches');
  surfaces.push({id, origin, u, v, albedo: [...albedo], emission: [...emission], kind, moving, columns, rows});
 };
 const box = (id: string, min: Vec3, max: Vec3, albedo: Vec3, detailed: Face[], moving = false,
  point: (v: Vec3) => Vec3 = v => v, vector: (v: Vec3) => Vec3 = v => v): void => {
  const [x, y, z] = min;
  const [X, Y, Z] = max;
  const dx = X - x, dy = Y - y, dz = Z - z;
  const faces: [Face, Vec3, Vec3, Vec3][] = [
   ['nx', [x, y, z], [0, 0, dz], [0, dy, 0]],
   ['px', [X, y, Z], [0, 0, -dz], [0, dy, 0]],
   ['ny', [x, y, z], [dx, 0, 0], [0, 0, dz]],
   ['py', [x, Y, Z], [dx, 0, 0], [0, 0, -dz]],
   ['nz', [X, y, z], [-dx, 0, 0], [0, dy, 0]],
   ['pz', [x, y, Z], [dx, 0, 0], [0, dy, 0]],
  ];
  for (const [face, origin, u, v] of faces) rectangle(`${id}_${face}`, point(origin), vector(u), vector(v),
   albedo, detailed.includes(face), moving);
 };

 // Split the slabs at the partition: no transport-cell centre sits inside a solid wall.
 for (const [side, x0, x1] of [['left', -4, -0.08], ['right', 0.08, 4]] as const) {
  box(`floor_${side}`, [x0, -0.16, -3], [x1, 0, 3], [0.55, 0.55, 0.55], ['py']);
  box(`ceiling_${side}`, [x0, 3, -3], [x1, 3.16, 3], WALL, ['ny']);
  box(`back_wall_${side}`, [x0, 0, -3.16], [x1, 3, -3], WALL, ['pz']);
  box(`front_wall_${side}`, [x0, 0, 3], [x1, 3, 3.16], WALL, ['nz']);
 }
 box('floor_threshold', [-0.08, -0.16, -0.8], [0.08, 0, 0.8], [0.55, 0.55, 0.55], ['py']);
 box('west_wall', [-4.16, 0, -3], [-4, 3, 3], [0.7, 0.07, 0.04], ['px']);
 box('east_wall', [4, 0, -3], [4.16, 3, 3], WALL, ['nx']);
 box('partition_back', [-0.08, 0, -3], [0.08, 3, -0.8], WALL, ['nx', 'px', 'pz']);
 box('partition_front', [-0.08, 0, 0.8], [0.08, 3, 3], WALL, ['nx', 'px', 'nz']);
 box('partition_header', [-0.08, 2.2, -0.8], [0.08, 3, 0.8], WALL, ['nx', 'px', 'ny']);

 const cosine = Math.cos(doorAngle), sine = Math.sin(doorAngle);
 const rotate = ([x, y, z]: Vec3): Vec3 => [x * cosine - z * sine, y, x * sine + z * cosine];
 const transform = (v: Vec3): Vec3 => add(rotate(v), [0, 0, -0.8]);
 box('door', [-0.04, 0, 0], [0.04, 2.2, 1.6], [0.35, 0.22, 0.09], ['nx', 'px'], true, transform, rotate);

 // A stable id order preserves patch identity when a caller reorders its light controls.
 const orderedLights = [...lights].sort((a, b) => a.id === b.id ? 0 : a.id === 'warm' ? -1 : b.id === 'warm' ? 1 : a.id < b.id ? -1 : 1);
 for (const light of orderedLights) {
  const width = light.id === 'warm' ? 2.2 : 0.8, depth = light.id === 'warm' ? 1.6 : 0.8;
  const emission = light.color.map(value => value * (12 * light.intensity * lightIntensity)) as Vec3;
  rectangle(light.id === 'warm' ? 'ceiling_emitter' : `ceiling_emitter_${light.id}`,
   subtract(light.position, [width / 2, 0, depth / 2]), [width, 0, 0], [0, 0, depth], [0.65, 0.65, 0.65],
   true, true, 'diffuse', emission);
 }
 const mirror = (id: string, center: Vec3, target: Vec3, width: number, height: number): void => {
  const toEye = normalized(subtract(LIGHTING_CAMERA_POSES.right_room.position, center));
  const toTarget = normalized(subtract(target, center));
  const normal = normalized(add(toEye, toTarget));
  const u = scale(normalized(cross([0, 1, 0], normal)), width);
  const v = scale(normalized(cross(normal, u)), height);
  rectangle(id, subtract(subtract(center, scale(u, 0.5)), scale(v, 0.5)), u, v, [0.92, 0.92, 0.92], true, false, 'mirror');
 };
 mirror('mirror_near', [0.9, 1.15, -0.4], [-3.95, 1.15, 2.3], 0.9, 1.7);
 mirror('mirror_far', [1.8, 1.5, -2.05], [-3.95, 1.5, 2.75], 1.2, 1.8);

 const patches: Patch[] = [];
 surfaces.forEach((surface, surfaceIndex) => {
  const u = scale(surface.u, 1 / surface.columns), v = scale(surface.v, 1 / surface.rows);
  const normal = normalized(cross(surface.u, surface.v));
  const area = length(cross(u, v));
  for (let row = 0; row < surface.rows; row++) for (let column = 0; column < surface.columns; column++) {
   patches.push({id: patches.length, surface: surfaceIndex,
    center: add(surface.origin, add(scale(u, column + 0.5), scale(v, row + 0.5))), normal: [...normal],
    u: [...u], v: [...v], area, albedo: [...(surface.kind === 'mirror' ? BLACK : surface.albedo)], emission: [...surface.emission]});
  }
 });
 return {surfaces, patches, sphere: {center: [2, 0.5, 0], radius: 0.45, roughness}};
}

/** glTF and a separate, little-endian binary buffer; adapters own persistence. */
export function exportLightingGltf(scene: Scene): {gltf: Record<string, unknown>; binary: Uint8Array} {
 const chunks: Uint8Array[] = [];
 const bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
 const materials: Record<string, unknown>[] = [], meshes: Record<string, unknown>[] = [], nodes: Record<string, unknown>[] = [];
 const extensionsUsed = new Set<string>();
 let byteLength = 0;
 const accessor = (values: number[], components: number, index = false): number => {
  const bytesPerValue = index ? 2 : 4;
  const chunk = new Uint8Array(Math.ceil(values.length * bytesPerValue / 4) * 4);
  const view = new DataView(chunk.buffer);
  for (let i = 0; i < values.length; i++) {
   if (index) view.setUint16(i * 2, values[i], true);
   else view.setFloat32(i * 4, values[i], true);
  }
  const bufferView = bufferViews.length;
  bufferViews.push({buffer: 0, byteOffset: byteLength, byteLength: values.length * bytesPerValue, target: index ? 34963 : 34962});
  chunks.push(chunk);
  byteLength += chunk.byteLength;
  const min = Array.from({length: components}, () => Infinity), max = min.map(() => -Infinity);
  values.forEach((_, i) => {const component = i % components, value = index ? view.getUint16(i * 2, true) : view.getFloat32(i * 4, true);
   min[component] = Math.min(min[component], value); max[component] = Math.max(max[component], value);});
  accessors.push({bufferView, byteOffset: 0, componentType: index ? 5123 : 5126, count: values.length / components,
   type: components === 1 ? 'SCALAR' : components === 2 ? 'VEC2' : 'VEC3', min, max});
  return accessors.length - 1;
 };
 const mesh = (name: string, positions: number[], normals: number[], uv: number[], indices: number[], material: number, extras: Record<string, unknown>): void => {
  const attributes = {POSITION: accessor(positions, 3), NORMAL: accessor(normals, 3), TEXCOORD_0: accessor(uv, 2)};
  meshes.push({name, extras, primitives: [{attributes, indices: accessor(indices, 1, true), material, mode: 4}]});
  nodes.push({name, mesh: meshes.length - 1, extras});
 };
 scene.surfaces.forEach((surface, surfaceIndex) => {
  const emissionStrength = Math.max(1, ...surface.emission);
  const material: Record<string, unknown> = {
   name: `${surface.id}_material`, pbrMetallicRoughness: {baseColorFactor: [...surface.albedo, 1],
    metallicFactor: surface.kind === 'mirror' ? 1 : 0, roughnessFactor: surface.kind === 'mirror' ? 0 : 1},
   emissiveFactor: surface.emission.map(value => value / emissionStrength),
  };
  if (emissionStrength > 1) {
   material.extensions = {KHR_materials_emissive_strength: {emissiveStrength: emissionStrength}};
   extensionsUsed.add('KHR_materials_emissive_strength');
  }
  materials.push(material);
  const a = surface.origin, b = add(a, surface.u), d = add(a, surface.v), c = add(b, surface.v);
  const normal = normalized(cross(surface.u, surface.v));
  mesh(surface.id, [...a, ...b, ...c, ...d], [...normal, ...normal, ...normal, ...normal], [0, 0, 1, 0, 1, 1, 0, 1],
   [0, 1, 2, 0, 2, 3], materials.length - 1, {surfaceId: surface.id, surfaceIndex, moving: surface.moving,
    kind: surface.kind, columns: surface.columns, rows: surface.rows, emission: [...surface.emission]});
 });
 if (scene.sphere) {
  const {center, radius, roughness} = scene.sphere;
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  const longitudeSegments = 64, latitudeSegments = 32;
  for (let y = 0; y <= latitudeSegments; y++) for (let x = 0; x <= longitudeSegments; x++) {
   const theta = Math.PI * y / latitudeSegments, phi = 2 * Math.PI * x / longitudeSegments;
   const normal: Vec3 = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
   positions.push(...add(center, scale(normal, radius)));
   normals.push(...normal);
   uv.push(x / longitudeSegments, 1 - y / latitudeSegments);
  }
  for (let y = 0; y < latitudeSegments; y++) for (let x = 0; x < longitudeSegments; x++) {
   const a = y * (longitudeSegments + 1) + x, b = a + longitudeSegments + 1, c = b + 1, d = a + 1;
   if (y < latitudeSegments - 1) indices.push(a, c, b);
   if (y > 0) indices.push(a, d, c);
  }
  materials.push({name: 'glossy_sphere_material', pbrMetallicRoughness: {baseColorFactor: [0.92, 0.92, 0.92, 1], metallicFactor: 1, roughnessFactor: roughness}});
  mesh('glossy_sphere', positions, normals, uv, indices, materials.length - 1, {roughness, radius, center: [...center]});
 }
 const binary = new Uint8Array(byteLength);
 let offset = 0;
 for (const chunk of chunks) {binary.set(chunk, offset); offset += chunk.byteLength;}
 const gltf: Record<string, unknown> = {asset: {version: '2.0', generator: 'Web Geometry lighting experiment'}, scene: 0,
  scenes: [{nodes: nodes.map((_, i) => i)}], nodes, meshes, materials, accessors, bufferViews,
  buffers: [{uri: 'scene.bin', byteLength}]};
 if (extensionsUsed.size) gltf.extensionsUsed = [...extensionsUsed];
 return {gltf, binary};
}
