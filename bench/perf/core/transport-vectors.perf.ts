// sdk-core vectors. Math.hypot(a, b, c) and transport scene validation.
import { length } from '../../../packages/sdk-core/src/lighting/scene/math.ts';
import { validateScene } from '../../../packages/sdk-core/src/lighting/transport/validation.ts';
import type {
  Patch,
  Scene,
  Vec3,
} from '../../../packages/sdk-core/src/lighting/scene/experimentScene.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import type { MesureCas } from '../../core/index.ts';
import { referenceLength, referenceValidateScene } from '../../oracles/core/transport-vectors.ts';
import { HOSTILE_FLOATS } from '../../../tests/kit/assert/hostile.ts';

const alea = graine(97);
const HOSTILES = [...HOSTILE_FLOATS, 1.7976931348623157e308, -1e-300];

const vecteurs: Vec3[] = [];
for (let i = 0; i < 20000; i++) vecteurs.push([alea() * 2 - 1, alea() * 1e6 - 5e5, alea() * 1e-8]);
const vecteursHostiles: Vec3[] = [];
for (const a of HOSTILES) for (const b of HOSTILES) vecteursHostiles.push([a, b, HOSTILES[0]]);
for (const a of HOSTILES) vecteursHostiles.push([a, a, a]);
vecteursHostiles.push([0, 0, 0], [-0, -0, -0]);

const longueurs = (liste: readonly Vec3[], fn: (v: Vec3) => number) => {
  const output = new Float64Array(liste.length);
  for (let i = 0; i < liste.length; i++) output[i] = fn(liste[i]);
  return output;
};

const casLongueur: MesureCas<Vec3[]>[] = [
  { name: '20 000 vecteurs', input: vecteurs, size: vecteurs.length },
  { name: 'hostiles', input: vecteursHostiles, size: vecteursHostiles.length },
  { name: 'no vectors', input: [], size: 0 },
];

const scene = (facettes: number, cassee: boolean): Scene => {
  const patches: Patch[] = [];
  for (let i = 0; i < facettes; i++) {
    const n: Vec3 = [alea() * 2 - 1, alea() * 2 - 1, alea() * 2 - 1];
    const norme = Math.hypot(n[0], n[1], n[2]) || 1;
    const unite: Vec3 =
      cassee && i === facettes - 1 ? n : [n[0] / norme, n[1] / norme, n[2] / norme];
    patches.push({
      id: i,
      surface: 0,
      center: [alea(), alea(), alea()],
      normal: unite,
      u: [1, 0, 0],
      v: [0, 1, 0],
      albedo: [alea(), alea(), alea()],
      emission: [alea(), 0, 0],
      area: 0.5 + alea(),
    });
  }
  return {
    surfaces: [
      {
        id: 'surface-0',
        origin: [0, 0, 0],
        u: [1, 0, 0],
        v: [0, 1, 0],
        albedo: [1, 1, 1],
        emission: [0, 0, 0],
        kind: 'diffuse',
        moving: false,
        columns: facettes,
        rows: 1,
      },
    ],
    patches,
  };
};
const scenes = [scene(8000, false), scene(1, false), scene(64, true)];
const passeScene = (fn: (scene: Scene) => void) => (liste: readonly Scene[]) =>
  liste.map((item) => {
    try {
      fn(item);
      return 'ok';
    } catch (erreur) {
      return erreur instanceof Error ? erreur.message : String(erreur);
    }
  });

const resLongueur = await mesure({
  name: 'Vec3 length',
  fichier: 'packages/sdk-core/src/lighting/scene/math.ts',
  cas: casLongueur,
  calcul: (liste: Vec3[]) => longueurs(liste, length),
  attendu: (liste: Vec3[]) => longueurs(liste, referenceLength),
  options: { tours: 100, budgetMs: 1500 },
});

const resScene = await mesure({
  name: 'transport scene normals',
  fichier: 'packages/sdk-core/src/lighting/transport/validation.ts',
  cas: [
    { name: '8 000 patches', input: scenes, size: 8065 },
    { name: 'no scene', input: [], size: 0 },
  ],
  calcul: passeScene(validateScene),
  attendu: passeScene(referenceValidateScene),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'length extremes',
  calcul: length,
  extremes: [
    { name: 'NaN', input: [NaN, 0, 0] },
    { name: 'Infinity', input: [Infinity, -Infinity, 0] },
    { name: 'zeros', input: [-0, 0, -0] },
  ],
});

rapport(
  'vecteurs-transport',
  [resLongueur, resScene],
  'F20 yields the same lengths and rejections',
);
