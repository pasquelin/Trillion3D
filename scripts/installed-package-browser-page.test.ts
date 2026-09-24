import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstalledPage } from './installed-package-browser-page.ts';

test('the installed page names a session that failed to open before drawing (#568)', () => {
  // `page.evaluate` ships the function's source alone: the check is read there.
  const source = evaluateInstalledPage.toString();
  assert.match(source, /diagnostic\.error/);
  assert.ok(source.indexOf('diagnostic.error') < source.indexOf('.render()'));
});
