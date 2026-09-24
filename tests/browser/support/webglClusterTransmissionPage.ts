// Standalone proof of the autonomous transmission pass: what a transmissive scene copy lets
// through is the engine's own cluster image, opaque and blended, depth-tested both ways.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import { clear, clusterRecord, mountClusterRenderer, pixel, quad } from './webglClusterPixels.ts';

const glassMesh = (options: Partial<G.SurfaceParameters> = {}) => {
  const mesh = G.mesh(
    quad(-1),
    G.physicalSurface({ color: 0xffffff, transmission: 1, roughness: 1, ...options }),
  );
  mesh.matrixAutoUpdate = false;
  return mesh;
};

export function execute() {
  const mounted = mountClusterRenderer();
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { gl, renderer, scene, drawCamera } = mounted;
  const red = clusterRecord(quad(-3), G.basicSurface({ color: 0xff0000 })),
    glass = glassMesh();
  scene.background = new G.Color(0x0000ff);
  const draw = (clusters: ClusterDrawMesh[], copies: G.GraphMesh[], srgb = false) =>
    renderer.draw(clusters, scene, drawCamera, false, srgb, [], copies);
  const passes = () => ({
    backdrop: renderer.backdropSubmissions,
    copies: renderer.copySubmissions,
  });

  clear(gl);
  const withoutGlass = draw([red], []);
  const opaquePixel = pixel(gl);
  clear(gl);
  const submissions = { clusters: draw([red], [glass]), ...passes() };
  const throughGlass = pixel(gl);
  const restored = {
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
    viewport: [...gl.getParameter(gl.VIEWPORT)],
    backdropBytes: renderer.backdropBytes,
  };
  clear(gl);
  draw([red], [glass], true);
  const encoded = pixel(gl);

  // The background shows through where no cluster stands behind the glass.
  clear(gl);
  draw([], [glass]);
  const backgroundThrough = pixel(gl);

  // A cluster in front of the glass hides it: shared depth, tested the usual way.
  const yellow = clusterRecord(quad(-0.5), G.basicSurface({ color: 0xffff00 }));
  clear(gl);
  draw([red, yellow], [glass]);
  const occluded = pixel(gl);

  // A blended cluster behind the glass is part of what it lets through.
  const blue = clusterRecord(
    quad(-2),
    G.basicSurface({ color: 0x0000ff, transparent: true, opacity: 0.5 }),
  );
  clear(gl);
  draw([red, blue], [glass]);
  const blendedThrough = pixel(gl);

  // The volume attenuates: half the light over one unit of thickness.
  const tinted = glassMesh({
    thickness: 1,
    attenuationDistance: 1,
    attenuationColor: new G.Color().setRGB(0.5, 0.5, 0.5),
  });
  clear(gl);
  draw([red], [tinted]);
  const attenuated = pixel(gl);

  // A declared light reflects on the glass; its diffuse lobe cancels, its specular stays.
  const sun = G.directionalLight(0xffffff, 1);
  sun.position.set(0, 0, 1);
  scene.add(sun, sun.target!);
  scene.updateMatrixWorld(true);
  const shiny = glassMesh({ roughness: 0.5 });
  clear(gl);
  draw([red], [shiny]);
  const lit = pixel(gl);
  scene.clear();

  // A sub-viewport: the backdrop follows it, texel for texel, and nothing outside it moves.
  clear(gl);
  gl.viewport(8, 8, 16, 16);
  draw([red], [glass]);
  gl.viewport(0, 0, 32, 32);
  const subViewport = { inside: pixel(gl), outside: pixel(gl, 2, 2) };

  // A glass outside the view costs nothing: no copy submitted, no backdrop pass.
  const away = glassMesh();
  away.matrix.makeTranslation(100, 0, 0);
  away.updateWorldMatrix(false, false);
  away.geometry.computeBoundingBox();
  clear(gl);
  const offscreen = { clusters: draw([red], [away]), ...passes(), pixel: pixel(gl) };

  // Another physical extension is refused before anything is drawn.
  const coated = glassMesh({ clearcoat: 0.5 });
  clear(gl);
  let refused = null;
  try {
    draw([red], [coated]);
  } catch (error) {
    const details = error as { code?: string; details?: { reason?: string } };
    refused = { code: details.code ?? null, reason: details.details?.reason ?? null };
  }
  const refusedPixel = pixel(gl);
  const drawError = gl.getError();
  renderer.dispose();
  return {
    withoutGlass,
    submissions,
    opaquePixel,
    throughGlass,
    encoded,
    restored,
    backgroundThrough,
    occluded,
    blendedThrough,
    attenuated,
    lit,
    subViewport,
    offscreen,
    refused,
    refusedPixel,
    drawError,
  };
}
