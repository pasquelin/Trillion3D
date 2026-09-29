// The fixtures of the blended casters' rows (#35): a catalogue of one opaque and one blended
// triangle, and the row table mounted over it.
import * as G from '../../host/graph/graph.fixture.ts';
import { blendFixture } from '../../page/selection/blend.fixture.ts';
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import { collectClusterPages, type PageRec } from '../../page/selection/selection.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { createPageRowWriter } from './pageRow.ts';
import { createBlendCasterRows } from './blendCasters.ts';
import { createWebgpuRowState } from './state.ts';

export const STRIDE = PAGE_INFO_STRIDE / 4;
/** One level-0 root cluster, the blend fixture's first, at the address `url`. */
const [template] = blendFixture().metadata.primitives[0].pages;
const cluster = (url: string) => ({ ...template, url, sha256: url });

/** One opaque triangle, then one blended at `opacity`, which asks for its shadow unless
 *  `transparentShadow` is false: the catalogue pages, placed. */
export function catalogue(opacity: number, blended = true, transparentShadow = true) {
  const source = new G.Group(),
    associations = new Map<G.Object3D, { meshes: number; primitives: number }>();
  const materials = [
    G.standardSurface(),
    G.standardSurface({ transparent: blended, opacity: blended ? opacity : 1, transparentShadow }),
  ];
  const primitives = materials.map((material, index) => {
    const geometry = new G.Geometry();
    geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3));
    geometry.setIndex(G.indices([0, 1, 2]));
    const mesh = G.mesh(geometry, material);
    source.add(mesh);
    associations.set(mesh, { meshes: index, primitives: 0 });
    const pass = blended && index ? 'clustered-blend' : 'exact-clusters';
    const structure = { version: 1, roots: [0], groups: [] };
    return { mesh: index, primitive: 0, pass, pages: [cluster(`p${index}`)], structure };
  });
  source.updateMatrixWorld(true);
  const metadata = { primitives } as unknown as ClusterManifest;
  const indices = new Map(primitives.map((_, i) => [`p${i}`, Uint32Array.of(0, 1, 2)] as const));
  const collected = collectClusterPages(source, metadata, indices, associations);
  const pages = collected.allPages.map((rec, i) => Object.assign(rec, { placementIndex: i }));
  return Object.assign(pages, { glass: materials[1] });
}

/** The row table over `pages` with `blendSlots` shadow-only rows, both pages resident. */
export function mount(pages: PageRec[], blendSlots: number) {
  const rows = createWebgpuRowState(pages, 1, blendSlots);
  rows.pageTableFloats = new Float32Array(rows.casterSlots * STRIDE);
  rows.pageTableInts = new Uint32Array(rows.pageTableFloats.buffer);
  const geometryBlock = { vertexBase: 0, count: 3, hasUv: false, hasNormal: false };
  const writer = createPageRowWriter(
    {
      geometryBlocks: new Map(pages.map((p) => [p.attributes, { ...geometryBlock }] as const)),
      mapLayer: new Map(),
      dataLayer: new Map(),
      asIsShown: false,
    } as never,
    rows.markRowDirty,
    // The catalogue's meshes sit at the origin: every page's root is placed at the identity.
    pages.map(() => ({ world: new G.Matrix4() })),
  );
  pages.forEach((_, page) => {
    rows.pagePositions[page] = {} as GPUBuffer;
    rows.residentOffsetWords[page] = page * 16;
    rows.touchPage(page);
  });
  const pins: Array<[number, number]> = [];
  const map = { pin: (page: number, row: number) => pins.push([page, row]) };
  const restaled: PageRec[] = [];
  const casters = createBlendCasterRows(rows, pages, writer, (rec) => restaled.push(rec));
  return { rows, writer, casters, map, pins, restaled };
}
