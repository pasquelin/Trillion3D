import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publierRapport } from './publierRapport.mjs';

test('publierRapport pose index.html, les vignettes et .nojekyll', () => {
  const root = join(tmpdir(), `wg-pages-${Date.now()}`);
  const source = join(root, 'out');
  const dest = join(root, 'docs');
  mkdirSync(join(source, 'vignettes'), { recursive: true });
  writeFileSync(join(source, 'rapport.html'), '<html>rapport</html>');
  writeFileSync(join(source, 'vignettes', 'sol.jpg'), 'jpeg');
  try {
    assert.equal(publierRapport(source, dest), join(dest, 'index.html'));
    assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<html>rapport</html>');
    assert.equal(readFileSync(join(dest, 'vignettes', 'sol.jpg'), 'utf8'), 'jpeg');
    assert.equal(readFileSync(join(dest, '.nojekyll'), 'utf8'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publierRapport refuse un dossier sans rapport.html', () => {
  const root = join(tmpdir(), `wg-pages-vide-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    assert.throws(() => publierRapport(root, join(root, 'docs')), /pas de rapport/);
    assert.equal(existsSync(join(root, 'docs', 'index.html')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
