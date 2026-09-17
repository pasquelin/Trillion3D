# Fixtures de correction — pilote `usd`

Deux fixtures, deux questions distinctes. Le doré est
[`../../src/tests/usd_golden.rs`](../../src/tests/usd_golden.rs) ; les comportements isolés sont dans
`usd_driver.rs`, ce qui est compté au rapport dans `usd_rapport.rs`, les refus durs dans
`usd_refus.rs`.

| fichier                      | ce qu'il fixe                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `minuscule/scene.usda`       | ce que le pilote produit : hiérarchie `Xform`, `Mesh` à deux quads, `GeomSubset` `materialBind`, deux matériaux dont un texturé |
| `minuscule/textures/checker.png` | la texture que le matériau translucide cite, résolue relativement au dossier de la couche |
| `corpus/usda/scene.usda`     | la même scène que `corpus/usdc`, en texte                                          |
| `corpus/usdc/scene.usdc`     | la même scène que `corpus/usda`, en binaire « crate »                             |

Ce que chaque choix met sous surveillance :

- **deux quadrilatères et un sous-ensemble d'une face** : la triangulation en éventail, et le fait
  qu'une partie de matériau devient une primitive glTF à part — les faces qu'aucun sous-ensemble ne
  réclame revenant à la liaison du maillage ;
- **une normale `constant` et une `primvars:st` `vertex`** : les deux répartitions d'une primvar ne
  se résolvent pas au même rang du tableau, et c'est ce rang qui déduplique les sommets ;
- **un `UsdPreviewSurface` opaque et un autre à `opacity` 0,5 et texture** : `baseColorFactor`,
  `alphaMode` et l'emplacement de texture, sans qu'aucune règle ne nomme un type d'objet ;
- **la même scène en `usda` et en `usdc`** : les deux sérialisations doivent donner la **même**
  scène intermédiaire, au nœud et à l'octet du sidecar près. C'est la seule preuve qui vaille que le
  pilote lit un document et non une écriture. Trois cubes, trois matériaux, trente-six triangles.

## Provenance et licences

- `corpus/` : corpus WebGeometry (`test/assets/usd/procedural-usda` et `procedural-usdc`),
  **CC0-1.0**, voir [LICENSE.txt](LICENSE.txt). `test/assets/` n'est pas suivi par git : ces octets
  sont recopiés ici pour que la dorée tienne sans lui.
- `minuscule/scene.usda` : écrit à la main pour ce test depuis la spécification publique de l'AOUSD,
  sans contenu d'aucun tiers. `minuscule/textures/checker.png` vient du même corpus CC0.

## `expected.json`

Le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds, maillages, matériaux, images,
échantillonneurs, textures, accesseurs, rapport — et la scène compilée qui en sort, sidecar compris.
La clé de cache n'y figure pas : le manifeste d'une scène convertie porte sa durée d'import, donc la
clé change d'un passage à l'autre sans que la scène bouge. `case` et `rule` ne sont que de la prose,
le test les retire avant de comparer. Pour le régénérer :

```sh
cargo test --lib regenere_la_fixture_usd -- --ignored
```
