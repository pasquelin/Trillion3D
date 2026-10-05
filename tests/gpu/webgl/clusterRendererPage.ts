// Page side of the cluster renderer proof: the engine's WebGL2 program drawing batch records into
// the host's canvas and into an sRGB framebuffer under a scissor, lit by each light kind it takes,
// textured, normal-mapped, restored after a context loss, and compared on curved and mirrored
// surfaces with the witness and with a supersampled image of the same shading.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import * as host from '../../../packages/sdk-browser/src/camera/world.ts';
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts';
import { curvedComparison, planarWitness } from './clusterCurved.ts';
import { curvedOracleQuality } from './clusterOracle.ts';
import { heldRestore } from './clusterRestore.ts';
import { normalMapFrames } from './clusterNormalMap.ts';
import { textureFixtures } from './clusterTextures.ts';
import { windingComparisons } from './clusterWinding.ts';
import { pixel, strictDegraded } from './clusterPixels.ts';
import { placeRig, triangle } from './clusterRig.ts';

/** Whether `draw` throws: the renderer refuses what it cannot draw before any pass. */
const refuses = (draw: () => void) => {
  try {
    draw();
  } catch {
    return true;
  }
  return false;
};

/** The triangle into an sRGB framebuffer of its own, half of it under a scissor, then its alpha
 *  as BLEND-less opacity and as a MASK cutoff: the destination the host renders into. */
function framebufferReadings(gl: WebGL2RenderingContext, draw: () => void, basic: G.GraphSurface) {
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
  draw();
  const drawError = gl.getError();
  const fboInside = pixel(gl, 12, 16),
    fboOutside = pixel(gl, 24, 16);
  gl.disable(gl.SCISSOR_TEST);
  basic.opacity = 0.5;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  draw();
  const opaqueAlpha = pixel(gl)[3];
  basic.opacity = 0.75;
  basic.alphaTest = 0.5;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  draw();
  const maskAlpha = pixel(gl)[3];
  basic.opacity = 1;
  basic.alphaTest = 0;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(texture);
  gl.deleteRenderbuffer(depth);
  return { framebufferStatus, drawError, fboInside, fboOutside, opaqueAlpha, maskAlpha };
}

export async function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const renderer = new WebglClusterRenderer(gl, strictDegraded()),
    scene = new G.Scene(),
    camera = G.perspectiveCamera(60, 1, 0.1, 10),
    drawCamera = host.readHostDrawCamera(host.createHostDrawCamera(), camera),
    { mesh, material: basic, geometry } = triangle();
  /** The triangle in the scene's light, on the bound target, the display encode or not. */
  const draw = (srgb = true) =>
    renderer.draw([mesh], keptClusterScene(scene), drawCamera, false, srgb);
  /** The triangle drawn on a blue clear: the centre pixel. */
  const centre = () => {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    draw();
    return pixel(gl);
  };
  gl.viewport(0, 0, 32, 32);
  gl.clearColor(0, 0, 1, 1);
  const canvasCenter = centre();
  mesh.matrix.makeScale(-1, 1, 1);
  const mirroredFront = centre();
  mesh.matrix.identity();
  const framebuffer = framebufferReadings(gl, () => draw(false), basic);
  const standard = G.standardSurface({ color: 0xffffff, roughness: 1, metalness: 0 });
  (standard.color as G.Color).setRGB(0.18, 0, 0);
  basic.dispose();
  mesh.material = standard;
  scene.add(G.ambientLight(0xffffff, Math.PI));
  const ambient = centre();
  scene.clear();
  const sun = G.directionalLight(0xffffff, 1);
  sun.position.set(0, 0, 1);
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  const direct = centre();
  scene.clear();
  const spot = G.spotLight(0xffffff, 1, 0, 0.5, 0, 2);
  spot.position.set(0, 0, 1);
  scene.add(spot, spot.target);
  scene.updateMatrixWorld(true);
  const zeroPenumbraSpot = centre();
  scene.clear();
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  placeRig(mesh, camera, sun, drawCamera, 1e8);
  const translatedDirect = centre();
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
  const neutralNormal = centre();
  standard.visible = false;
  const invisibleSubmissions = draw();
  standard.visible = true;
  standard.transparent = standard.premultipliedAlpha = true;
  const rejected = refuses(draw);
  standard.transparent = standard.premultipliedAlpha = false;
  scene.clear();
  const textures = textureFixtures(renderer, gl, mesh, keptClusterScene(scene), drawCamera);
  const normalFrames = normalMapFrames(renderer, gl, mesh, drawCamera);
  const sourceLights = new G.Scene(),
    nonPhysicalPoint = G.pointLight(0xffffff, 1);
  nonPhysicalPoint.decay = 1;
  sourceLights.add(nonPhysicalPoint);
  sourceLights.updateMatrixWorld(true);
  const decayRejected = refuses(() =>
    renderer.draw([mesh], keptClusterScene(sourceLights), drawCamera, false, true),
  );
  renderer.dispose();
  geometry.dispose();
  standard.dispose();
  return {
    canvasCenter,
    mirroredFront,
    ...framebuffer,
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
    curvedMotion: [-0.02, -0.01, 0, 0.01, 0.02].map((offset) => curvedComparison(128, offset)),
    curvedOracle: curvedOracleQuality(),
    winding: windingComparisons(),
  };
}
