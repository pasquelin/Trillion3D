// Performance bench: transform hierarchy and camera (sdk-core against Three.js).
// Real `Object3D` and camera chains, replayed operation by operation on both sides —
// hostile frozen chains, non-finite values, a live scene that moves frame after frame, `lookAt`
// and degenerate projections. A single bit of delta and the bench fails.
import { compare, rapport } from '../../core/index.ts';
import type { MesureCas } from '../../core/index.ts';
import { joueNous } from './support/hierarchyReplayEngine.ts';
import { joueThree } from './support/hierarchyReplayThree.ts';
import { chainesFigees } from './support/hierarchyScenarios.ts';
import type { HierarchyOp } from './support/hierarchyScenarios.ts';
import { objectifs, visees } from './support/hierarchyScenariosCamera.ts';
import { marquages, liveScenario } from './support/hierarchyScenariosLive.ts';

const options = { chauffe: 1, tours: 3, budgetMs: 500 };
/** One case: a scenario whose size is the number of replayed operations. */
const cas = (name: string, scenario: HierarchyOp[]): MesureCas<HierarchyOp[]> => ({
  name,
  input: scenario,
  size: scenario.length,
});
const ligne = (name: string, fichier: string, liste: MesureCas<HierarchyOp[]>[]) => ({
  name,
  fichier,
  cas: liste,
  reference: joueThree,
  optimisee: joueNous,
  options,
});

const lignes = [
  ligne(
    'frozen hierarchy: update, world reads, frames',
    'packages/sdk-core/src/math/transform-tree/update.ts',
    [
      cas('finite hostile hierarchy chains', chainesFigees(false)),
      cas('hostile hierarchy chains with NaN and infinities', chainesFigees(true)),
    ],
  ),
  ligne(
    'live hierarchy: poses, reparenting, removals, partial updates',
    'packages/sdk-core/src/math/transform-tree/structure.ts',
    [
      cas('ordinary live hierarchy scene', liveScenario(160, 240, 1e9)),
      cas('hostile live hierarchy scene', liveScenario(90, 160, 12)),
      cas('hierarchy marking rules', marquages()),
    ],
  ),
  ligne(
    'camera and object lookAt, hierarchies included',
    'packages/sdk-core/src/math/transform-tree/lookAt.ts',
    [cas('hierarchical aims', visees())],
  ),
  ligne('camera projections and frames', 'packages/sdk-core/src/math/primitives/camera.ts', [
    cas('lenses', objectifs()),
  ]),
];

const equivalence = [];
for (const l of lignes) equivalence.push(await compare(l));

rapport(
  'hierarchie',
  equivalence,
  'the sdk-core hierarchy and camera yield exactly what Three.js yields',
);
