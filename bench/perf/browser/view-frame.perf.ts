import { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import { asHostLibrary, type HostMesh } from '../../../packages/sdk-browser/src/host/resources.ts';
import { surfaceColorAttachments } from '../../../packages/sdk-browser/src/webgpu/pages/prepare/attachments.ts';
import { anneauFroid } from '../../../packages/sdk-browser/src/world/render/draw.ts';
import { deplaceInstance } from '../../../packages/sdk-browser/src/backend/autonomous/instancePose.ts';
import { createPageDraws } from '../../../packages/sdk-browser/src/backend/autonomous/pageDraws.ts';
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts';
import type {
  PageRec,
  ClusterRoot,
} from '../../../packages/sdk-browser/src/page/selection/types.ts';
import { mesure, stress, rapport } from '../../core/index.ts';
import {
  referenceAnneauFroid,
  referenceAttachments,
  referenceUpdateInstance,
} from '../../oracles/browser/view-frame.ts';
import { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts';
const DUMMY_TEXTURE = {} as GPUTexture;
const buildSurfaces = (): SurfaceBuffer => {
  const liste: GPUTextureView[] = [0, 1, 2, 3].map(() => ({}) as GPUTextureView);
  return {
    version: 1,
    width: 1,
    height: 1,
    allocationBytes: 0,
    baseMetal: DUMMY_TEXTURE,
    normalRough: DUMMY_TEXTURE,
    emissiveAo: DUMMY_TEXTURE,
    flags: DUMMY_TEXTURE,
    subsurface: DUMMY_TEXTURE,
    subsurfaceView: {} as GPUTextureView,
    hasSubsurface: false,
    views: () => liste,
    dispose: () => {},
  };
};
const petite = buildSurfaces(),
  grande = buildSurfaces();
const liberee: SurfaceBuffer = {
  ...buildSurfaces(),
  views: () => {
    throw new Error('SURFACE_DISPOSED');
  },
};
const passeAttachments =
  (fn: (surfaces: SurfaceBuffer) => GPURenderPassColorAttachment[]) => (input: SurfaceBuffer[]) => {
    const output: unknown[] = [];
    for (const cible of input) {
      try {
        output.push(
          fn(cible).map((item) => ({ ...item, clearValue: [...(item.clearValue as number[])] })),
        );
      } catch (erreur) {
        output.push(erreur instanceof Error ? erreur.message : String(erreur));
      }
    }
    return output;
  };

const imagesSurfaces: SurfaceBuffer[] = [];
for (let i = 0; i < 2000; i++) imagesSurfaces.push(petite);
const redimensionnee = [petite, petite, grande, grande, petite, liberee, grande];

const DUMMY_ATTRIBUTES: G.Geometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
const emptyMesh = () => new Mesh(new Geometry(), []);
/** A record with the world the oracle reads on it, and the draw state it carried before #1234. */
type Page = PageRec & { matrix: G.Matrix4; mesh?: HostMesh; attached: boolean };
const pageOf = (matrix: G.Matrix4, mesh?: HostMesh): Page => ({
  ...{ id: 0, url: '', clusterId: '', triangles: 0, indexBytes: 0, depthLayer: 0 },
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  attributes: DUMMY_ATTRIBUTES,
  material: surfaceOf([]),
  declaration: [],
  matrix,
  renderOrder: 0,
  attached: true,
  mesh,
});
const instanceDe = (pages: number) => {
  const basePages: Page[] = [],
    baseRoots: ClusterRoot<PageRec>[] = [],
    clones: Page[] = [],
    roots: ClusterRoot<PageRec>[] = [];
  for (let i = 0; i < 10; i++) {
    baseRoots.push({ world: new G.Matrix4().makeScale(1 + i, 2, 3), pages: [] });
    roots.push({ world: new G.Matrix4(), pages: [] });
  }
  // Page `i` is placed by root `i % 10`: its mesh moves with that root (`deplaceInstance`).
  for (let i = 0; i < pages; i++) {
    basePages.push(pageOf(new G.Matrix4().makeScale(1 + (i % 10), 2, 3)));
    clones.push(pageOf(new G.Matrix4(), i % 3 ? emptyMesh() : undefined));
    roots[i % 10].pages.push(clones[i]);
  }
  const draws = createPageDraws(roots);
  for (const rec of clones) draws.drawing(rec).mesh = rec.mesh;
  return { basePages, baseRoots, instance: { pages: clones, bases: basePages, roots, draws } };
};
const petiteInstance = instanceDe(100),
  grosseInstance = instanceDe(5000);
const transformation = new G.Matrix4()
  .makeRotationY(0.7)
  .multiply(new G.Matrix4().makeTranslation(3, -1, 2));

type Instance = ReturnType<typeof instanceDe>;

const passeInstance =
  (
    fn: (
      instance: Instance['instance'],
      basePages: Page[],
      baseRoots: ClusterRoot<PageRec>[],
      transform: Float64Array,
    ) => void,
  ) =>
  (input: Instance) => {
    const { basePages, baseRoots, instance } = input;
    fn(instance, basePages, baseRoots, new Float64Array(transformation.elements));
    const output: number[] = [];
    for (const rec of instance.pages) output.push(...(rec.mesh?.matrix.elements ?? []));
    for (const root of instance.roots) output.push(...Array.from(root.world.elements));
    return Float64Array.from(output);
  };

const anneau: string[] = [];
for (let i = 0; i < 10000; i++) anneau.push(`bundle/${i}`);
const tenues = new Set(anneau.filter((_, i) => i % 30 !== 0));
const streamer = {
  has: (url: string) => tenues.has(url),
  loading: () => false,
  failed: (url: string) => url.endsWith('7777'),
};

const resAttachments = await mesure({
  name: 'surface attachments',
  fichier: 'packages/sdk-browser/src/webgpu/pages/render/encodeVisSetup.ts',
  cas: [
    { name: '2 000 frames without resize', input: imagesSurfaces, size: 2000 },
    { name: 'resizes and a disposed target', input: redimensionnee, size: 7 },
  ],
  calcul: passeAttachments(surfaceColorAttachments),
  attendu: passeAttachments(referenceAttachments),
  options: { tours: 100, budgetMs: 1500 },
});

const resInstance = await mesure({
  name: 'instance displacement',
  fichier: 'packages/sdk-browser/src/backend/autonomous/instancePose.ts',
  cas: [
    { name: '5 000 pages', input: grosseInstance, size: 5000 },
    { name: '100 pages', input: petiteInstance, size: 100 },
  ],
  calcul: passeInstance((inst, _b, r, t) => deplaceInstance(inst, r, t, inst.draws)),
  attendu: passeInstance((inst, bases, racines, t) =>
    referenceUpdateInstance(
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[0]>(inst),
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[1]>(bases),
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[2]>(racines),
      asHostLibrary<G.Matrix4>(t),
    ),
  ),
  options: { tours: 100, budgetMs: 1500 },
});

const resAnneau = await mesure({
  name: 'view-frame ring',
  fichier: 'packages/sdk-browser/src/world/render/draw.ts',
  cas: [
    {
      name: '10 000 addresses, batch of 64',
      input: { ring: anneau, streamer, limite: 64 },
      size: 10000,
    },
  ],
  calcul: (e: { ring: string[]; streamer: typeof streamer; limite: number }) =>
    anneauFroid(e.ring, e.streamer, e.limite),
  attendu: (e: { ring: string[]; streamer: typeof streamer; limite: number }) =>
    referenceAnneauFroid(e.ring, e.streamer, e.limite),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'anneauFroid extremes',
  calcul: (lim: number) => anneauFroid([], streamer, lim),
  extremes: [
    { name: '0 limite', input: 0 },
    { name: 'negative limite', input: -1 },
  ],
});

rapport(
  'cadre-vue',
  [resAttachments, resInstance, resAnneau],
  'F10, F12 and F13 yield the exact same descriptors, matrices and lists',
);
