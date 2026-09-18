// Preuve par le rendu réel : l'image tenue WebGL ne retouche pas la couleur. Les pixels du canevas
// sont relus juste après l'image complète, puis après plusieurs images tenues, avec et sans lampe.
//
// Avant le correctif, la copie du tampon de dessin était présentée sans espace couleur déclaré et
// avec la correction de tonalité active : des valeurs déjà encodées étaient relues comme linéaires
// puis réencodées, et l'image tenue s'éclaircissait à chaque présentation.
//
//   node --experimental-strip-types test/browser/image-tenue-couleur.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage } from '../appui/preuvePageMoteur.mjs';

const resultat = await preuveDansLaPage(
  'imageTenueCouleurPage.mjs',
  'imageTenueCouleur',
  'Image tenue WebGL et chaîne couleur',
);
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
assert.deepEqual(resultat.erreurs, []);

const cas = resultat.cas ?? [];
assert.equal(cas.length, 2, 'la preuve mesure le cas sans lampe et le cas éclairé');
for (const { eclairee, complete, tenues } of cas) {
  const nom = eclairee ? 'avec lampe' : 'sans lampe';
  // La preuve ne vaut que si l'image complète n'est pas uniformément noire ou blanche : sans écart
  // entre ses points, une réencodage passerait inaperçu.
  assert.ok(
    new Set(complete.map((px) => px.join(','))).size > 1,
    `${nom} : l'image complète n'a qu'une seule valeur, la preuve serait vide`,
  );
  for (const [rang, tenue] of tenues.entries())
    assert.deepEqual(tenue, complete, `${nom} : l'image tenue ${rang} diffère de l'image complète`);
}
