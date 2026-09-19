import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './rapportGlobalPage.mjs';

const SECTIONS = [{ id: 'a', titre: 'A', corps: '' }];

test("the page places the caller's return link before the title, and nothing without one", () => {
  const retour = { href: './', libelle: '← Documentation' };
  const out = page({ titre: 'T', sousTitre: 'S', sections: SECTIONS, retour });
  const link = out.indexOf('<a href="./">← Documentation</a>');
  assert.ok(link > 0 && link < out.indexOf('<h1>T</h1>'));
  assert.ok(out.includes('<section id="a"><h2>A</h2></section>'));
  const sans = page({ titre: 'T', sousTitre: 'S', sections: SECTIONS });
  assert.ok(!sans.includes('<p class="portail">'));
});
