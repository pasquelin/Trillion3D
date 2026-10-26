// The package as a host installs it: packed once (`pnpm pack`), then read as an archive, unpacked
// beside a consumer, and installed by pnpm with its declarations checked.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { diagnostics, HOSTS } from './declarations.fixture.ts'
import { REPOSITORY_ROOT, readJson } from '../../scripts/git/repository-files.ts'

/**
 * A module specifier of three.js in a shipped module or declaration, keyed on the specifier, not on
 * the statement, so a multi-line `import {…}\nfrom 'three'`, a bare `import 'three'`, a dynamic
 * `import('three')`, an `export … from 'three'` and any `three/…` subpath are all caught.
 */
const NAMES_THREE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]three(?:\/[^'"]*)?['"]/

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/** What `pnpm pack --json` prints: one archive descriptor on older pnpm, an array on newer ones. */
interface PackEntry {
  filename?: string
}

function pack(directory: string): string | undefined {
  const output = execFileSync(pnpm, ['pack', '--json', '--pack-destination', directory], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    maxBuffer: 1 << 26,
  })
  const result = JSON.parse(output) as PackEntry | PackEntry[]
  return Array.isArray(result) ? result[0]?.filename : result.filename
}

/** The one archive every test below reads, and the directory it was packed into. */
let root = ''
let archive = ''
/** Every path the archive holds. */
let entries: string[] = []
before(() => {
  root = mkdtempSync(join(tmpdir(), 'trillion3d-package-'))
  const packed = pack(root)
  assert.ok(packed, 'pnpm pack did not report an archive')
  archive = packed
  entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n')
})
after(() => rmSync(root, { recursive: true, force: true }))

/** A directory of its own under the packed one, the archive unpacked in it: `<it>/package`. */
function unpacked(name: string): string {
  const directory = join(root, name)
  mkdirSync(directory)
  execFileSync('tar', ['-xzf', archive, '-C', directory])
  return directory
}

/** What the packed `package.json` declares, as far as this test reads it. */
interface PackageManifest {
  scripts?: { preinstall?: string; prepare?: string }
  sideEffects?: boolean
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

test('the packed distribution is self-contained at its declared boundaries', () => {
  for (const path of [
    'package/dist/sdk-browser/src/wasm/kernels.wasm',
    'package/dist/sdk-browser/src/geometry/work/pageWorker.js',
    'package/dist/sdk-browser/src/geometry/integration/pageIntegrationWorker.js',
    'package/dist/sdk-node/src/cli/cli.mjs',
  ])
    assert.ok(entries.includes(path), `${path} missing from the package`)
  assert.equal(
    entries.some((path) => path.includes('/asset-compiler-rust/')),
    false,
  )
  assert.equal(
    entries.some((path) => path.startsWith('package/scripts/')),
    false,
  )

  const unpack = unpacked('self-contained')
  const manifest = readJson(join(unpack, 'package/package.json')) as PackageManifest
  assert.equal(manifest.scripts?.preinstall, undefined)
  assert.equal(manifest.scripts?.prepare, undefined)
  assert.equal(manifest.sideEffects, false)
  assert.ok(statSync(join(unpack, 'package/dist/sdk-node/src/cli/cli.mjs')).mode & 0o111)

  const consumer = join(unpack, 'consumer')
  const installed = join(consumer, 'node_modules/trillion3d')
  mkdirSync(join(consumer, 'node_modules'), { recursive: true })
  renameSync(join(unpack, 'package'), installed)
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "const sdk=await import('trillion3d');const p=await sdk.getSdkProvenance();if(!sdk.multiplyMatrix4||!sdk.prepare||!p.files['dist/sdk/node.mjs'])process.exit(2);for(const path of ['/core','/node','/browser'])try{await import('trillion3d'+path);process.exit(3)}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')process.exit(4)}",
    ],
    { cwd: consumer, encoding: 'utf8' },
  )
  assert.equal(probe.status, 0, probe.stderr)
})

// The package ships no three.js: read on the archive and on every module and declaration it
// unpacks to; its manifest depends on nothing but its own compiler, optional, per platform, and
// each compiler package's manifest in this repository depends on nothing at all. What a real
// install pulls is read on the installed tree (`a packed installation resolves …`).
test('the packed package names no three.js and depends on nothing that could', () => {
  assert.deepEqual(
    entries.filter((path) => path.startsWith('package/dist/witnesses/')),
    [],
    'the witness entry is bench-only',
  )
  const shipped = join(unpacked('no-three'), 'package')
  const naming = (readdirSync(shipped, { recursive: true }) as string[]).filter(
    (path) =>
      /\.(?:m?js|d\.m?ts)$/.test(path) &&
      NAMES_THREE.test(readFileSync(join(shipped, path), 'utf8')),
  )
  assert.deepEqual(naming, [], 'no shipped module or declaration imports the host library')
  const manifest = readJson(join(shipped, 'package.json')) as PackageManifest
  assert.equal(manifest.dependencies, undefined, 'the package depends on nothing')
  assert.equal(manifest.peerDependencies, undefined, 'the package asks its host for nothing')
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    const platform = /^@trillion3d\/compiler-(.+)$/.exec(name)?.[1]
    assert.ok(platform, `${name} is not the package's own compiler`)
    const compiler = readJson(
      join(REPOSITORY_ROOT, 'packages/compiler', platform, 'package.json'),
    ) as PackageManifest
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const)
      assert.equal(compiler[field], undefined, `${name} declares ${field}`)
  }
})

test('a packed installation resolves Node and browser runtime and declarations', () => {
  const directory = join(root, 'installed')
  mkdirSync(directory)
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        trillion3d: `file:${archive}`,
      },
      devDependencies: {
        '@webgpu/types': `link:${resolve(REPOSITORY_ROOT, 'node_modules/@webgpu/types')}`,
      },
    }),
  )
  writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages: []\n')
  execFileSync(pnpm, ['install', '--offline', '--config.auto-install-peers=false'], {
    cwd: directory,
    stdio: 'pipe',
  })
  writeFileSync(
    join(directory, 'node.ts'),
    "import {prepare,multiplyMatrix4} from 'trillion3d'; if (!prepare || !multiplyMatrix4) throw Error('node');",
  )
  writeFileSync(
    join(directory, 'browser.ts'),
    "import {createWorld,multiplyMatrix4} from 'trillion3d'; if (!createWorld || !multiplyMatrix4) throw Error('browser');",
  )
  execFileSync(process.execPath, ['node.ts'], { cwd: directory, stdio: 'pipe' })
  execFileSync(process.execPath, ['--conditions=browser', 'browser.ts'], {
    cwd: directory,
    stdio: 'pipe',
  })
  // Each face of the package, compiled as its host compiles it.
  for (const [file, fixture, host] of [
    ['node.mts', 'publicNode.mts', HOSTS.node],
    ['browser.ts', 'publicBrowser.ts', HOSTS.browser],
    ['common.ts', 'publicCommon.ts', HOSTS.common],
  ] as const) {
    const at = join(directory, file)
    writeFileSync(at, readFileSync(resolve(REPOSITORY_ROOT, 'tests/fixtures/public', fixture)))
    assert.deepEqual(diagnostics(at, host), [], file)
  }
  // The install pulled no three.js, however deep.
  assert.deepEqual(
    readdirSync(join(directory, 'node_modules/.pnpm')).filter((name) =>
      /^three@|_three@/.test(name),
    ),
    [],
    'the installed tree holds no three',
  )
  // Jolt's licence ships with the physics modules built from it.
  const notice = join(directory, 'node_modules/trillion3d/THIRD_PARTY_NOTICES.md')
  assert.match(readFileSync(notice, 'utf8'), /joltPhysicsThreads\.wasm/)
})
