// The screen mirror proof's scene: a tilted mirror and two emissive sources, built in code. Its
// geometry goes through the engine's page decoding, vertex transforms and materials; no shader or
// vertex is substituted.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { project } from '../kit/cameraRig.ts';
import { batisseur } from '../kit/sharedSceneProof.ts';

export type MirrorOptions = {
  arrangement: number;
  transparent: boolean;
  ortho: boolean;
  bounce?: boolean;
};

export function mirrorScene(options: MirrorOptions, roughness: number) {
  const builder = batisseur();
  const { ajoute: add } = builder;
  const tilt = options.arrangement ? -Math.PI / 3 : -Math.PI / 4;
  const normal = new G.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
  const receiver = G.mesh(
    G.planeGeometry(6.4, 6.4),
    G.standardSurface({
      color: 0xffffff,
      metalness: 1,
      roughness,
      transparent: options.transparent,
      opacity: 1,
      side: G.DOUBLE_SIDE,
    }),
  );
  receiver.rotation.x = tilt;
  builder.source.add(receiver);
  add(receiver, options.transparent ? 'clustered-blend' : 'exact-clusters', 3.2);
  const sources = [0xff0000, 0x00ff00].map((color, i) => {
    const mesh = G.mesh(
      G.planeGeometry(0.44, 0.44),
      G.standardSurface({
        color: 0,
        emissive: color,
        emissiveIntensity: 2,
        side: G.DOUBLE_SIDE,
        roughness: 1,
      }),
    );
    mesh.name = `source-${i}`;
    mesh.position.set(i ? 0.65 : -0.65, options.arrangement ? 1.2 : 1, 1);
    builder.source.add(mesh);
    add(mesh, 'exact-clusters', 0.22);
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
  // Validate the fixture before rendering: every sampled hit lies inside the finite mirror
  // and both the direct source and its reflection lie in view for both camera projections.
  for (const x of [-1.2, -0.65, 0.65]) {
    const source = sources[0].position.clone();
    source.x = x;
    const hit = reflected(source);
    if (Math.abs(hit.x) >= 3.2 || Math.abs(hit.y / Math.cos(tilt)) >= 3.2)
      throw new Error('Analytic hit is outside the mirror');
    for (const point of [source, hit]) {
      const ndc = project(point.clone(), camera);
      if (Math.abs(ndc.x) >= 0.95 || Math.abs(ndc.y) >= 0.95)
        throw new Error('Mirror oracle sample is outside the viewport');
    }
  }
  return { scene: builder.fini(), camera, sources, reflected };
}
