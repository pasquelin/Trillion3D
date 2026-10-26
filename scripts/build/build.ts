import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cleanBundle } from './build-bundle.ts'
import { heavyStep } from '../native/heavy-lock.ts'
import { run } from '../check/run.ts'

// `pnpm run build`: the packages' `dist/`, from a clean output, as one heavy step
// (`scripts/native/heavy-lock.ts`).
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const steps: string[][] = [
  [tsc, '-p', 'tsconfig.json'],
  ['scripts/build/rewrite-dts-extensions.ts'],
  ['scripts/build/copy-resources.ts'],
  ['scripts/build/write-build-provenance.ts'],
  ['scripts/build/build-bundle.ts'],
  ['scripts/build/build-witnesses.ts'],
]

heavyStep('build', () => {
  for (const pkg of ['sdk', 'math', 'sdk-core', 'sdk-browser', 'sdk-node', 'witnesses'])
    rmSync(`dist/${pkg}`, { recursive: true, force: true })
  cleanBundle('dist')
  for (const args of steps) run(process.execPath, args)
})
