import { createHash } from 'node:crypto'
import { cpus, totalmem, platform, arch, release, hostname } from 'node:os'
import { join } from 'node:path'
import { readJson } from '../../../scripts/repository-files.ts'
const digest = (data: string) => createHash('sha256').update(data).digest('hex')
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
  }
}
export function assetIdentity(cache: string) {
  const manifest = readJson(join(cache, 'native/full/manifest.json'))
  return manifest.key ?? digest(JSON.stringify(manifest))
}
