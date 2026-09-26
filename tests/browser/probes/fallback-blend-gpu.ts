// THE WEBGPU FALLBACK PASS, PUT ON SCREEN (#584).
//
// The fallback pass draws only when the device cannot build the visibility buffer, and no public
// option reaches that state. The page (`../support/fallbackBlendPage.ts`) mounts the real engine
// twice on one scene: on the device as it is (the main pass), then on a session handle of it that
// refuses the visibility target's pipelines. It publishes, for each blending mode, the tile read
// over a night half and a paper half on both images, the background beside it, and how many
// pixels the two images differ by: what the measurer compares. It fails when the second side did
// not fall back, or when a tile is missing from its image — the mode the pass once dropped.
//
//   node --experimental-strip-types tests/browser/probes/fallback-blend-gpu.ts
import assert from 'node:assert/strict';
import { preuveDansLaPage, type ResultatPagePreuve } from '../support/enginePageProof.ts';

type Lecture = {
  repli: boolean;
  fond: Record<string, number[]>;
  tuiles: Array<{ mode: string } & Record<string, number[]>>;
};

interface Resultat extends ResultatPagePreuve {
  adaptateur?: string;
  principal?: Lecture;
  repli?: Lecture;
  pixelsDifferents?: number;
}

const differe = (a: number[], b: number[]) => a.some((value, i) => Math.abs(value - b[i]) > 8);

if (import.meta.main) {
  const resultat = (await preuveDansLaPage(
    'fallbackBlendPage.ts',
    'fallbackBlend',
    'Fallback blend',
  )) as Resultat;
  const { evenements, ...lecture } = resultat;
  console.log(JSON.stringify(lecture, null, 1));
  assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
  assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
  assert.deepEqual(resultat.erreurs, []);
  const { principal, repli } = resultat;
  assert.ok(principal && repli, 'both images read');
  assert.equal(principal.repli, false, 'the main side kept its visibility buffer');
  assert.equal(repli.repli, true, 'the refusing side fell back');
  // The one failure the fallback side is built to cause; any other says the engine went wrong.
  const echecs = (evenements ?? []).filter((e) => /failed/.test(e.phase));
  assert.ok(
    echecs.every((e) => e.phase === 'material-pipeline-failed'),
    JSON.stringify(echecs),
  );
  for (const tuile of repli.tuiles)
    assert.ok(
      Object.keys(repli.fond).some((moitie) => differe(tuile[moitie], repli.fond[moitie])),
      `${tuile.mode}: the fallback image does not show the tile`,
    );
  console.log(`OK: the fallback pass draws the four modes — ${resultat.adaptateur}`);
}
