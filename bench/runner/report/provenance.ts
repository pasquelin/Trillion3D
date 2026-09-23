import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, totalmem, platform, arch, release, hostname } from 'node:os';
import { join } from 'node:path';
import { fingerprintBuild } from '../../../scripts/write-build-provenance.ts';
import { sceneDerived } from '../scene.ts';
import type { Report } from './types.ts';
const digest = (data: string) => createHash('sha256').update(data).digest('hex');
export function measurementProvenance() {
  return {
    machine: {
      id: digest(hostname()),
      cpu: cpus()[0]?.model ?? null,
      cores: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      arch: arch(),
      release: release(),
    },
    browser: null,
    displayCapHz: null,
  };
}
export function assetIdentity(cache: string) {
  const manifest = JSON.parse(readFileSync(join(cache, 'native/full/manifest.json'), 'utf8'));
  return manifest.key ?? digest(JSON.stringify(manifest));
}
export async function campaignIdentity(
  root: string,
  scene: string,
  args: string[],
  browserVersion: string,
) {
  const git = (argv: string[]) => execFileSync('git', ['-C', root, ...argv], { encoding: 'utf8' });
  return digest(
    JSON.stringify({
      version: 1,
      browserVersion,
      scene,
      args,
      head: git(['rev-parse', 'HEAD']).trim(),
      dirty: digest(git(['diff', 'HEAD', '--', 'packages', 'scripts'])),
      build: (await fingerprintBuild(join(root, 'dist'))).hash,
      asset: assetIdentity(sceneDerived(scene)),
      machine: measurementProvenance().machine,
    }),
  );
}
export function canResume(measurement: Partial<Report>, identity: string) {
  return (
    measurement.campaignIdentity === identity &&
    Boolean(measurement.finishedAt) &&
    Array.isArray(measurement.series) &&
    measurement.series.length > 0 &&
    Array.isArray(measurement.errors) &&
    measurement.errors.length === 0
  );
}
