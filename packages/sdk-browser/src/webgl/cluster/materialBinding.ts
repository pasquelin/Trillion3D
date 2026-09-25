import { visMaterial } from '../../visibility/shader/material.ts';
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts';
import { SURFACE_MODEL, shownAsIs } from '../../scene/surfaceModel.ts';
import { blendingOf } from '../../scene/materialBlending.ts';
import { writeDepthRamp } from '../../camera/depthConvention.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import type { ClusterDrawMesh } from '../../cluster/batchMesh.ts';
import type { Side } from '../../../../sdk-core/src/index.ts';
import type { WebglClusterTextures } from './textures.ts';
import type { WebglClusterState } from './state.ts';
import type { Matrix3UniformCache } from './uniforms.ts';
import type { WebglClusterMaterialUniforms } from './materialUniforms.ts';

export type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
const MAPS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'emissiveMap'] as const;
const MAP_UNIFORMS = ['baseUv', 'roughUv', 'metalUv', 'normalUv', 'aoUv', 'emissiveUv'];
/** The frame's depth ramp: the fragment holds the view distance, so the perspective weights. */
const ramp = new Float32Array(3);
/** A surface's sprite words (`writeSpriteWords`), rewritten at every binding. */
const sprite = new Float64Array(2);
/** Units after the six material maps: the frozen backdrop colour, then its depth. */
export const BACKDROP_UNITS: [number, number] = [6, 7];

type Binding = {
  uniforms: WebglClusterMaterialUniforms;
  matrices: Matrix3UniformCache;
  textures: WebglClusterTextures;
  state: WebglClusterState;
  /** The effect chain's linear program (`CLUSTER_LINEAR_FRAGMENT`), which reads `covering`. */
  linear?: boolean;
};

/**
 * Whether a surface drawn into the effect chain's linear target, whose alpha is coverage
 * (`../../effects/webglOutput.ts`), covers its pixel whatever its alpha: an opaque one, and a
 * transparent one that replaces what is behind it (`none`), as the display path shows it.
 * Multiply and subtractive filter what the display target holds, the background included, which
 * the linear target does not hold: they are refused by name, never drawn as another mode.
 */
function coversLinear(material: Material) {
  if (!material.transparent) return true;
  const mode = blendingOf(material.blending as number | undefined);
  if (mode === 'multiply' || mode === 'subtractive')
    throw new Error(`the WebGL2 effect chain cannot draw ${mode} blending`);
  return mode === 'none';
}

/** Uploads one material's factors, maps and raster state; cached values are skipped. `side`
 *  names the faces of one pass of a two-sided transparent surface; undefined, the material's
 *  own faces draw. */
export function bindClusterMaterial(
  binding: Binding,
  material: Material,
  toneMapped: boolean,
  side?: Side,
  polygonOffsetUnits?: number,
) {
  const { uniforms, matrices, textures, state, linear } = binding;
  const source = material as { opacity: number },
    mat = visMaterial(material);
  // An unlit material keeps its occlusion map and strength on the host object alone: its map is
  // imported here, as the boundary imports every other, into the engine record the binding reads.
  const basic = material as { aoMap?: HostTexture | null; aoMapIntensity?: number },
    aoMap = mat.aoMap ?? (!mat.lit && basic.aoMap ? importHostTexture(basic.aoMap) : undefined),
    aoIntensity = mat.aoMap ? mat.aoIntensity : (basic.aoMapIntensity ?? 1);
  uniforms.f4(
    0,
    'baseFactor',
    mat.baseColor[0],
    mat.baseColor[1],
    mat.baseColor[2],
    material.transparent ? source.opacity : 1,
  );
  uniforms.f1(4, 'metalFactor', mat.metalness);
  uniforms.f1(5, 'roughFactor', mat.roughness);
  uniforms.f1(6, 'alphaCutoff', mat.alphaTest);
  uniforms.f2(7, 'normalScale', mat.normalScale, mat.normalScaleY);
  uniforms.f1(9, 'aoStrength', aoIntensity);
  uniforms.f3(10, 'emissiveFactor', mat.emissive);
  uniforms.i1(13, 'lit', mat.lit ? 1 : 0);
  uniforms.i1(14, 'hasNormalMap', mat.normalMap ? 1 : 0);
  uniforms.i1(15, 'hasVertexColor', material.vertexColors ? 1 : 0);
  // A debug view, a normal or depth surface, is output untouched (`shownAsIs`).
  uniforms.i1(16, 'toneMapped', toneMapped && material.toneMapped && !shownAsIs(mat.model) ? 1 : 0);
  if (linear) uniforms.i1(47, 'covering', coversLinear(material) ? 1 : 0);
  const sharedMetalRough =
    !!mat.roughnessMap &&
    mat.roughnessMap === mat.metalnessMap &&
    mat.roughnessMap.channel === mat.metalnessMap.channel;
  let mapMask = 0;
  for (let unit = 0; unit < MAPS.length; unit++) {
    const texture = MAPS[unit] === 'aoMap' ? aoMap : mat[MAPS[unit]];
    if (texture) mapMask |= 1 << unit;
    textures.bind(
      unit,
      sharedMetalRough && unit === 2 ? undefined : texture,
      texture?.colorSpace === 'srgb',
      unit === 3 ? [128, 128, 255, 255] : undefined,
    );
    if (!texture || (sharedMetalRough && unit === 2)) continue;
    matrices.set(MAP_UNIFORMS[unit], texture.transform);
  }
  uniforms.i1(23, 'mapMask', mapMask);
  uniforms.i1(24, 'sharedMetalRough', sharedMetalRough ? 1 : 0);
  uniforms.i4(
    17,
    'mapChannels',
    mat.map?.channel ?? 0,
    mat.roughnessMap?.channel ?? 0,
    mat.metalnessMap?.channel ?? 0,
    mat.normalMap?.channel ?? 0,
  );
  uniforms.i2(21, 'extraChannels', aoMap?.channel ?? 0, mat.emissiveMap?.channel ?? 0);
  // The transmission volume, read only by the pass that carries the flag.
  uniforms.i1(25, 'transmissive', mat.transmission > 0 ? 1 : 0);
  uniforms.f4(26, 'volume', mat.transmission, mat.ior, mat.thickness, mat.attenuationDistance);
  uniforms.f3(30, 'attenuationColor', mat.attenuationColor);
  uniforms.i1(33, 'flatShaded', (material as { flatShading?: boolean }).flatShading ? 1 : 0);
  // A line surface's width in CSS pixels (`CLUSTER_VERTEX`); zero draws the triangles as they are.
  uniforms.f1(39, 'lineWidth', mat.lineWidth ?? 0);
  // A dashed line's dash and gap (`CLUSTER_FRAGMENT`); zero keeps every pixel.
  uniforms.f2(43, 'dash', mat.dashSize ?? 0, mat.gapSize ?? 0);
  // A sprite's turn and size rule (`CLUSTER_VERTEX`); zero draws the triangles as they are.
  writeSpriteWords(sprite, 0, mat.sprite);
  uniforms.f2(45, 'sprite', sprite[0], sprite[1]);
  const doubleSided = side === undefined ? mat.doubleSided : false,
    backSide = side === undefined ? mat.backSide : side === 'back';
  // A depth material shows the frame's depth ramp in place of its colour (`beginFrame`).
  uniforms.i1(35, 'depthShaded', mat.model === SURFACE_MODEL.depth ? 1 : 0);
  // A diagnostic view's surface is shown as it is, never through the fog
  // (`../../host/pageDiagnostics.ts`).
  uniforms.i1(38, 'fogFree', (material as { fog?: boolean }).fog === false ? 1 : 0);
  // Which faces turn their normal toward the eye: none, the back faces of a surface drawn from
  // behind, or both, whose normal map's tangents then turn with them.
  uniforms.i1(34, 'faceSides', doubleSided ? 2 : backSide ? 1 : 0);
  state.apply(material, doubleSided, backSide, polygonOffsetUnits);
}

/**
 * The material of the last submission, its pass and its layer: a mesh wearing the same one draws
 * on the uniforms, maps and raster state already set. `forget` at every frame and every change of
 * destination — a surface may be rewritten between frames without a version.
 */
export class ClusterMaterialPass {
  private binding: Binding;
  private material: Material | undefined;
  private toneMapped = false;
  private side: Side | undefined;
  private offset: number | undefined;
  constructor(binding: Binding) {
    this.binding = binding;
  }
  bind(material: Material, toneMapped: boolean, side?: Side, offset?: number) {
    if (
      material === this.material &&
      toneMapped === this.toneMapped &&
      side === this.side &&
      offset === this.offset
    )
      return;
    bindClusterMaterial(this.binding, material, toneMapped, side, offset);
    this.material = material;
    this.toneMapped = toneMapped;
    this.side = side;
    this.offset = offset;
  }
  forget() {
    this.material = undefined;
  }
  /** Image pixels per CSS pixel, written by the owner before a frame: a line's width scale. */
  pixelRatio = 1;
  /** A new frame: nothing bound yet, the ramp a depth material shows under its camera, the size
   *  in pixels of the image a line is widened in — the viewport's `[x, y, w, h]` — and the image
   *  pixels per CSS pixel its width is scaled by. */
  beginFrame(camera: { near: number; far: number }, viewport: ArrayLike<number>) {
    this.forget();
    writeDepthRamp(ramp, 0, camera.near, camera.far, 1);
    this.binding.uniforms.f2(36, 'depthRamp', ramp[0], ramp[1]);
    this.binding.uniforms.f2(40, 'viewport', viewport[2], viewport[3]);
    this.binding.uniforms.f1(42, 'pixelRatio', this.pixelRatio);
  }
}
