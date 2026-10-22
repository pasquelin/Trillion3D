import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blueNoiseBytes } from './blueNoiseSource.ts'

// Node cannot fetch the file by its URL: the tests hand it the bytes the repository ships, once, before anything draws.
/** The blue noise file, read for the tests and handed to the loader. */
export const blueNoiseFile = await blueNoiseBytes(
  readFileSync(join(import.meta.dirname, 'blueNoise.bin')),
)
