import { statSync } from 'node:fs';
import { join } from 'node:path';

export function installedEvidence({
  fixture,
  packageName,
  packed,
  tools,
  compilerVersion,
  browserProof,
  proveNative,
  proveBrowser,
}) {
  const installedPackage = join(fixture, 'node_modules', packageName);
  return {
    tools: { ...tools, compiler: compilerVersion, chrome: browserProof?.browserVersion ?? null },
    settings: {
      types: 'strict, ES2023; neutral Bundler, browser Bundler, NodeNext',
      bundles: 'ESM; neutral fallback and browser platform',
      native: proveNative ? 'slice, 150000 triangles, 256 MiB, simplification none' : null,
      browser: proveBrowser ? 'headless Chrome, 480x320' : null,
    },
    files:
      packed.files?.map(({ path }) => ({
        path,
        size: statSync(join(installedPackage, path)).size,
      })) ?? [],
  };
}

export function evidenceSummary(evidence) {
  const bundleBytes = Object.fromEntries(
    Object.entries(evidence.bundles).map(([name, meta]) => {
      const output = Object.entries(meta.outputs).find(
        ([path]) => path === `${name}.js` || path.endsWith(`/${name}.js`),
      );
      return [name, output?.[1].bytes ?? null];
    }),
  );
  return JSON.stringify({
    package: evidence.package,
    commit: evidence.commit,
    tools: evidence.tools,
    fileCount: evidence.files.length,
    bundleBytes,
  });
}
