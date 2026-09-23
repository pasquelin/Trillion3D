import { hashId } from './diagnosticColors.ts';
import { materialSide } from './materialSide.ts';
import type {
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
  HostDiagnosticMesh,
} from './hostResources.ts';
import type { DiagnosticMode } from '../sdk-core/src/index.ts';

/**
 * The per-triangle view, computed here and nowhere else: one colour per submitted triangle, from
 * the triangle's rank and the salt of the page or mesh it belongs to. The copy that carries those
 * colours is a host geometry and its paint a host material; both are made by the `host` factory
 * the engine owning the graph hands in, and this file decides every number they receive.
 */

const cache = new WeakMap<HostDiagnosticGeometry, HostDiagnosticGeometry>();

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

/** Three equal corner colours per triangle, over `count` vertices standing on their own. */
function triangleColors(count: number, salt: number) {
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
  return colors;
}

export function triangleGeometry(
  geometry: HostDiagnosticGeometry,
  host: HostDiagnosticFactory,
  salt = 0,
) {
  let copy = cache.get(geometry);
  if (!copy) {
    copy = host.triangleGeometry(geometry);
    host.vertexColors(copy, triangleColors(copy.attributes.position.count, salt));
    cache.set(geometry, copy);
  }
  return copy;
}

/**
 * Give a copy back its original geometry and material, kept in `userData`, then, in wireframe
 * mode, set its per-triangle colouring. The created material goes into `overlays`, to discard
 * with the mode.
 */
export function applyMeshDiagnostic(
  mesh: HostDiagnosticMesh,
  mode: DiagnosticMode,
  overlays: HostDiagnosticMaterial[],
  host: HostDiagnosticFactory,
) {
  const sourceGeometry = mesh.userData.sourceGeometry as HostDiagnosticGeometry;
  const sourceMaterial = mesh.userData.sourceMaterial as HostDiagnosticMesh['material'];
  mesh.geometry = sourceGeometry;
  mesh.material = sourceMaterial;
  if (mode !== 'wireframe') return;
  mesh.geometry = triangleGeometry(sourceGeometry, host, hashId(String(mesh.id)));
  const material = host.triangleMaterial(materialSide(sourceMaterial));
  overlays.push(material);
  mesh.material = material;
}

export function disposeTriangleGeometry(geometry: HostDiagnosticGeometry) {
  const copy = cache.get(geometry);
  if (copy && copy !== geometry) {
    copy.dispose();
    cache.delete(geometry);
  }
}
