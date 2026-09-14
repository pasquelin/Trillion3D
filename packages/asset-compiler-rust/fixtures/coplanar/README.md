# Fixtures de correction — couches coplanaires

Cinq scènes glTF minimales qui fixent le comportement de l'étape `coplanar-depth-layers-v1` du
compilateur. Chaque dossier contient la scène (`<nom>.gltf` + `<nom>.bin`) et le verdict attendu
(`expected.json`), vérifié à la main en compilant la scène avec la CLI.

Commande de vérification, depuis la racine du dépôt :

```
cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml
./packages/asset-compiler-rust/target/release/web-geometry-compiler \
  packages/asset-compiler-rust/fixtures/coplanar/<nom>/<nom>.gltf <CACHE>/<nom> full 1000000 /assets
jq '.coplanar' <CACHE>/<nom>/native/full/<clé>/clusters.json
```

`depthLayerPerPage` se lit dans la colonne 20 de `clusters.bin` (un `u32` par cluster, dans l'ordre
des primitives puis des pages), ou dans le champ `depthLayer` de chaque page avant la découpe du
manifeste.

Dans les cinq scènes, les deux maillages superposés n'ont pas la même triangulation : chaque cellule
est coupée par une diagonale différente d'un maillage à l'autre. C'est ce qui rend le gagnant
indécidable par la profondeur seule, et c'est la raison d'être de l'étape.
