import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_GPU_TESTS = [
  'test/cisaillementTransform.browser.mjs',
  'test/coneEchelleNonUniforme.browser.mjs',
  'test/coupeGpuTenue.browser.mjs',
  'test/depthConventionMoteurComplet.browser.mjs',
  'test/gpuTextureWrap.browser.mjs',
  'test/hizCameraRig.browser.mjs',
  'test/imageTenueCouleur.browser.mjs',
  'test/inverseTransposeePetiteEchelle.browser.mjs',
  'test/normalTransformArithmetique.browser.mjs',
  'test/normaleEclairagePetiteEchelle.browser.mjs',
  'test/normaleEclairageSubstitutionsRefusees.browser.mjs',
  'test/reflexionFaceEliminee.browser.mjs',
  'test/setTransformParentPerime.browser.mjs',
  'test/transparentTransform.browser.mjs',
];

export function listJustesseTests(directory = 'test/justesse') {
  return readdirSync(directory)
    .filter((file) => file.includes('-') && file.endsWith('.mjs'))
    .sort()
    .map((file) => join(directory, file));
}

export function buildTestGpuArgs(cliArgs = [], justesseDir = 'test/justesse') {
  const flags = ['--experimental-strip-types', '--test', '--test-concurrency=1'];
  if (cliArgs.length > 0) {
    return [...flags, ...cliArgs];
  }
  return [...flags, ...listJustesseTests(justesseDir), ...BROWSER_GPU_TESTS];
}

export function runGpuTests(args = process.argv.slice(2)) {
  const fullArgs = buildTestGpuArgs(args);
  const result = spawnSync('node', fullArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runGpuTests();
}
