import { visMaterial } from '../../visibility/shader/material.ts';
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
/** Units after the six material maps: the frozen backdrop colour, then its depth. */
export const BACKDROP_UNITS: [number, number] = [6, 7];

type Binding = {
  uniforms: WebglClusterMaterialUniforms;
  matrices: Matrix3UniformCache;
  textures: WebglClusterTextures;
  state: WebglClusterState;
};

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
  const { uniforms, matrices, textures, state } = binding;
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
  uniforms.i1(16, 'toneMapped', toneMapped && material.toneMapped ? 1 : 0);
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
  const doubleSided = side === undefined ? mat.doubleSided : false,
    backSide = side === undefined ? mat.backSide : side === 'back';
  state.apply(material, doubleSided, backSide, polygonOffsetUnits);
}
