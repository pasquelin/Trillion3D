import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NAMES_THREE } from './engine-without-three-lists.ts';

const repo = new URL('../../', import.meta.url);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/** What `pnpm pack --json` prints: one archive descriptor on older pnpm, an array on newer ones. */
interface PackEntry {
  filename?: string;
}

function pack(directory: string): string | undefined {
  const output = execFileSync(pnpm, ['pack', '--json', '--pack-destination', directory], {
    cwd: repo,
    encoding: 'utf8',
  });
  const result = JSON.parse(output) as PackEntry | PackEntry[];
  return Array.isArray(result) ? result[0]?.filename : result.filename;
}

/** What the packed `package.json` declares, as far as this test reads it. */
interface PackageManifest {
  scripts?: { preinstall?: string; prepare?: string };
  sideEffects?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Every package name a dependency tree printed by `pnpm list --json` reaches. */
function treeNames(node: { dependencies?: Record<string, unknown> }, names = new Set<string>()) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    names.add(name);
    treeNames(child as { dependencies?: Record<string, unknown> }, names);
  }
  return names;
}

test('the packed distribution is self-contained at its declared boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-package-'));
  try {
    const archive = pack(root);
    assert.ok(archive, 'pnpm pack did not report an archive');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
    for (const path of [
      'package/dist/sdk-browser/src/page/decode/pageCodec.wasm',
      'package/dist/sdk-browser/src/page/decode/pageDecodeWorker.js',
      'package/dist/sdk-browser/src/page/integration/pageIntegrationWorker.js',
      'package/dist/sdk-node/src/cli/cli.mjs',
    ])
      assert.ok(entries.includes(path), `${path} missing from the package`);
    assert.equal(
      entries.some((path) => path.includes('/asset-compiler-rust/')),
      false,
    );
    assert.equal(
      entries.some((path) => path.startsWith('package/scripts/')),
      false,
    );

    execFileSync('tar', ['-xzf', archive, '-C', root]);
    const manifest = JSON.parse(
      readFileSync(join(root, 'package/package.json'), 'utf8'),
    ) as PackageManifest;
    assert.equal(manifest.scripts?.preinstall, undefined);
    assert.equal(manifest.scripts?.prepare, undefined);
    assert.equal(manifest.sideEffects, false);
    assert.ok(statSync(join(root, 'package/dist/sdk-node/src/cli/cli.mjs')).mode & 0o111);

    const consumer = join(root, 'consumer');
    const installed = join(consumer, 'node_modules/trillion3d');
    mkdirSync(join(consumer, 'node_modules'), { recursive: true });
    renameSync(join(root, 'package'), installed);
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const sdk=await import('trillion3d');const p=await sdk.getSdkProvenance();if(!sdk.hierarchyUpdateBatch||!sdk.prepare||!p.files['dist/sdk/node.mjs'])process.exit(2);for(const path of ['/core','/node','/browser'])try{await import('trillion3d'+path);process.exit(3)}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')process.exit(4)}",
      ],
      { cwd: consumer, encoding: 'utf8' },
    );
    assert.equal(probe.status, 0, probe.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Issue #275: the witnesses live beside the bench, so the package neither ships nor pulls the host
// library. Read on the archive and on a real install, not on the manifest alone.
test('the packed package names no host library and a clean install pulls none', () => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-no-three-'));
  try {
    const archive = pack(root);
    assert.ok(archive, 'pnpm pack did not report an archive');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
    assert.deepEqual(
      entries.filter((path) => path.startsWith('package/dist/witnesses/')),
      [],
      'the witness entry is bench-only',
    );
    execFileSync('tar', ['-xzf', archive, '-C', root]);
    const shipped = join(root, 'package');
    const naming = (readdirSync(shipped, { recursive: true }) as string[]).filter(
      (path) =>
        /\.(?:m?js|d\.m?ts)$/.test(path) &&
        NAMES_THREE.test(readFileSync(join(shipped, path), 'utf8')),
    );
    assert.deepEqual(naming, [], 'no shipped module or declaration imports the host library');
    const manifest = JSON.parse(
      readFileSync(join(shipped, 'package.json'), 'utf8'),
    ) as PackageManifest;
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const)
      assert.equal(manifest[field]?.three, undefined, `${field} names three`);

    const consumer = join(root, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        name: 'consumer',
        private: true,
        dependencies: { trillion3d: `file:${archive}` },
      }),
    );
    execFileSync(pnpm, ['install', '--offline', '--ignore-scripts'], {
      cwd: consumer,
      encoding: 'utf8',
      env: { ...process.env, npm_config_auto_install_peers: 'true' },
    });
    const [tree] = JSON.parse(
      execFileSync(pnpm, ['list', '--depth', 'Infinity', '--json'], {
        cwd: consumer,
        encoding: 'utf8',
      }),
    ) as Array<{ dependencies?: Record<string, unknown> }>;
    const names = treeNames(tree);
    assert.ok(names.has('trillion3d'), 'the package itself is installed');
    assert.equal(names.has('three'), false, 'the dependency tree reaches three');
    const store = readdirSync(join(consumer, 'node_modules/.pnpm'));
    assert.deepEqual(
      store.filter((name) => /^three@|_three@/.test(name)),
      [],
      'the virtual store holds no three',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
