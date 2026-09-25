import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import type { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import type { pixel as pixelType } from './webglClusterPixels.ts';

/** A one-texel normal map storing the tangent-space normal `[r, g, b]` as bytes. */
const normalMap = (r: number, g: number, b: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2d context unavailable');
  context.fillStyle = `rgb(${r},${g},${b})`;
  context.fillRect(0, 0, 1, 1);
  const texture = G.canvasTexture(canvas);
  texture.colorSpace = G.HOST_COLOUR_SPACE_NONE;
  return texture;
};

/** The texel as the shader decodes it: `byte / 255 × 2 − 1`, then normalised. */
const decoded = (r: number, g: number, b: number) =>
  new G.Vector3((r / 255) * 2 - 1, (g / 255) * 2 - 1, (b / 255) * 2 - 1).normalize();

/** Texture coordinates of the proof triangle: u along +x, v along `vSign` × y. */
const texcoords = (vSign: number) =>
  new G.BufferAttribute(
    new Float32Array([0, 0.5 - vSign * 0.5, 1, 0.5 - vSign * 0.5, 0.5, 0.5 + vSign * 0.5]),
    2,
  );

/**
 * The reconstructed tangent frame, proved without a tangent attribute: the flat triangle drawn
 * with a tilted normal map must match the same triangle drawn with the tilted normal baked into
 * its vertex normals (u along +x, v along ±y, so the frame is `(±x, ±y, z)` up to handedness).
 * The sun sits off the y axis so the sign of the y tilt shows in the pixel.
 */
export function normalMapFrames(
  renderer: WebglClusterRenderer,
  gl: WebGL2RenderingContext,
  mesh: ClusterDrawMesh,
  drawCamera: HostDrawCamera,
  pixel: typeof pixelType,
) {
  const previous = mesh.material,
    previousUv = mesh.geometry.attributes.uv,
    scene = new G.GraphScene(),
    sun = G.directionalLight(0xffffff, 1),
    texel: [number, number, number] = [160, 210, 230],
    tilt = decoded(...texel),
    mapped = G.standardSurface({ roughness: 1, metalness: 0 }),
    baked = G.standardSurface({ roughness: 1, metalness: 0 });
  sun.position.set(0, 1, 1);
  scene.add(sun, sun.target!);
  scene.updateMatrixWorld(true);
  (mapped.color as G.Color).setRGB(0.18, 0, 0);
  (baked.color as G.Color).copy(mapped.color as G.Color);
  mapped.normalMap = normalMap(...texel);
  const draw = (material: G.GraphSurface, vSign: number, normal: [number, number, number]) => {
    mesh.material = material;
    mesh.geometry.attributes.uv = texcoords(vSign);
    mesh.geometry.attributes.normal = new G.BufferAttribute(
      new Float32Array([...normal, ...normal, ...normal]),
      3,
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    renderer.draw([mesh], scene, drawCamera, false, true);
    return pixel(gl, 16, 16);
  };
  const flat: [number, number, number] = [0, 0, 1];
  const result = {
    tilted: draw(mapped, 1, flat),
    tiltedWitness: draw(baked, 1, [tilt.x, tilt.y, tilt.z]),
    mirrored: draw(mapped, -1, flat),
    mirroredWitness: draw(baked, -1, [tilt.x, -tilt.y, tilt.z]),
  };
  mesh.geometry.attributes.uv = previousUv;
  mesh.geometry.attributes.normal = new G.BufferAttribute(
    new Float32Array([...flat, ...flat, ...flat]),
    3,
  );
  mesh.material = previous;
  (mapped.normalMap as G.GraphTexture).dispose();
  mapped.dispose();
  baked.dispose();
  return result;
}
