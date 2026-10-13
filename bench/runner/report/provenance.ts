import { cpus, totalmem, platform, arch, release, hostname } from 'node:os'
import { join } from 'node:path'
import { readJson } from '../../../scripts/repository-files.ts'
import { sha256 } from '../../../packages/sdk-node/src/compiler/provenance.mts'
export function measurementProvenance() {
  return {
    machine: {
      id: sha256(hostname()),
      cpu: cpus()[0]?.model ?? null,
      cores: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      arch: arch(),
      release: release(),
    },
    browser: null,
    displayCapHz: null,
  }
}
export function assetIdentity(cache: string) {
  const manifest = readJson(join(cache, 'native/full/manifest.json'))
  return manifest.key ?? sha256(JSON.stringify(manifest))
}
