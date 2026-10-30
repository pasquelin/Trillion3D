import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { noiseVolumeBytes, patternBytes } from './cloudTextureFiles.ts'

// Node cannot fetch the files by their URLs: the tests hand them the bytes the repository ships, once, before anything draws.
await Promise.all([
  patternBytes(readFileSync(join(import.meta.dirname, 'cloudPattern.bin'))),
  noiseVolumeBytes(readFileSync(join(import.meta.dirname, 'cloudNoise.bin'))),
])
