import { surfaceOpacity } from '../../page/surface.ts';
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';
import { writeSpriteWords } from '../../visibility/shader/spriteWgsl.ts';
import { SURFACE_MODEL, shownAsIs } from '../../scene/surfaceModel.ts';
import type { HostShadedMaterial } from '../../host/shadedMaterial.ts';
import type { Side } from '../../../../sdk-core/src/index.ts';
import type { WebglClusterTextures } from './textures.ts';
import { drawnModeOf, type WebglClusterState } from './state.ts';
import { refusesLinear } from './linearRefusal.ts';
import { refuseCluster } from './refusal.ts';
import type { Matrix3UniformCache } from './uniforms.ts';
import type { WebglClusterMaterialUniforms } from './materialUniforms.ts';
import { eachMap, MAP_UNIFORMS, type Material } from './materialMaps.ts';

/** A surface's sprite words (`writeSpriteWords`), rewritten at every binding. */
const sprite = new Float64Array(2);

export type Binding = {
  uniforms: WebglClusterMaterialUniforms;
  matrices: Matrix3UniformCache;
  textures: WebglClusterTextures;
  state: WebglClusterState;
  /** Draws into the effect chain's linear program: a transparent `none` surface also covers. */
  linear?: boolean;
};

/**
 * Whether a transparent surface drawn into the effect chain's linear target, whose alpha is
 * coverage (`../effects/webglOutput.ts`), covers its pixel whatever its alpha: one that
 * replaces what is behind it (`none`), as the display path shows it. A mode the target
 * cannot hold (`refusesLinear`) never reaches here: the composer draws such a frame without the
 * chain (`linearRefusal`); a caller that skipped that read is refused by name.
 */
function coversLinear(material: Material) {
  const mode = drawnModeOf(material);
  if (refusesLinear(mode)) refuseCluster(`the WebGL2 effect chain cannot draw ${mode} blending`);
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
  const source = material as { opacity: number };
  let mapMask = 0;
  textures.file(material);
  const { mat, aoMap, sharedMetalRough } = eachMap(
    material,
    (unit, map, texture, srgb, fallback, reader) => {
      if (map) mapMask |= 1 << unit;
      textures.bind(unit, texture, srgb, fallback, reader);
      if (texture) matrices.set(MAP_UNIFORMS[unit], texture.transform);
    },
  );
  textures.physical?.(material, mat, uniforms.at, matrices);
  uniforms.f2(
    57,
    'coatNormalScale',
    mat.clearcoatNormalScale?.[0] ?? 1,
    mat.clearcoatNormalScale?.[1] ?? 1,
  );
  const aoIntensity = mat.aoMap
    ? mat.aoIntensity
    : ((material as HostShadedMaterial).aoMapIntensity ?? 1);
  uniforms.f4(
    0,
    'baseFactor',
    mat.baseColor[0],
    mat.baseColor[1],
    mat.baseColor[2],
    // glTF 2.0 cuts the colour factor's alpha times the map's, as WebGPU's `maskKeep` (#769).
    material.transparent || mat.alphaTest > 0 ? surfaceOpacity(source) : 1,
  );
  uniforms.f4(
    49,
    'physical',
    Math.min(1, Math.max(0, mat.anisotropy ?? 0)),
    mat.anisotropyRotation ?? 0,
    Math.min(1, Math.max(0, mat.clearcoat ?? 0)),
    Math.min(1, Math.max(Number(ROUGHNESS_FLOOR), mat.clearcoatRoughness ?? 0)),
  );
  uniforms.f3(53, 'subsurfaceFactor', mat.subsurfaceColor ?? [0, 0, 0]);
  uniforms.i1(56, 'subsurfaceChannel', mat.subsurfaceMap?.channel ?? 0);
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
  // An opaque surface writes alpha 1 whatever it was cut at; into the chain, alpha is coverage.
  uniforms.i1(47, 'covering', !material.transparent || (linear && coversLinear(material)) ? 1 : 0);
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
  // The surface model the program shades by (`../../scene/surfaceModel.ts`); a depth material
  // shows the frame's depth ramp in place of its colour (`beginFrame`).
  uniforms.i1(35, 'surfaceModel', mat.model ?? SURFACE_MODEL.standard);
  // A diagnostic view's surface is shown as it is, never through the fog
  // (`../../host/pageDiagnostics.ts`).
  uniforms.i1(38, 'fogFree', (material as { fog?: boolean }).fog === false ? 1 : 0);
  // Which faces turn their normal toward the eye: none, the back faces of a surface drawn from
  // behind, or both, whose normal map's tangents then turn with them.
  uniforms.i1(34, 'faceSides', doubleSided ? 2 : backSide ? 1 : 0);
  state.apply(material, doubleSided, backSide, polygonOffsetUnits);
}
