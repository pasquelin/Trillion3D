# Fixture de correction — pilote `usdz`, conteneur

Un conteneur ne doit rien changer à la scène qu'il emballe. Le paquet porte la **même couche** que
[`../usd/corpus/usdc/scene.usdc`](../usd/corpus/usdc/scene.usdc), et le doré
([`../../src/tests/usdz_golden.rs`](../../src/tests/usdz_golden.rs)) compile les deux, compare la
seconde à la première, puis compare la première à `expected.json`.

| fichier             | ce qu'il fixe                                                                   |
| ------------------- | -------------------------------------------------------------------------------- |
| `scene.usdz`        | le paquet conforme : entrées stockées telles quelles, charges alignées sur 64 octets, une couche `usdc` et sa texture en sous-dossier |
| `compressee.usdz`   | une entrée `deflate` : refus `USDZ_LAYOUT_INVALID`, rien n'est extrait            |
| `sans-scene.usdz`   | un paquet sans couche USD : refus `SOURCE_FORMAT_UNKNOWN` par le routeur           |
| `deux-scenes.usdz`  | deux couches à la racine : refus `SOURCE_FORMAT_AMBIGUOUS`, le compilateur ne choisit pas |

Ce que chaque choix met sous surveillance :

- **la disposition du paquet** : la spécification de l'AOUSD impose des entrées stockées et alignées,
  pour que la couche et ses images se lisent en place. Un paquet qui ne l'est pas est refusé en le
  disant, plutôt que lu quand même ;
- **une texture en sous-dossier** : les URI relatives du paquet ne sont pas réécrites, le conteneur
  n'aplatit rien, et la racine où les images se résolvent est le dossier extrait ;
- **le choix de la couche racine** : ni deviné ni pris au premier venu. Aucune couche et plusieurs
  couches sont deux refus distincts, tous deux rendus par le routeur.

## Provenance et licences

- `scene.usdz` : corpus WebGeometry (`test-assets/usd/procedural-usdz`), **CC0-1.0**, voir
  [LICENSE.txt](LICENSE.txt). `test-assets/` n'est pas suivi par git : ces octets sont recopiés ici
  pour que la dorée tienne sans lui.
- `compressee.usdz`, `sans-scene.usdz` et `deux-scenes.usdz` : synthétiques, écrits pour ce test,
  sans contenu d'aucun tiers. Ils viennent d'un outil extérieur à la caisse que le pilote emploie
  pour lire — un paquet piégé doit venir d'ailleurs que du lecteur qu'il met à l'épreuve. Pour les
  régénérer depuis ce dossier :

  ```sh
  python3 - <<'PY'
  import struct, zipfile
  LAYER = b'#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n}\n'
  def aligned(archive, name, data):
      offset = archive.fp.tell()
      need = (64 - (offset + 30 + len(name.encode())) % 64) % 64
      if 0 < need < 4:
          need += 64
      entry = zipfile.ZipInfo(name)
      entry.compress_type = zipfile.ZIP_STORED
      entry.extra = b"" if need == 0 else struct.pack("<HH", 0x1986, need - 4) + b"\0" * (need - 4)
      archive.writestr(entry, data)
  with zipfile.ZipFile("compressee.usdz", "w") as a:
      e = zipfile.ZipInfo("scene.usda"); e.compress_type = zipfile.ZIP_DEFLATED
      a.writestr(e, LAYER * 40)
  with zipfile.ZipFile("sans-scene.usdz", "w") as a:
      aligned(a, "textures/checker.png", b"\x89PNG\r\n\x1a\n")
  with zipfile.ZipFile("deux-scenes.usdz", "w") as a:
      aligned(a, "premiere.usda", LAYER); aligned(a, "seconde.usda", LAYER)
  PY
  ```

## `expected.json`

Le pilote retenu, la chaîne `usdz` → `usd` publiée au rapport, les trois codes de refus, et la scène
— version de format, version du sidecar binaire, sha256 de `clusters.bin`, comptes de primitives, de
nœuds et de triangles. La clé de cache n'y figure pas : elle tient l'empreinte de toute
l'implémentation du compilateur, donc un changement sans rapport la déplacerait ; l'égalité avec la
couche nue est le vrai sujet, et elle se vérifie sur la scène intermédiaire et le sidecar. `case` et
`rule` ne sont que de la prose, le test les retire avant de comparer. Pour le régénérer :

```sh
cargo test --lib regenere_la_fixture_usdz -- --ignored
```
