/**
 * The npm release of `trillion3d` and its five compiler packages (#1354), in the steps the
 * `Release` workflow runs: `packRelease` stages the compilers the `Compiler` workflow built and packs
 * the six packages at one version; `publishRelease` refuses an incomplete or already published
 * release, dry-runs the six publications, and only then, when asked, publishes them.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  COMPILER_PLATFORMS,
  compilerFileName,
  compilerPackage,
} from '../packages/sdk-node/src/compiler/platform.mts';
import type { Run } from './installed-package-contracts.ts';
import { packArchive, type PackResult } from './installed-package-fixture.ts';

/** One packed package: its name, its archive and the files `pnpm pack` put in it. */
export interface ReleaseArchive {
  name: string;
  filename: string;
  files: { path: string }[];
}

/** A packed release, as `release.json` records it beside its archives. */
export interface Release {
  version: string;
  /** Packed without `private`, so npm accepts the real publication; off unless it was asked. */
  publishable: boolean;
  /** The five compiler packages, then `trillion3d`: published in this order. */
  archives: ReleaseArchive[];
}

/** Whether `name@version` is on the registry. */
export type Lookup = (spec: string) => boolean;

const RECORD = 'release.json';
/** What the package never carries: the documentation site and the bench's witnesses. */
const LEFT_OUT = /^dist\/(site|witnesses)\//;
const compilerFolder = (root: string, platform: string) =>
  join(root, 'packages/compiler', platform);

/** The released packages in publication order: `trillion3d` last, so that it never names a
 *  compiler package not yet out. */
export const releaseNames = () => [
  ...COMPILER_PLATFORMS.map((platform) => {
    const [os, arch] = platform.split('-');
    return compilerPackage(os, arch) as string;
  }),
  'trillion3d',
];

const releaseFolders = (root: string) => [
  ...COMPILER_PLATFORMS.map((platform) => compilerFolder(root, platform)),
  root,
];

/** The one version of the six packages; refuses a package at another. */
export function releaseVersion(root: string): string {
  const manifests = releaseFolders(root).map(
    (folder) =>
      JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
      },
  );
  const { version } = manifests[manifests.length - 1];
  const others = manifests.filter((manifest) => manifest.version !== version);
  if (others.length > 0)
    throw new Error(
      `one version for every package: trillion3d is ${version}, ` +
        others.map(({ name, version: own }) => `${name} ${own}`).join(', '),
    );
  return version;
}

/**
 * Each platform's compiler as the `Compiler` workflow's artifacts laid it down, made executable
 * again: an Actions artifact does not keep the execute bit. Refuses a missing platform.
 */
export function stageCompilers(root: string): void {
  const binaries = COMPILER_PLATFORMS.map((platform) =>
    join(
      compilerFolder(root, platform),
      'bin',
      compilerFileName(platform.split('-')[0] as NodeJS.Platform),
    ),
  );
  const missing = binaries.filter((binary) => !existsSync(binary));
  if (missing.length > 0) throw new Error(`compiler missing: ${missing.join(', ')}`);
  for (const binary of binaries) chmodSync(binary, 0o755);
}

/**
 * Packs the six packages into `out` and records them in `out/release.json`. `private` stays in
 * every manifest unless `publishable`, which removes it from the packed copy alone: the repository
 * keeps `private: true`. Refuses a compiler archive without its program and a `trillion3d` archive
 * that carries the site or the witnesses.
 */
export function packRelease(options: {
  root: string;
  out: string;
  run: Run;
  pnpm: string;
  publishable: boolean;
}): Release {
  const { root, out, run, pnpm, publishable } = options;
  const version = releaseVersion(root);
  stageCompilers(root);
  const archives = releaseFolders(root).map((folder): ReleaseArchive => {
    const path = join(folder, 'package.json');
    const original = readFileSync(path, 'utf8');
    const { private: _private, ...manifest } = JSON.parse(original) as {
      name: string;
      private?: boolean;
    };
    if (publishable) writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    let packed: PackResult & { filename: string };
    try {
      packed = packArchive(run, pnpm, folder, out);
    } finally {
      if (publishable) writeFileSync(path, original);
    }
    const files = packed.files ?? [];
    const leaked = files.filter((file) => LEFT_OUT.test(file.path));
    if (leaked.length > 0)
      throw new Error(`${manifest.name} carries ${leaked.map((file) => file.path).join(', ')}`);
    if (folder !== root && !files.some((file) => file.path.startsWith('bin/')))
      throw new Error(`${manifest.name} carries no compiler`);
    return { name: manifest.name, filename: basename(packed.filename), files };
  });
  const release: Release = { version, publishable, archives };
  writeFileSync(join(out, RECORD), `${JSON.stringify(release, null, 2)}\n`);
  return release;
}

/** The release packed in `out`, its archives' paths made absolute; refuses a missing package or
 *  archive, and any other order than the publication's. */
export function readRelease(out: string): Release {
  const release = JSON.parse(readFileSync(join(out, RECORD), 'utf8')) as Release;
  const names = release.archives.map((archive) => archive.name).join(', ');
  if (names !== releaseNames().join(', '))
    throw new Error(`release incomplete: ${names}; expected ${releaseNames().join(', ')}`);
  const archives = release.archives.map((archive) => ({
    ...archive,
    filename: join(out, archive.filename),
  }));
  const missing = archives.filter((archive) => !existsSync(archive.filename));
  if (missing.length > 0)
    throw new Error(`archive missing: ${missing.map((archive) => archive.filename).join(', ')}`);
  return { ...release, archives };
}

/** The registry's answer: a version printed is published; `E404`, never published. */
export const npmPublished: Lookup = (spec) => {
  const result = spawnSync('npm', ['view', spec, 'version'], { encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim() !== '';
  if (/\bE404\b/.test(result.stderr)) return false;
  throw new Error(`npm view ${spec} failed (${result.status})\n${result.stderr}`);
};

/**
 * Publishes the release packed in `out`: refused whole when a package is missing or one of its
 * versions is already published, every publication dry-run first, and published for real only
 * when `publish` is asked of a release packed `publishable` — so a failure found by a dry run
 * leaves nothing published.
 */
export function publishRelease(options: {
  out: string;
  run: Run;
  publish: boolean;
  published?: Lookup;
}): Release {
  const { out, run, publish, published = npmPublished } = options;
  const release = readRelease(out);
  const already = release.archives.filter(({ name }) => published(`${name}@${release.version}`));
  if (already.length > 0)
    throw new Error(
      `already published at ${release.version}: ${already.map(({ name }) => name).join(', ')}`,
    );
  if (publish && !release.publishable) throw new Error('the release was packed private');
  for (const { filename } of release.archives) run('npm', ['publish', filename, '--dry-run'], out);
  if (publish) for (const { filename } of release.archives) run('npm', ['publish', filename], out);
  return release;
}
