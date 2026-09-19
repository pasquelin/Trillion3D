import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './rapportGlobalPage.mjs';

test('the report page links back to the documentation portal before its title', () => {
  const out = page({ titre: 'T', sousTitre: 'S', sections: [{ id: 'a', titre: 'A', corps: '' }] });
  const portal = out.indexOf('<a href="./">← Documentation</a>');
  assert.ok(portal > 0);
  assert.ok(portal < out.indexOf('<h1>T</h1>'));
  assert.ok(out.includes('<section id="a"><h2>A</h2></section>'));
});
