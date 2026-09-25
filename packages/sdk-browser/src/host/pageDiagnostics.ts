import type {
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
} from './resources.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from './graph/surface.ts';
import { clusterColor } from '../diagnostic/colors.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';

/** A diagnostic surface, flat and never seen through the scene's fog: it shows a number, not a
 *  material. */
const unshaded = (parameters: Record<string, unknown>, side: number) =>
  new GraphSurface('basic', {
    ...parameters,
    side,
    fog: false,
  }) as unknown as HostDiagnosticMaterial;

/**
 * THE OBJECTS A DIAGNOSTIC VIEW SWAPS IN on the page path's display graph. The views are the
 * engine's — which triangle, which cluster, which tint —; what they hang on a page mesh is a
 * surface and a geometry of the engine's own graph, built here. Nothing is decided here: the salt,
 * the per-triangle colours and the side all arrive computed.
 */
export const pageDiagnostics: HostDiagnosticFactory = {
  triangleGeometry: (geometry) =>
    (geometry as unknown as Geometry).toNonIndexed() as unknown as HostDiagnosticGeometry,
  vertexColors(geometry, colors) {
    (geometry as unknown as Geometry).setAttribute('color', new BufferAttribute(colors, 3));
  },
  triangleMaterial: (side) => unshaded({ vertexColors: true, toneMapped: false }, side),
  clusterMaterial: (id, side) => unshaded({ color: clusterColor(id, 0.75) }, side),
};
