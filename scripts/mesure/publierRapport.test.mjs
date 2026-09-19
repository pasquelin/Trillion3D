import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publierRapport } from './publierRapport.mjs';

test('publierRapport places report.html, thumbnails and .nojekyll, and leaves index.html alone', () => {
  const root = join(tmpdir(), `wg-pages-${Date.now()}`);
  const source = join(root, 'out');
  const dest = join(root, 'docs');
  mkdirSync(join(source, 'vignettes'), { recursive: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'index.html'), '<html>portal</html>');
  writeFileSync(join(source, 'rapport.html'), '<html>rapport</html>');
  writeFileSync(join(source, 'vignettes', 'sol.jpg'), 'jpeg');
  try {
    assert.equal(publierRapport(source, dest), join(dest, 'report.html'));
    assert.equal(readFileSync(join(dest, 'report.html'), 'utf8'), '<html>rapport</html>');
    assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<html>portal</html>');
    assert.equal(readFileSync(join(dest, 'vignettes', 'sol.jpg'), 'utf8'), 'jpeg');
    assert.equal(readFileSync(join(dest, '.nojekyll'), 'utf8'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publierRapport rejects a directory without rapport.html', () => {
  const root = join(tmpdir(), `wg-pages-vide-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    assert.throws(() => publierRapport(root, join(root, 'docs')), /no report/);
    assert.equal(existsSync(join(root, 'docs', 'report.html')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
