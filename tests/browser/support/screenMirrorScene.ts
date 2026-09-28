// Synthetic replacement for the unavailable original mirror asset. Geometry is sent through
// production page decoding, vertex transforms and materials; no shader or vertex is substituted.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { batisseur } from './sharedSceneProof.ts';

export type MirrorOptions = { arrangement: number; transparent: boolean; ortho: boolean };

export function mirrorScene(options: MirrorOptions, roughness: number) {
  const builder = batisseur();
  const tilt = options.arrangement ? -Math.PI / 3 : -Math.PI / 4;
  const normal = new G.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
  const receiver = G.mesh(
    G.planeGeometry(3.6, 3.6),
    G.standardSurface({
      color: 0xffffff, metalness: 1, roughness,
      transparent: options.transparent, opacity: 1, side: G.DOUBLE_SIDE,
    }),
  );
  receiver.rotation.x = tilt;
  builder.source.add(receiver);
  builder.ajoute(receiver, options.transparent ? 'clustered-blend' : 'exact-clusters', 1.8);
  const sources = [0xff0000, 0x00ff00].map((color, i) => {
    const mesh = G.mesh(
      G.planeGeometry(0.44, 0.44),
      G.standardSurface({ color: 0, emissive: color, emissiveIntensity: 2, roughness: 1 }),
    );
    mesh.name = `source-${i}`;
    mesh.position.set(i ? 0.65 : -0.65, options.arrangement ? 1.2 : 1, 1);
    builder.source.add(mesh);
    builder.ajoute(mesh, 'exact-clusters', 0.22);
    return mesh;
  });
  const camera = options.ortho
    ? G.orthographicCamera(-2.6, 2.6, 2.6, -2.6, 0.1, 100)
    : G.perspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  // Independent analytic oracle: reflect the source across the mirror plane, then intersect
  // the viewing ray with that plane. Orthographic rays share direction, not eye position.
  function reflected(source: G.Vector3) {
    const virtual = source.clone().addScaledVector(normal, -2 * source.dot(normal));
    const ray = options.ortho ? new G.Vector3(0, 0, -1) : virtual.clone().sub(camera.position);
    return virtual.addScaledVector(ray, -virtual.dot(normal) / ray.dot(normal));
  }
  return { scene: builder.fini(), camera, sources, reflected };
}
