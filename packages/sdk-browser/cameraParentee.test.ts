// Defect 5: a parented camera must give the same pose to ALL engine sites.
//
// Each site of `test/justesse/cameraSites.mjs` — selection uniforms, cut, Hi-Z, rasters,
// diagnostics, and the whole engines on the fake GPU device — is called frame after frame
// with a camera child of a host group that belongs to no prepared scene, then with the
// parentless camera of the same world pose bit for bit. The two samples must be equal.
//
// Both host contracts are exercised: the one that walks its rig before the frame and the one
// that does not. The engine must be correct in both cases, because an off-scene rig is walked
// by no one but it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from '../../test/justesse/cameraRig.mjs';
import { SITES, residuRepereDeRendu } from '../../test/justesse/cameraSites.mjs';

type Pose = (typeof POSES_PARENT)[number];
type Site = {
  nom: string;
  cree?: () => unknown;
  mesure: (etat: unknown, camera: unknown) => unknown;
};

/** A site played over the frame sequence, rendered as texts comparable character for character. */
async function releve(site: Site, camera: (pose: Pose) => unknown) {
  const etat = (await site.cree?.()) as
    { backend?: { dispose?: () => void }; dispose?: () => void } | undefined;
  const images: string[] = [];
  for (const pose of POSES_PARENT)
    images.push(JSON.stringify(await site.mesure(etat, camera(pose))));
  etat?.backend?.dispose?.();
  etat?.dispose?.();
  return images;
}

for (const hote of [false, true]) {
  const contrat = hote ? 'walked by the host' : 'left as-is by the host';
  for (const site of SITES as Site[])
    test(`${site.nom}: parented camera, rig ${contrat}`, async () => {
      const rig = creeRig();
      const parentee = await releve(site, (pose) => poseRig(rig, pose, hote));
      const aplatie = await releve(site, (pose) => cameraAplatie(pose));
      for (let i = 0; i < POSES_PARENT.length; i++)
        assert.equal(
          parentee[i],
          aplatie[i],
          `frame ${i}: the rig does not give the flattened pose`,
        );
    });

  test(`selection uniforms: relative view and render origin agree, rig ${contrat}`, () => {
    const rig = creeRig();
    for (const pose of POSES_PARENT)
      assert.ok(
        // The threshold is that of the single-precision rounding of a probe a few tens of
        // metres away; a wrong pose, for its part, is counted in metres.
        residuRepereDeRendu(poseRig(rig, pose, hote)) <= 1e-4,
        'the relative view and the render-frame origin describe two different cameras',
      );
  });
}
