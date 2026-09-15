# Fixture de correction — pilote `ma` (Maya ASCII)

Une fixture, une question : **ce que le pilote produit d'un fichier de commandes MEL, et ce qu'il
refuse d'en faire**. Le doré est [`../../src/tests/ma_golden.rs`](../../src/tests/ma_golden.rs) ; les
comportements que seul l'intérieur du pilote prouve — découpage du texte, écriture d'un attribut par
tranches, résolution d'un coin par son arête — sont dans
[`../../src/plugins/scene/ma/tests.rs`](../../src/plugins/scene/ma/tests.rs).

| fichier                          | ce qu'il fixe                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `minuscule/scene.ma`             | la scène : hiérarchie `transform`, `mesh` à deux quadrilatères, deux groupes de faces nuancés, instance par `parent -add`, `lambert` et `standardSurface` dont un texturé |
| `minuscule/textures/checker.png` | la texture que le `standardSurface` cite, résolue relativement au dossier de la source               |

Ce que chaque choix met sous surveillance :

- **une face qui réutilise l'arête d'une autre à l'envers** (`f 4 -3 4 5 6`) : une face Maya cite ses
  **arêtes**, et le coin de rang `k` est le sommet de départ de la `k`-ième — le second sommet quand
  l'indice est écrit négatif. C'est la règle la plus facile à lire de travers de tout le format ;
- **deux quadrilatères** : la triangulation en éventail, quatre triangles pour deux faces ;
- **deux `objectGrpCompList` d'une face chacune** : un `instObjGroups` par groupe de faces devient
  une primitive glTF à part, et aucune face n'est dessinée deux fois ;
- **aucune normale écrite** : elles sont calculées à plat, une par face, et le rapport le dit ;
- **`currentUnit -l centimeter`** : le facteur `0,01` vers le mètre, porté par la racine de la scène,
  et non appliqué aux sommets ;
- **une rotation de 90° avec `rotateOrder`** : la matrice locale, composée dans l'ordre déclaré ;
- **`parent -add -s`** : une seconde pose de la même forme cite le **même** maillage glTF ;
- **un `lambert` opaque et un `standardSurface` à `opacity` 0,5, métal, texture de couleur et
  émission** : `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `alphaMode` et l'emplacement
  de texture, sans qu'aucune règle ne nomme un type d'objet ;
- **une caméra, un `select` sur un nœud absent du fichier, et une commande `python`** : ce que le
  pilote **compte sans le rendre**. La commande `python` est la preuve écrite du contrat de sûreté :
  son texte entre dans le rapport sous `ma-command-ignored:python`, et rien ne l'exécute.

## Provenance et licences

- `minuscule/scene.ma` : écrit à la main pour ce test depuis la documentation publique des commandes
  MEL d'Autodesk, sans contenu, code ni SDK d'un tiers.
- `minuscule/textures/checker.png` : recopié du corpus WebGeometry, **CC0-1.0**, voir
  [LICENSE.txt](LICENSE.txt).

## `expected.json`

Le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds, maillages, matériaux, images,
échantillonneurs, textures, accesseurs, rapport — et la scène compilée qui en sort, sidecar compris.
La clé de cache n'y figure pas : le manifeste d'une scène convertie porte sa durée d'import, donc la
clé change d'un passage à l'autre sans que la scène bouge. `case` et `rule` ne sont que de la prose,
le test les retire avant de comparer. Pour le régénérer :

```sh
cargo test --lib regenere_la_fixture_ma -- --ignored
```
