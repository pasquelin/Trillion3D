import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metafile } from 'esbuild';

export interface InstalledTools {
  node: string;
  pnpm: string;
  typescript: string;
  esbuild: string;
}

export interface InstalledEvidenceInput {
  fixture: string;
  packageName: string;
  packed: { files?: { path: string }[] };
  tools: InstalledTools;
  compilerVersion: string | null;
  browserProof: { browserVersion: string } | null;
  proveNative: boolean;
  proveBrowser: boolean;
}

export interface InstalledEvidenceReport {
  tools: InstalledTools & { compiler: string | null; chrome: string | null };
  settings: { types: string; bundles: string; native: string | null; browser: string | null };
  files: { path: string; size: number }[];
}

export function installedEvidence({
  fixture,
  packageName,
  packed,
  tools,
  compilerVersion,
  browserProof,
  proveNative,
  proveBrowser,
}: InstalledEvidenceInput): InstalledEvidenceReport {
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

export interface EvidenceSummaryInput {
  package: string;
  commit: string;
  tools: InstalledTools & { compiler: string | null; chrome: string | null };
  bundles: Record<string, Metafile>;
  files: { path: string; size: number }[];
}

export function evidenceSummary(evidence: EvidenceSummaryInput): string {
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
