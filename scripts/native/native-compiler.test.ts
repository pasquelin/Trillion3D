import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepare } from '../../packages/sdk-node/src/index.mts'
import { compileFullCache, TRIANGLE_BUDGET } from './native-compiler.ts'

/** A program that records its arguments, one per line, and refuses the job: what a caller hands the
 *  compiler, read back without a compiler. */
function recorder(directory: string) {
  const executable = join(directory, 'recorder')
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$(dirname "$0")/arguments"',
      'printf \'{"status":"error","code":"RECORDED","message":"recorded"}\\n\'',
      'exit 1',
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  return {
    executable,
    arguments: () => readFileSync(join(directory, 'arguments'), 'utf8').split('\n').slice(0, -1),
  }
}

const options = {
  ramMb: 512,
  threads: 3,
  simplification: 'qem-endpoints',
  hlod: { levels: 3 },
  temporalAntialiasing: 'low',
  responsive: { node: 'door' },
} as const
const skip = process.platform === 'win32' && 'the recorder is a shell script'

// Behaviour: the SDK's compile and the repository tools' write the same command line for one job:
// the fields in order, then the HLOD flag, then the job's other flags.
test('prepare and compileFullCache write the same arguments for one job', { skip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trillion3d-arguments-'))
  try {
    const program = recorder(directory)
    const { ramMb, threads, ...named } = options
    await assert.rejects(
      prepare('models/city', 'cache', 'full', Number(TRIANGLE_BUDGET), {
        ...named,
        ramBudgetMb: ramMb,
        threads,
        resourceBaseUrl: '../../../../source/',
        executable: program.executable,
      }),
      /recorded/,
    )
    const prepared = program.arguments()
    assert.throws(() =>
      compileFullCache({
        cwd: directory,
        source: 'models/city',
        stdio: 'ignore',
        executable: program.executable,
        ...options,
      }),
    )
    assert.deepEqual(program.arguments(), prepared)
    assert.deepEqual(prepared.slice(0, 8), [
      'models/city',
      'cache',
      'full',
      TRIANGLE_BUDGET,
      '3',
      '512',
      '../../../../source/',
      'qem-endpoints',
    ])
    assert.ok(prepared[8].startsWith('--hlod='), prepared[8])
    assert.ok(prepared.length > 9, 'the job names flags besides the HLOD')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Behaviour: a full cache asked for an HLOD without simplification is refused naming both options,
// since exact clusters build no HLOD and the compiler would ignore the flag.
test('compileFullCache refuses an HLOD of exact clusters, naming both options', () => {
  assert.throws(
    () =>
      compileFullCache({
        cwd: tmpdir(),
        source: 'models/city',
        executable: '/nowhere/compiler',
        hlod: { levels: 2 },
      }),
    /`hlod`.*`simplification: 'qem-endpoints'`/,
  )
})
