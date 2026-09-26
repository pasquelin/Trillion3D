import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { publierRapport } from './publishReport.ts';

test('a campaign replaces the one report, keeps the portal entry, and validates evidence before copying', () => {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-publish-'));
  try {
    const source = join(root, 'source'),
      dest = join(root, 'site');
    mkdirSync(source);
    mkdirSync(dest);
    writeFileSync(join(dest, 'index.html'), 'portal');
    const report = {
      formatVersion: 1,
      id: 'test',
      records: [],
      runs: [{ id: 'run', status: 'complete', source: 'source.json', startedAt: '2026-09-20' }],
    };
    writeFileSync(join(source, 'report.json'), JSON.stringify(report));
    assert.throws(() => publierRapport(source, dest), /Missing evidence/);
    assert.equal(existsSync(join(dest, 'reports/test')), false);
    writeFileSync(join(source, 'source.json'), '{}');
    assert.equal(publierRapport(source, dest), join(dest, 'reports/test'));
    assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), 'portal');
    assert.equal(JSON.parse(readFileSync(join(dest, 'reports/index.json'), 'utf8'))[0].id, 'test');
    assert.throws(() => publierRapport(source, dest), /already published/);
    writeFileSync(join(dest, 'reports/contract.ts'), 'export {};');
    writeFileSync(join(source, 'report.json'), JSON.stringify({ ...report, id: 'next' }));
    assert.equal(publierRapport(source, dest), join(dest, 'reports/next'));
    assert.equal(existsSync(join(dest, 'reports/test')), false, 'the previous campaign is gone');
    assert.equal(existsSync(join(dest, 'reports/contract.ts')), true, 'the modules stay');
    assert.deepEqual(
      JSON.parse(readFileSync(join(dest, 'reports/index.json'), 'utf8')).map(
        (item: { id: string }) => item.id,
      ),
      ['next'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the published campaign has every image it references, each stored once', () => {
  const reports = resolve(import.meta.dirname, '../../site/reports');
  const [{ id }] = JSON.parse(readFileSync(join(reports, 'index.json'), 'utf8'));
  const report = JSON.parse(readFileSync(join(reports, id, 'report.json'), 'utf8'));
  for (const { image } of report.records as { image: string | null }[])
    if (image) assert.ok(existsSync(join(reports, id, image)), image);
  const images = join(reports, id, 'images');
  const hash = (file: string) => createHash('sha256').update(readFileSync(join(images, file)));
  const hashes = readdirSync(images).map((file) => hash(file).digest('hex'));
  assert.equal(new Set(hashes).size, hashes.length, 'two images are byte-identical');
});
