import { engineExampleCode } from '../engine-scene/code.js';
export function lessonCode(operation, { manifest, importedLights = true } = {}) {
  const stableCode = engineExampleCode.replace(
    'await explorer.awaitPages();\nif (!lifecycle.signal.aborted) invalidate();',
    'if (!lifecycle.signal.aborted) invalidate();',
  );
  return stableCode
    .replace(
      './assets/kinetic-garden/cache/native/full/manifest.json',
      manifest ?? './assets/kinetic-garden/cache/native/full/manifest.json',
    )
    .replace(
      "scope: 'full',",
      `scope: 'full',\n  importedLights: ${importedLights},\n  geometryPoolCeilingBytes: 64 * 1024 * 1024,`,
    )
    .replace(
      'controls = explorer.controls();',
      `await explorer.awaitPages();\nconst home = explorer.homePose();\nexplorer.setPose({ ...home, position: home.target.map((v, i) => v + (home.position[i] - v) * 1.25) });\n${operation}\ncontrols = explorer.controls();`,
    );
}
