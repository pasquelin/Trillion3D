// The scene the material API tests open: five table materials worn by six surfaces, and one
// engine that lists its refreshes and the alpha change each one carried.
import type { TableMaterial, TableTextureSlot } from '../../../../sdk-core/src/index.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { preparedMaterials } from '../../host/prepared/materials.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { AlphaChange } from '../../placement/backendSceneUpdates.ts';
import { createExplorerMaterialApi } from './materialApi.ts';
import { webgpuMaterialClassRefusal } from '../../webgpu/pages/io/refreshMaterials.ts';

const slot = (texture: number): TableTextureSlot => ({
  texture,
  texCoord: 0,
  slotTexCoord: 0,
  transform: null,
});

export const entry = (overrides: Partial<TableMaterial>): TableMaterial => ({
  name: 'surface',
  derivativeTangents: false,
  kind: 'standard',
  alphaMode: 'OPAQUE',
  opacity: 1,
  extensions: {},
  lit: true,
  doubleSided: false,
  backSide: false,
  metalness: 0,
  roughness: 1,
  alphaTest: 0.5,
  normalScale: 1,
  normalScaleY: 1,
  aoIntensity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
  baseColor: [1, 1, 1],
  emissive: [0, 0, 0],
  attenuationColor: [1, 1, 1],
  map: null,
  metalnessMap: null,
  roughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
  ...overrides,
});

/** Rank 0 opaque with its own map, worn in two geometry variants; rank 1 masked; ranks 2 and 3
 *  share one map; rank 4 blended. */
export async function scene(refresh = true, materialClassRefusal = webgpuMaterialClassRefusal) {
  const textures = [new G.GraphTexture(), new G.GraphTexture()];
  const materialOf = preparedMaterials(
    [
      entry({ name: 'floor', map: slot(0), baseColor: [0.5, 0.5, 0.5] }),
      entry({ name: 'leaves', alphaMode: 'MASK' }),
      entry({ name: 'left', map: slot(1) }),
      entry({ name: 'right', map: slot(1) }),
      entry({ name: 'glass', alphaMode: 'BLEND', opacity: 0.25 }),
    ],
    async (from) => textures[from.texture],
  );
  const plain = { vertexColors: false, flatShading: false };
  const source = new G.Group();
  const floor = [await materialOf(0, plain), await materialOf(0, { ...plain, vertexColors: true })];
  for (const surface of [
    ...floor,
    ...(await Promise.all([1, 2, 3, 4].map((r) => materialOf(r, plain)))),
  ])
    source.add(G.mesh(undefined, surface));
  // One entry per refresh: the alpha change it carried, `undefined` for values alone.
  const refreshes: (AlphaChange | undefined)[] = [];
  const backend = {
    id: 'webgpu-page-raster',
    materialClassRefusal,
    ...(refresh && {
      refreshMaterials: (_: boolean, alpha?: AlphaChange) => void refreshes.push(alpha),
    }),
  } as unknown as RenderBackend;
  const api = createExplorerMaterialApi({
    check: () => {},
    source,
    backends: [backend],
    active: () => backend,
  });
  return { api, floor, textures, refreshes };
}

export const refusal = (code: string) => (error: unknown) =>
  (error as { code?: string }).code === code;
