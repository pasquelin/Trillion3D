// what a frame used to rebuild for no reason.
import * as THREE from 'three';
import { surfaceOf } from '../pageSurface.ts';
import { asHostLibrary } from '../hostResources.ts';
import { surfaceColorAttachments } from '../webgpuPagesAttachments.ts';
import { anneauFroid } from '../explorerDraw.ts';
import { deplaceInstance } from '../autonomousInstances.ts';
import type { SurfaceBuffer } from '../surfaceBuffer.ts';
import type { PageRec, ClusterRoot } from '../pageSelectionTypes.ts';
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.ts';
import {
  referenceAnneauFroid,
  referenceAttachments,
  referenceUpdateInstance,
} from './oracles/cadre-vue.ts';

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

/** Fields the instance displacement never reads: shared across every fixture record/root. */
const DUMMY_ATTRIBUTES: THREE.BufferGeometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
const pageOf = (matrix: THREE.Matrix4, mesh?: THREE.Mesh): PageRec => ({
  id: 0,
  url: '',
  clusterId: '',
  triangles: 0,
  indexBytes: 0,
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  depthLayer: 0,
  attributes: DUMMY_ATTRIBUTES,
  material: surfaceOf([]),
  declaration: [],
  matrix,
  renderOrder: 0,
  attached: true,
  mesh,
});

const instanceDe = (pages: number) => {
  const basePages: PageRec[] = [],
    baseRoots: ClusterRoot<PageRec>[] = [],
    clones: PageRec[] = [],
    racines: ClusterRoot<PageRec>[] = [];
  for (let i = 0; i < pages; i++) {
    basePages.push(pageOf(new THREE.Matrix4().makeTranslation(i, i * 2, i * 3)));
    clones.push(pageOf(new THREE.Matrix4(), i % 3 ? new THREE.Mesh() : undefined));
  }
  for (let i = 0; i < 10; i++) {
    baseRoots.push({ world: new THREE.Matrix4().makeScale(1 + i, 2, 3), pages: [] });
    racines.push({ world: new THREE.Matrix4(), pages: [] });
  }
  return { basePages, baseRoots, instance: { pages: clones, bases: basePages, roots: racines } };
};
const petiteInstance = instanceDe(100),
  grosseInstance = instanceDe(5000);
const transformation = new THREE.Matrix4()
  .makeRotationY(0.7)
  .multiply(new THREE.Matrix4().makeTranslation(3, -1, 2));

type Instance = ReturnType<typeof instanceDe>;

const passeInstance =
  (
    fn: (
      instance: Instance['instance'],
      basePages: PageRec[],
      baseRoots: ClusterRoot<PageRec>[],
      transform: Float64Array,
    ) => void,
  ) =>
  (input: Instance) => {
    const { basePages, baseRoots, instance } = input;
    fn(instance, basePages, baseRoots, transformation.toArray(new Float64Array(16)));
    const output: number[] = [];
    for (const rec of instance.pages)
      output.push(
        ...Array.from(rec.matrix.elements),
        ...Array.from(asHostLibrary<THREE.Mesh | undefined>(rec.mesh)?.matrix.elements ?? []),
      );
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
  fichier: 'packages/sdk-browser/webgpuPagesEncodeVisSetup.ts',
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
  fichier: 'packages/sdk-browser/autonomousInstances.ts',
  cas: [
    { name: '5 000 pages', input: grosseInstance, size: 5000 },
    { name: '100 pages', input: petiteInstance, size: 100 },
  ],
  calcul: passeInstance((inst, _bases, racines, t) => deplaceInstance(inst, racines, t)),
  attendu: passeInstance((inst, bases, racines, t) =>
    referenceUpdateInstance(
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[0]>(inst),
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[1]>(bases),
      asHostLibrary<Parameters<typeof referenceUpdateInstance>[2]>(racines),
      asHostLibrary<THREE.Matrix4>(t),
    ),
  ),
  options: { tours: 100, budgetMs: 1500 },
});

const resAnneau = await mesure({
  name: 'view-frame ring',
  fichier: 'packages/sdk-browser/explorerDraw.ts',
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
