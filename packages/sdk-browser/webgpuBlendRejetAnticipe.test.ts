import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { BLEND_SHADER } from './webgpuBlendShader.ts';

/**
 * Le rejet anticipé de profondeur de la passe de mélange, gardé par son étage de fragments.
 *
 * Sur un processeur graphique à tuiles, un étage de fragments qui peut écrire en mémoire doit être
 * exécuté avant le test de profondeur — l'effet de bord doit avoir lieu même pour un fragment que la
 * profondeur jette. La passe de mélange dessine des milliers d'appels entièrement cachés derrière
 * l'opaque : les laisser s'ombrer coûtait 44 ms au lieu de 21, et 22 ms de présentation au lieu de
 * 0,7 (vue `rue`, caméra mobile, image identique au pixel près).
 *
 * Ce que ce test garde n'est donc pas une ligne, c'est une propriété de l'étage : aucune écriture,
 * d'aucune sorte, ni dans le nuanceur ni dans la disposition qu'il déclare. Le `discard` de
 * l'alpha-test, lui, reste : mesuré à part, le retirer des deux chemins ne rend que 0,4 ms sur
 * 21 — dans le bruit du témoin A/A de la même campagne. Il n'empêche pas le rejet anticipé quand la
 * profondeur n'est pas écrite, et une variante de pipeline pour l'éviter serait du code sans gain.
 */
test("l'étage de fragments du mélange n'écrit rien en mémoire", () => {
  const fragment = BLEND_SHADER.slice(BLEND_SHADER.indexOf('@fragment fn fs('));
  assert.ok(fragment.length > 0, 'le module porte bien un étage de fragments');
  for (const interdit of [/textureStore/, /atomic/, /@builtin\(frag_depth\)/]) {
    assert.doesNotMatch(fragment, interdit, `${interdit} interdit dans l'étage de fragments`);
  }
  // Aucune liaison de stockage accessible en écriture, où qu'elle soit déclarée : c'est la
  // déclaration, pas l'usage, que le pilote lit pour décider du rejet anticipé.
  assert.doesNotMatch(BLEND_SHADER, /var<storage,\s*read_write>/);
  assert.match(BLEND_SHADER, /var<storage,read> proxy:/, 'le proxy reste lu, le rayon est tiré');
});

test('la disposition du mélange ne déclare aucun tampon de stockage inscriptible', async () => {
  installGpuGlobals();
  const device = {
    createBindGroupLayout: (descriptor: unknown) => descriptor,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createShaderModule: () => ({}),
  } as unknown as GPUDevice;
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const entries = (blendBindGroupLayout as unknown as { entries: GPUBindGroupLayoutEntry[] })
    .entries;
  const inscriptibles = entries.filter(
    (entry) =>
      (entry.visibility & GPUShaderStage.FRAGMENT) !== 0 && entry.buffer?.type === 'storage',
  );
  assert.deepEqual(inscriptibles, [], 'une seule suffirait à coûter le rejet anticipé');
  // Le proxy y est bien, et en lecture seule : la surface lointaine garde son ombre de soleil.
  assert.ok(
    entries.some((entry) => entry.buffer?.type === 'read-only-storage'),
    'les tampons de stockage du mélange sont tous lus',
  );
});
