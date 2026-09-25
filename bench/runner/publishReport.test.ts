import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
