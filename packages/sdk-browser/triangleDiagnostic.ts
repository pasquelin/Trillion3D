import * as THREE from 'three';
import { hashId } from './backendCommon.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';

const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function triangleHash(id: number) {
  let value = (id + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
function hashColor(id: number) {
  const h = triangleHash(id);
  const hue = (h & 65535) / 65535,
    saturation = 0.65 + (0.25 * ((h >>> 16) & 255)) / 255,
    value = 0.78 + (0.2 * (h >>> 24)) / 255;
  const channel = (offset: number) => {
    const k = ((hue + offset) % 1) * 6;
    const component = Math.max(0, Math.min(1, Math.abs(k - 3) - 1));
    return value * (1 - saturation + saturation * component);
  };
  return [channel(0), channel(2 / 3), channel(1 / 3)] as const;
}

export function triangleGeometry(geometry: THREE.BufferGeometry, salt = 0) {
  const key = geometry;
  let copy = cache.get(key);
  if (!copy) {
    copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    colorTriangles(copy, salt);
    cache.set(key, copy);
  }
  return copy;
}

function colorTriangles(geometry: THREE.BufferGeometry, salt: number) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 3) {
    const [r, g, b] = hashColor((salt ^ triangleHash(i / 3)) >>> 0);
    for (let corner = 0; corner < 3; corner++) {
      const offset = (i + corner) * 3;
      colors[offset] = r;
      colors[offset + 1] = g;
      colors[offset + 2] = b;
    }
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

export function createTriangleDiagnosticMaterial(side: THREE.Side, _salt = 0) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, side, toneMapped: false, fog: false });
}

export function materialSide(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material[0].side : material.side;
}

/**
 * Give a copy back its original geometry and material, kept in `userData`, then, in wireframe
 * mode, set its per-triangle colouring. The created material goes into `overlays`, to discard
 * with the mode.
 */
export function applyMeshDiagnostic(
  mesh: THREE.Mesh,
  mode: DiagnosticMode,
  overlays: THREE.Material[],
) {
  const sourceGeometry = mesh.userData.sourceGeometry as THREE.BufferGeometry;
  const sourceMaterial = mesh.userData.sourceMaterial as THREE.Material | THREE.Material[];
  mesh.geometry = sourceGeometry;
  mesh.material = sourceMaterial;
  if (mode !== 'wireframe') return;
  mesh.geometry = triangleGeometry(sourceGeometry, hashId(String(mesh.id)));
  const material = createTriangleDiagnosticMaterial(materialSide(sourceMaterial));
  overlays.push(material);
  mesh.material = material;
}

export function disposeTriangleGeometry(geometry: THREE.BufferGeometry) {
  const copy = cache.get(geometry);
  if (copy && copy !== geometry) {
    copy.dispose();
    cache.delete(geometry);
  }
}
