import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../packages/sdk-node/src/compiler/provenance.mts';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditAssetManifest } from './asset-license-audit.ts';
import { parseAssetManifest, type Asset } from './asset-license-manifest.ts';

async function fixture(run: (root: string, asset: Asset) => Promise<void>) {
  const logs = resolve('.worktrees/logs');
  await mkdir(logs, { recursive: true });
  const root = await mkdtemp(resolve(logs, '54-audit-'));
  const bytes = 'Locally authored test evidence, no third-party asset.';
  const hash = sha256(bytes);
  await writeFile(resolve(root, 'asset.txt'), bytes);
  await writeFile(resolve(root, 'evidence.txt'), bytes);
  const ref = { path: 'evidence.txt', sha256: hash };
  const asset: Asset = {
    id: 'fixture',
    path: 'asset.txt',
    sha256: hash,
    source: 'https://example.org/source',
    license: 'fab-standard',
    licenseVersion: 'terms-at-acquisition',
    usage: 'embedded-product',
    evidence: { terms: ref, acquisition: ref },
  };
  try {
    await run(root, asset);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function save(root: string, asset: Asset) {
  const file = resolve(root, 'licenses.json');
  await writeFile(file, JSON.stringify({ version: 1, assets: [asset] }));
  return file;
}

async function result(root: string, asset: Asset) {
  return (await auditAssetManifest(await save(root, asset))).results[0];
}

test('documented marketplace uses match; raw redistribution and reference-only plans are rejected', async () => {
  await fixture(async (root, asset) => {
    for (const license of ['fab-standard', 'unity-asset-store', 'owned']) {
      assert.equal(
        (await result(root, { ...asset, license })).status,
        'matches-documented-criteria',
      );
    }
    for (const license of ['fab-standard', 'unity-asset-store']) {
      const rejected = await result(root, { ...asset, license, usage: 'raw-distribution' });
      assert.equal(rejected.status, 'rejected');
    }
    assert.equal(
      (await result(root, { ...asset, license: 'quixel-epic-engine' })).status,
      'rejected',
    );
  });
});

test('unknown licenses and missing evidence never pass; public assets need redistribution evidence', async () => {
  await fixture(async (root, asset) => {
    assert.equal(
      (await result(root, { ...asset, license: 'custom-license' })).status,
      'review-required',
    );
    assert.equal((await result(root, { ...asset, evidence: {} })).status, 'review-required');
    const publicAsset: Asset = { ...asset, license: 'owned', usage: 'public-demo' };
    assert.equal((await result(root, publicAsset)).status, 'review-required');
    publicAsset.evidence = { ...asset.evidence, redistribution: asset.evidence.terms };
    assert.equal((await result(root, publicAsset)).status, 'matches-documented-criteria');
  });
});

test('CC-BY requires attribution and a change notice, including a declaration of no changes', async () => {
  await fixture(async (root, asset) => {
    asset.license = 'cc-by';
    assert.deepEqual(
      (await result(root, asset)).findings.map((f) => f.code),
      ['attribution-evidence-required', 'changes-evidence-required'],
    );
    asset.evidence.attribution = asset.evidence.terms;
    asset.evidence.changes = asset.evidence.terms;
    assert.equal((await result(root, asset)).status, 'matches-documented-criteria');
  });
});

test('changed bytes, absent evidence and escaping symlinks fail integrity without reading outside', async () => {
  await fixture(async (root, asset) => {
    await writeFile(resolve(root, 'asset.txt'), 'changed');
    assert.equal((await result(root, asset)).status, 'review-required');
    asset.evidence.terms = { path: 'missing', sha256: asset.sha256 };
    assert.ok(
      (await result(root, asset)).findings.some((f) => f.code === 'terms-missing-or-hash-mismatch'),
    );
    await copyFile(resolve(root, 'evidence.txt'), resolve(root, 'asset.txt'));
    const nested = resolve(root, 'nested');
    await mkdir(nested);
    await symlink(root, resolve(nested, 'outside'));
    asset.path = 'outside/asset.txt';
    assert.ok(
      (await result(nested, asset)).findings.some(
        (f) => f.code === 'asset-missing-or-hash-mismatch',
      ),
    );
  });
});

test('malformed, empty, duplicate and unknown usage manifests are unusable input', async () => {
  await fixture(async (_root, asset) => {
    for (const value of [
      null,
      { version: 2, assets: [asset] },
      { version: 1, assets: [] },
      { version: 1, assets: [asset, asset] },
      { version: 1, assets: [asset, { ...asset, id: 'other', path: `./${asset.path}` }] },
      { version: 1, assets: [{ ...asset, usage: 'unspecified' }] },
      { version: 1, assets: [{ ...asset, usage: ['internal'] }] },
    ]) {
      assert.throws(() => parseAssetManifest(value));
    }
  });
});

test('CLI distinguishes matched criteria, unresolved policy and invalid input with exit codes', async () => {
  await fixture(async (root, asset) => {
    const cli = resolve('scripts/audit-asset-licenses.ts');
    const run = (file: string) => spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
    const file = await save(root, asset);
    assert.equal(run(file).status, 0);
    asset.license = 'unverified';
    const unresolved = run(await save(root, asset));
    assert.equal(unresolved.status, 1);
    assert.equal(JSON.parse(unresolved.stdout).results[0].status, 'review-required');
    await writeFile(file, '{');
    assert.equal(run(file).status, 2);
  });
});
