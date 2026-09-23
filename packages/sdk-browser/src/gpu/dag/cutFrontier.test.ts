// What descent rereads each frame, and what a persistent selection could keep of it.
//
// A cut kept from one frame to the next can only save INTERNAL nodes: the frontier —
// where descent stops — must be re-examined each frame, each node's screen error
// changing as soon as the camera moves. The only other work it would avoid is testing
// the parent of a REJECTED node, the only case where the cut can close: a kept node
// always has a kept parent, both rejects being monotonic downward.
//
// This file measures both shares, on four regimes including the two unfavourable ones
// persistence must face: the camera jump and the animated scene.
//
// It also measures the OTHER half of the problem, which persistence does not touch:
// top-down reject. The replacement error ceiling only drops a too-fine subtree; the
// own-error floor, which packing derives from the pages and stores in the node, also drops the too-
// coarse — nothing from the compiler, nothing from the format.
import test from 'node:test';
import { asHostLibrary } from '../../host/resources.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packDagSelection, packedWorldsToRenderOrigin } from './pack.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { descenteComptee } from './cutFrontier.fixture.ts';
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts';

const pages = scenePages(16384, 8);
/**
 * Two hierarchies, because top-down reject is not the same on both: the one packing
 * gives a primitive without a manifest (`flatHierarchy`, page slices in array order)
 * and the one the compiler produces (`build_culling_bvh`, one node per detail level
 * under the root). The second is PURE PER LEVEL, the first is not.
 */
function montage(parNiveaux: boolean) {
  const roots = sceneRoots(
    pages,
    Array.from({ length: 12 }, () => new THREE.Matrix4()),
    parNiveaux,
  );
  // Packing derives page bounds and stores the floor in the node
  // (`packNodes.ts`): counted descent reads it where the GPU reads it, not beside it.
  return { roots, packed: packDagSelection(roots) };
}
const MONTAGES = [
  ['packing hierarchy', montage(false)],
  ['compiler hierarchy (one node per level)', montage(true)],
] as const;
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

/** One frame: camera set, world matrices rebased on the eye, then counted descent. */
function image(
  m: (typeof MONTAGES)[number][1],
  x: number,
  z: number,
  deplacement: number,
  plancher: boolean,
) {
  const { roots, packed } = m;
  for (let w = 0; w < roots.length; w++)
    asHostLibrary<THREE.Matrix4>(roots[w].world).makeTranslation(
      (w % 4) * 6.5 - 9.75 + deplacement,
      Math.floor(w / 4) * 6.5 - 6.5,
      0,
    );
  cam.position.set(x, 0, z);
  cam.lookAt(x, 0, 0);
  cam.updateMatrixWorld();
  const uniforms = cameraSelectionUniforms(cameraMoteur(cam), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
  return descenteComptee(packed, uniforms, plancher);
}

type Poser = (
  m: (typeof MONTAGES)[number][1],
  i: number,
  plancher: boolean,
) => ReturnType<typeof image>;
const REGIMES: Array<[string, Poser]> = [
  ['pose immobile', (m, _i, b) => image(m, 0, 16, 0, b)],
  ['sliding camera', (m, i, b) => image(m, i * 0.25, 16, 0, b)],
  ['camera jump', (m, i, b) => image(m, (i % 2 ? 1 : -1) * 9, i % 2 ? 40 : 14, 0, b)],
  ['animated scene', (m, i, b) => image(m, 0, 16, (i % 5) * 0.4, b)],
];

test('the descent frontier is what no exact persistence can save', () => {
  const lignes = MONTAGES.flatMap(([hierarchie, m]) =>
    REGIMES.map(([nom, poser]) => {
      let visites = 0,
        internes = 0,
        feuilles = 0,
        rejetees = 0,
        candidats = 0,
        plancherCoupe = 0,
        candidatsAvecPlancher = 0,
        tropGrossieres = 0;
      for (let i = 0; i < 8; i++) {
        const compte = poser(m, i, false);
        visites += compte.visites;
        internes += compte.internes;
        feuilles += compte.frontiereFeuilles;
        rejetees += compte.frontiereRejetees;
        candidats += compte.candidats;
        tropGrossieres += compte.tropGrossieres;
        // Same frame, same camera, with top-down reject: that is the ONLY difference.
        const avec = poser(m, i, true);
        plancherCoupe += avec.plancherCoupe;
        candidatsAvecPlancher += avec.candidats;
      }
      const frontiere = feuilles + rejetees;
      assert.equal(visites, internes + frontiere, 'a visited node is internal or on the frontier');
      assert.ok(candidats > 0, `${nom} must see geometry`);
      return {
        hierarchie,
        regime: nom,
        visitesParImage: visites / 8,
        frontiereParImage: frontiere / 8,
        internesParImage: internes / 8,
        candidatsParImage: candidats / 8,
        // Cap of an exact persistence: internals, plus the parent test of a rejected node,
        // one per sibling group of eight. Relative to everything the frame rereads, nodes
        // and candidate clusters.
        plafondPourCent: Number(
          ((100 * (internes + rejetees / 8)) / (visites + candidats)).toFixed(2),
        ),
        // TOP-DOWN reject, the one the CPU cut already applies: nodes whose subtree
        // has no cluster fine enough, and the candidates they carry.
        plancherNoeudsParImage: plancherCoupe / 8,
        candidatesRetireesParImage: (candidats - candidatsAvecPlancher) / 8,
        candidatesTropGrossieresParImage: tropGrossieres / 8,
        partDuVisePourCent: Number(
          ((100 * (candidats - candidatsAvecPlancher)) / Math.max(1, tropGrossieres)).toFixed(1),
        ),
        candidatesRestantesPourCent: Number(
          (100 * (candidatsAvecPlancher / Math.max(1, candidats))).toFixed(1),
        ),
      };
    }),
  );
  console.log(
    JSON.stringify(
      {
        pages: MONTAGES[0][1].packed.pageCount,
        noeuds: MONTAGES.map(([nom, m]) => `${nom} : ${m.packed.nodeCount}`),
        lignes,
      },
      null,
      2,
    ),
  );
  for (const ligne of lignes) {
    // The frontier is almost all of descent: in an eight-child tree internals are about
    // a seventh of what they carry, a bit more near the root where nodes are not full.
    // What the threshold holds is the order of magnitude: never a sixth.
    assert.ok(
      ligne.internesParImage * 6 <= ligne.frontiereParImage,
      `${ligne.regime}: internals ${ligne.internesParImage} for a frontier of ${ligne.frontiereParImage}`,
    );
    assert.ok(ligne.plafondPourCent < 5, `${ligne.regime}: ceiling ${ligne.plafondPourCent} %`);
    // Top-down reject is SAFE: it never drops anything but a candidate that is actually too coarse.
    assert.ok(
      ligne.candidatesRetireesParImage <= ligne.candidatesTropGrossieresParImage,
      `${ligne.regime}: ${ligne.candidatesRetireesParImage} dropped for ${ligne.candidatesTropGrossieresParImage} too coarse`,
    );
    // And it HOLDS, on every pose. The threshold is there so a reject that would stop
    // happening fails loudly: that is how a bound indexed on the wrong pose slipped in
    // here — it raised nothing, it returned zero for eleven poses out of twelve, and the
    // published share was a sixth of the true one.
    assert.ok(
      ligne.partDuVisePourCent > 50,
      `${ligne.regime}: the floor only drops ${ligne.partDuVisePourCent} % of its target`,
    );
  }
});
