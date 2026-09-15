# Fixture de correction — pilote `obj` (OBJ et sa bibliothèque `.mtl`)

Une fixture, une question : **ce qu'un OBJ et son `.mtl` donnent, et ce que le pilote compte sans le
rendre**. Le doré est [`../../src/tests/obj_golden.rs`](../../src/tests/obj_golden.rs) ; ce qui
demande de modifier la source entre deux compilations — bibliothèque touchée, absente, tronquée, nom
de texture à échapper — est dans [`../../src/tests/obj_mtl.rs`](../../src/tests/obj_mtl.rs).

| fichier                    | ce qu'il fixe                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minuscule/scene.obj`      | deux groupes, un quadrilatère et un pentagone, nuancés par deux `usemtl`                                                                                                             |
| `minuscule/scene.mtl`      | tout ce qu'une bibliothèque déclare : `Ka`, `Kd`, `Ks`, `Ns`, `Ni`, `d`, `Ke`, `map_Ka`, `map_Kd`, `map_d`, `norm`, `map_Bump`, `map_Ke`, et les options `-s`, `-o`, `-bm`, `-clamp` |
| `minuscule/textures/*.png` | six images 2×2 : trois entrent dans la sortie, trois prouvent un code de rapport                                                                                                     |

Ce que chaque choix met sous surveillance :

- **un pentagone** : la triangulation, trois triangles pour une face, cinq en tout avec le quad ;
- **`d 0.5` et `map_d` sur un autre fichier que `map_Kd`** : le matériau sort en `BLEND`, jamais en
  `MASK` — un transparent découpé serait une perte —, et la carte séparée que glTF ne sait pas
  porter est comptée sous `material-separate-opacity-texture` au lieu d'être avalée ;
- **`norm` et `map_Bump` visant deux fichiers différents** : la **normale l'emporte**, et le relief
  laissé derrière est compté sous `material-bump-map`. Sans cela, le « dernier gagne » du lecteur
  changeait la carte de normales sans que rien ne le dise ;
- **`Ks`, `Ni`, `Ka` et `map_Ka`** : le modèle métal-rugosité de glTF n'a de place pour aucun des
  trois. Ils sont comptés — `material-specular-color`, `material-specular-ior`,
  `material-ambient-color` — et **jamais devinés** : une couleur spéculaire ne devient pas du métal,
  ce sont deux modèles ;
- **`-clamp on` sur `map_Ke`** : la seule option de map que glTF porte telle quelle, devenue le mode
  de bord de l'échantillonneur (`wrapS` et `wrapT` à `CLAMP_TO_EDGE`) ;
- **`-s`, `-o` sur `map_Kd` et `-bm` sur `norm`** : acceptées par le lecteur puis inertes.
  L'écrivain glTF ne connaît pas `KHR_texture_transform` et rien ne porte la force d'un relief :
  elles sont comptées sous `texture-scale`, `texture-offset` et `texture-bump-scale` ;
- **`Ns 60`** : l'exposant spéculaire, qui devient bien une rugosité et n'est donc pas compté.

## Provenance et licences

- `minuscule/scene.obj` et `minuscule/scene.mtl` : écrits à la main pour ce test depuis la
  spécification publiée du format OBJ et de sa bibliothèque de matériaux, sans contenu, code ni SDK
  d'un tiers.
- `minuscule/textures/*.png` : six images 2×2 RGBA écrites pour ce test par un encodeur PNG minimal.
- Tout est **CC0-1.0**, voir [LICENSE.txt](LICENSE.txt).

## `expected.json`

Le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds, maillages, matériaux, images,
échantillonneurs, textures, accesseurs, rapport, et les fichiers externes que la lecture a ouverts
avec leur empreinte — puis la scène compilée qui en sort, sidecar compris. Ni la clé de cache ni les
durées n'y figurent : une dorée fixe une scène, jamais une horloge. `case` et `rule` ne sont que de
la prose, le test les retire avant de comparer. Pour le régénérer :

```sh
cargo test --lib regenere_la_fixture_obj -- --ignored
```
