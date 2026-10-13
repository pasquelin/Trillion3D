import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REPOSITORY_ROOT, filesUnder } from './repository-files.ts'

const checkOnly = process.argv.includes('--check')
const dist = join(REPOSITORY_ROOT, 'dist')
let rewritten = 0

for (const path of existsSync(dist) ? filesUnder(dist) : []) {
  if (!path.endsWith('.d.ts') && !path.endsWith('.d.mts')) continue
  const text = await readFile(path, 'utf8')
  const next = text.replace(
    /(from\s+['"])(\.[^'"]+)\.(mts|ts)(['"])/g,
    (_match, prefix: string, stem: string, extension: string, suffix: string) =>
      `${prefix}${stem}.${extension === 'mts' ? 'mjs' : 'js'}${suffix}`,
  )
  if (next === text) continue
  if (checkOnly) throw new Error(`${path} still imports TypeScript source modules`)
  await writeFile(path, next)
  rewritten++
}

if (!checkOnly) process.stderr.write(`rewrote ${rewritten} declaration files\n`)
