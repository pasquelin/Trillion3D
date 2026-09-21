import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import * as host from '../../packages/sdk-browser/cameraWorld.ts';
import { curvedComparison, planarWitness } from './webglClusterCurvedPage.mjs';
import { curvedOracleQuality } from './webglClusterOraclePage.mjs';
import { heldRestore } from './webglClusterRestorePage.mjs';
import { normalMapFrames } from './webglClusterNormalMapPage.mjs';
import { textureFixtures } from './webglClusterTexturePage.mjs';
import { windingComparisons } from './webglClusterWindingPage.mjs';
const pixel = (gl, x, y) => {
  const value = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};
const triangle = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const material = new THREE.MeshBasicMaterial();
  material.color.setRGB(0.18, 0, 0, THREE.LinearSRGBColorSpace);
  return {
    geometry,
    material,
    matrix: new THREE.Matrix4(),
    _multiDrawCounts: new Int32Array([3]),
    _multiDrawStarts: new Int32Array([0]),
    _multiDrawCount: 1,
  };
};
const placeRig = (mesh, camera, light, drawCamera, offset) => {
  mesh.matrix.makeTranslation(offset, offset, offset);
  camera.position.set(offset, offset, offset);
  light.position.set(offset, offset, offset + 1);
  light.target.position.set(offset, offset, offset);
  light.parent.updateMatrixWorld(true);
  host.readHostDrawCamera(drawCamera, camera);
};
export async function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const renderer = new WebglClusterRenderer(gl),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    drawCamera = host.readHostDrawCamera(host.createHostDrawCamera(), camera),
    mesh = triangle();
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
  mesh.material.opacity = 0.5;
  gl.disable(gl.SCISSOR_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, false);
  const opaqueAlpha = pixel(gl, 16, 16)[3];
  mesh.material.opacity = 0.75;
  mesh.material.alphaTest = 0.5;
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, false);
  const maskAlpha = pixel(gl, 16, 16)[3];
  mesh.material.opacity = 1;
  mesh.material.alphaTest = 0;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.SCISSOR_TEST);
  const standard = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  standard.color.setRGB(0.18, 0, 0, THREE.LinearSRGBColorSpace);
  mesh.material.dispose();
  mesh.material = standard;
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const ambient = pixel(gl, 16, 16);
  scene.clear();
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(0, 0, 1);
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const direct = pixel(gl, 16, 16);
  scene.clear();
  const spot = new THREE.SpotLight(0xffffff, 1, 0, 0.5, 0, 2);
  spot.position.set(0, 0, 1);
  scene.add(spot, spot.target);
  scene.updateMatrixWorld(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const zeroPenumbraSpot = pixel(gl, 16, 16);
  scene.clear();
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  placeRig(mesh, camera, sun, drawCamera, 1e8);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  renderer.draw([mesh], scene, drawCamera, false, true);
  const translatedDirect = pixel(gl, 16, 16);
  placeRig(mesh, camera, sun, drawCamera, 0);
  const neutral = document.createElement('canvas');
  neutral.width = neutral.height = 1;
  const context = neutral.getContext('2d');
  context.fillStyle = 'rgb(128,128,255)';
  context.fillRect(0, 0, 1, 1);
  standard.normalMap = new THREE.CanvasTexture(neutral);
  standard.normalMap.colorSpace = THREE.NoColorSpace;
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
  const sourceLights = new THREE.Scene(),
    nonPhysicalPoint = new THREE.PointLight(0xffffff, 1);
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
  mesh.geometry.dispose();
  mesh.material.dispose();
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
