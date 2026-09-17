# Fixture de correction — pilote `zip`, conteneur

Un conteneur ne doit rien changer à la scène qu'il emballe. La fixture est donc double : la même
scène glTF **dans** son archive et **hors** d'elle. Le doré (`../../src/tests/zip_golden.rs`)
compile les deux par le harnais commun, compare la seconde à la première — clé de cache comprise,
ce qui prouve que les deux compilations n'en font qu'une — puis compare la première à
`expected.json`.

| fichier                    | ce qu'il fixe                                                            |
| -------------------------- | ------------------------------------------------------------------------ |
| `scene.zip`                | l'archive : un unique dossier racine `scene/`, un `.gltf`, son `.bin` et une texture en sous-dossier |
| `hors-archive/`            | le contenu de `scene.zip`, extrait une fois pour toutes : la même scène sans conteneur |
| `sortie-de-dossier.zip`    | une entrée `../escape.gltf` : la sortie du dossier d'extraction, refusée `ARCHIVE_PATH_ESCAPE` |
| `tronquee.zip`             | 31 des 4 406 octets de `scene.zip` : l'index central manque, refus `ARCHIVE_UNREADABLE` |
| `vide.zip`                 | les 22 octets d'une archive sans entrée : refus `ARCHIVE_EMPTY`           |

Ce que chaque choix met sous surveillance :

- **un dossier racine unique** : l'archive livre `scene/`, le pilote le traverse et route son
  contenu ; une racine d'emballage ne doit jamais devenir un niveau de la scène ;
- **un buffer externe** (`geometry.bin`) : les fichiers voisins du glTF sont extraits et relus au
  même endroit, sinon le manifeste de la source ne se recalcule pas à l'identique ;
- **une texture en sous-dossier** (`textures/checker.png`) : les URI relatives de l'archive ne sont
  pas réécrites, le conteneur n'aplatit rien ;
- **les trois archives piégées** : chacune est refusée par son propre code, et rien n'est extrait.

## Provenance et licences

- `scene.zip`, `tronquee.zip` et `hors-archive/` : corpus WebGeometry
  (`test/assets/archives/gltf-nested-zip` et `test/assets/limites/truncated-zip`), **CC0-1.0**, voir
  [LICENSE.txt](LICENSE.txt). `test/assets/` n'est pas suivi par git : ces octets sont recopiés ici
  pour que la dorée tienne sans lui.
- `sortie-de-dossier.zip` et `vide.zip` : synthétiques, écrits pour ce test, sans contenu d'aucun
  tiers. Ils se régénèrent par

  ```sh
  python3 -c "import zipfile; zipfile.ZipFile('vide.zip','w').close()"
  python3 -c "import zipfile; z=zipfile.ZipFile('sortie-de-dossier.zip','w'); z.writestr('../escape.gltf','{\"asset\":{\"version\":\"2.0\"}}'); z.close()"
  ```

  Ils sont écrits par un outil extérieur, et non par la caisse que le pilote utilise pour lire :
  une archive piégée doit venir d'ailleurs que du lecteur qu'elle met à l'épreuve.

## `expected.json`

Le pilote retenu, la chaîne `zip` → pilote interne publiée au rapport, les trois codes de refus, et
la scène — version de format, version du sidecar binaire, sha256 de `clusters.bin`, comptes de
primitives, de nœuds et de triangles. La clé de cache n'y figure pas : elle tient l'empreinte de
toute l'implémentation du compilateur, donc un changement sans rapport la déplacerait. Elle sert à
l'égalité des deux compilations, qui est le vrai sujet. `case` et `rule` ne sont que de la prose, le
test les retire avant de comparer.
