import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('../../', import.meta.url);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function pack(directory) {
  const output = execFileSync(pnpm, ['pack', '--json', '--pack-destination', directory], {
    cwd: repo,
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  return result.filename ?? result[0]?.filename;
}

test('the packed distribution is self-contained at its declared boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-geometry-package-'));
  try {
    const archive = pack(root);
    assert.ok(archive, 'pnpm pack did not report an archive');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
    for (const path of [
      'package/dist/sdk-browser/pageCodec.wasm',
      'package/dist/sdk-browser/pageDecodeWorker.js',
      'package/dist/sdk-browser/pageIntegrationWorker.js',
      'package/dist/sdk-node/cli.mjs',
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
    const manifest = JSON.parse(readFileSync(join(root, 'package/package.json'), 'utf8'));
    assert.equal(manifest.scripts?.preinstall, undefined);
    assert.equal(manifest.scripts?.prepare, undefined);
    assert.equal(manifest.sideEffects, false);
    assert.ok(statSync(join(root, 'package/dist/sdk-node/cli.mjs')).mode & 0o111);

    const consumer = join(root, 'consumer');
    const installed = join(consumer, 'node_modules/@web-geometry/sdk');
    mkdirSync(join(consumer, 'node_modules/@web-geometry'), { recursive: true });
    renameSync(join(root, 'package'), installed);
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const core=await import('@web-geometry/sdk/core');const node=await import('@web-geometry/sdk/node');const p=await node.getSdkProvenance();if(!core.hierarchyUpdateBatch||!p.files['dist/sdk-node/index.mjs'])process.exit(2)",
      ],
      { cwd: consumer, encoding: 'utf8' },
    );
    assert.equal(probe.status, 0, probe.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
