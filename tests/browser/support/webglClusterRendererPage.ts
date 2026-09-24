import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import * as host from '../../../packages/sdk-browser/src/camera/world.ts';
import { curvedComparison, planarWitness } from './webglClusterCurvedPage.ts';
import { curvedOracleQuality } from './webglClusterOraclePage.ts';
import { heldRestore } from './webglClusterRestorePage.ts';
import { normalMapFrames } from './webglClusterNormalMapPage.ts';
import { textureFixtures } from './webglClusterTexturePage.ts';
import { windingComparisons } from './webglClusterWindingPage.ts';
import { pixel } from './webglClusterPixels.ts';
import { placeRig, triangle } from './webglClusterRendererRig.ts';

export async function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const renderer = new WebglClusterRenderer(gl),
    scene = new G.GraphScene(),
    camera = G.perspectiveCamera(60, 1, 0.1, 10),
    drawCamera = host.readHostDrawCamera(host.createHostDrawCamera(), camera),
    { mesh, material: basic, geometry: triangleGeometry } = triangle();
  gl.viewport(0, 0, 32, 32);
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const canvasCenter = pixel(gl, 16, 16);
  mesh.matrix.makeScale(-1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const mirroredFront = pixel(gl, 16, 16);
  mesh.matrix.identity();

  const texture = gl.createTexture(),
    framebuffer = gl.createFramebuffer(),
    depth = gl.createRenderbuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, 32, 32);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 32, 32);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, 16, 32);
  renderer.draw([mesh], scene, drawCamera, false, false);
  const drawError = gl.getError();
  const fboInside = pixel(gl, 12, 16),
    fboOutside = pixel(gl, 24, 16);
  basic.opacity = 0.5;
  gl.disable(gl.SCISSOR_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, false);
  const opaqueAlpha = pixel(gl, 16, 16)[3];
  basic.opacity = 0.75;
  basic.alphaTest = 0.5;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, false);
  const maskAlpha = pixel(gl, 16, 16)[3];
  basic.opacity = 1;
  basic.alphaTest = 0;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.SCISSOR_TEST);
  const standard = G.standardSurface({ color: 0xffffff, roughness: 1, metalness: 0 });
  (standard.color as G.Color).setRGB(0.18, 0, 0);
  basic.dispose();
  mesh.material = standard;
  scene.add(G.ambientLight(0xffffff, Math.PI));
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const ambient = pixel(gl, 16, 16);
  scene.clear();
  const sun = G.directionalLight(0xffffff, 1);
  sun.position.set(0, 0, 1);
  scene.add(sun, sun.target!);
  scene.updateMatrixWorld(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const direct = pixel(gl, 16, 16);
  scene.clear();
  const spot = G.spotLight(0xffffff, 1, 0, 0.5, 0, 2);
  spot.position.set(0, 0, 1);
  scene.add(spot, spot.target!);
  scene.updateMatrixWorld(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const zeroPenumbraSpot = pixel(gl, 16, 16);
  scene.clear();
  scene.add(sun, sun.target!);
  scene.updateMatrixWorld(true);
  placeRig(mesh, camera, sun, drawCamera, 1e8);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const translatedDirect = pixel(gl, 16, 16);
  placeRig(mesh, camera, sun, drawCamera, 0);
  const neutral = document.createElement('canvas');
  neutral.width = neutral.height = 1;
  const context = neutral.getContext('2d');
  if (!context) throw new Error('2d context unavailable');
  context.fillStyle = 'rgb(128,128,255)';
  context.fillRect(0, 0, 1, 1);
  const normalMap = G.canvasTexture(neutral);
  normalMap.colorSpace = G.HOST_COLOUR_SPACE_NONE;
  standard.normalMap = normalMap;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const neutralNormal = pixel(gl, 16, 16);
  standard.visible = false;
  const invisibleSubmissions = renderer.draw([mesh], scene, drawCamera, false, true);
  standard.visible = true;
  standard.transparent = true;
  standard.premultipliedAlpha = true;
  let rejected = false;
  try {
    renderer.draw([mesh], scene, drawCamera, false, true);
  } catch {
    rejected = true;
  }
  standard.transparent = standard.premultipliedAlpha = false;
  scene.clear();
  const textures = textureFixtures(renderer, gl, mesh, scene, drawCamera, pixel);
  const normalFrames = normalMapFrames(renderer, gl, mesh, drawCamera, pixel);
  const sourceLights = new G.GraphScene(),
    nonPhysicalPoint = G.pointLight(0xffffff, 1);
  nonPhysicalPoint.decay = 1;
  sourceLights.add(nonPhysicalPoint);
  sourceLights.updateMatrixWorld(true);
  let decayRejected = false;
  try {
    renderer.draw([mesh], sourceLights, drawCamera, false, true);
  } catch {
    decayRejected = true;
  }
  renderer.dispose();
  triangleGeometry.dispose();
  standard.dispose();
  const curvedMotion = [-0.02, -0.01, 0, 0.01, 0.02].map((offset) => curvedComparison(128, offset));
  return {
    canvasCenter,
    mirroredFront,
    fboInside,
    fboOutside,
    opaqueAlpha,
    maskAlpha,
    framebufferStatus,
    drawError,
    ambient,
    direct,
    zeroPenumbraSpot,
    translatedDirect,
    directWitness: planarWitness(),
    neutralNormal,
    invisibleSubmissions,
    rejected,
    textures,
    normalFrames,
    decayRejected,
    heldRestore: await heldRestore(),
    curved: [64, 128, 256].map((size) => curvedComparison(size)),
    curvedMotion,
    curvedOracle: curvedOracleQuality(),
    winding: windingComparisons(),
  };
}
