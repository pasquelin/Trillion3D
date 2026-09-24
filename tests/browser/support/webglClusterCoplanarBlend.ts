import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import type { WebglClusterScene } from '../../../packages/sdk-browser/src/webgl/cluster/lights.ts';
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';

/** A geometry factory as the transparency proof's fixtures build it. */
type GeometryFactory = (reverseFirst?: boolean) => G.GraphGeometry;
/** A batch record factory as `clusterRecord` builds it. */
type MeshFactory = (
  geometry: G.GraphGeometry,
  material: G.GraphSurface | G.GraphSurface[],
  starts?: number[],
  counts?: number[],
) => ClusterDrawMesh;

/** A two-sided BLEND record, drawn back then front; `biased`, it carries a layer offset. */
function coplanarBlendMesh(geometry: GeometryFactory, mesh: MeshFactory, biased: boolean) {
  const source = G.basicSurface({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthFunc: G.DEPTH_LESS,
    side: G.DOUBLE_SIDE,
  });
  const result = mesh(geometry(true), source, [0], [3]);
  result.polygonOffsetUnits = biased ? -8 : undefined;
  return result;
}

export function drawCoplanarBlend(
  renderer: WebglClusterRenderer,
  scene: WebglClusterScene,
  camera: HostDrawCamera,
  geometry: GeometryFactory,
  mesh: MeshFactory,
  base: G.GraphSurface,
  biased: boolean,
) {
  return renderer.draw(
    [mesh(geometry(), base, [0], [3]), coplanarBlendMesh(geometry, mesh, biased)],
    scene,
    camera,
    false,
    false,
  );
}
