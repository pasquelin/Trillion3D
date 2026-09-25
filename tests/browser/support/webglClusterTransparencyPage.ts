import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { triangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import { pageDiagnostics } from '../../../packages/sdk-browser/src/host/pageDiagnostics.ts';
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts';
import { drawCoplanarBlend } from './webglClusterCoplanarBlend.ts';
import { clear, clusterRecord, mountClusterRenderer, pixel } from './webglClusterPixels.ts';

const geometry = (reverseFirst = false) => {
  const result = new G.Geometry();
  result.setAttribute(
    'position',
    new G.BufferAttribute(
      new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2, -1, -1, -2, 1, -1, -2, 0, 1, -2]),
      3,
    ),
  );
  result.setAttribute(
    'color',
    new G.BufferAttribute(
      new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  result.setIndex(
    new G.BufferAttribute(
      new Uint32Array(reverseFirst ? [0, 2, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5]),
      1,
    ),
  );
  return result;
};

export function execute() {
  const mounted = mountClusterRenderer();
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { gl, renderer, scene, drawCamera } = mounted;
  const blend = G.basicSurface({
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
      depthWrite: false,
    }),
    ordered = clusterRecord(geometry(), blend, [0, 3], [3, 3]);
  clear(gl);
  renderer.draw([ordered], scene, drawCamera, false, false);
  const sourceOrder = pixel(gl);
  ordered._multiDrawStarts = new Int32Array([12, 0]);
  clear(gl);
  renderer.draw([ordered], scene, drawCamera, false, false);
  const reversedOrder = pixel(gl);

  const double = G.basicSurface({
    transparent: true,
    opacity: 0.5,
    vertexColors: true,
    side: G.DOUBLE_SIDE,
  });
  // The record carries the source material: its two passes are read at the draw.
  const split = clusterRecord(geometry(true), double);
  clear(gl);
  const splitSubmissions = renderer.draw([split], scene, drawCamera, false, false);
  const splitPixel = pixel(gl);
  double.forceSinglePass = true;
  clear(gl);
  const singleSubmissions = renderer.draw([split], scene, drawCamera, false, false);

  const mask = G.basicSurface({ color: 0xff0000, opacity: 0.5, alphaTest: 0.4 });
  const single = clusterRecord(geometry(), mask, [0], [3]);
  clear(gl);
  renderer.draw([single], scene, drawCamera, false, false);
  const maskPixel = pixel(gl);
  mask.transparent = true;
  clear(gl);
  renderer.draw([single], scene, drawCamera, false, false);
  const blendPixel = pixel(gl);

  const lower = G.basicSurface({ color: 0xff0000, depthFunc: G.DEPTH_LESS }),
    raised = G.basicSurface({
      color: 0x00ff00,
      depthFunc: G.DEPTH_LESS,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -8,
    });
  clear(gl);
  renderer.draw(
    [clusterRecord(geometry(), lower, [0], [3]), clusterRecord(geometry(), raised, [0], [3])],
    scene,
    drawCamera,
    false,
    false,
  );
  const coplanarPixel = pixel(gl);

  clear(gl);
  const coplanarBlendSubmissions = drawCoplanarBlend(
    renderer,
    scene,
    drawCamera,
    geometry,
    clusterRecord,
    lower,
    false,
  );
  const coplanarBlendWithoutBias = pixel(gl);
  clear(gl);
  drawCoplanarBlend(renderer, scene, drawCamera, geometry, clusterRecord, lower, true);
  const coplanarBlendPixel = pixel(gl);

  const diagnosticGeometry = asHostLibrary<G.Geometry>(
      triangleGeometry(geometry(), pageDiagnostics),
    ),
    diagnosticMaterial = G.basicSurface({ vertexColors: true }),
    diagnostic = G.mesh(diagnosticGeometry, diagnosticMaterial);
  diagnostic.matrixAutoUpdate = false;
  clear(gl);
  const diagnosticSubmissions = renderer.draw([], scene, drawCamera, false, false, [diagnostic]);
  const diagnosticPixel = pixel(gl);

  double.forceSinglePass = false;
  double.visible = false;
  clear(gl);
  const hiddenSubmissions = renderer.draw([split], scene, drawCamera, false, false);
  const hiddenPixel = pixel(gl);
  double.visible = true;
  double.premultipliedAlpha = true;
  clear(gl);
  let sourceMutationRejected = false;
  try {
    renderer.draw([split], scene, drawCamera, false, false);
  } catch {
    sourceMutationRejected = true;
  }
  const sourceRejectionPixel = pixel(gl);
  double.premultipliedAlpha = false;
  // A material array set on a record is refused by name before any pass draws.
  split.material = [double, double];
  clear(gl);
  let mutationRejected = false;
  try {
    renderer.draw([split], scene, drawCamera, false, false);
  } catch {
    mutationRejected = true;
  }
  const rejectionPixel = pixel(gl);
  renderer.dispose();
  return {
    sourceOrder,
    reversedOrder,
    splitPixel,
    splitSubmissions,
    singleSubmissions,
    maskPixel,
    blendPixel,
    coplanarPixel,
    coplanarBlendPixel,
    coplanarBlendWithoutBias,
    coplanarBlendSubmissions,
    diagnosticPixel,
    diagnosticSubmissions,
    mutationRejected,
    rejectionPixel,
    hiddenSubmissions,
    hiddenPixel,
    sourceMutationRejected,
    sourceRejectionPixel,
  };
}
