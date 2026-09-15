# Fixture de correction — aperçus progressifs des textures couleur

Une scène glTF minuscule qui fixe la section `texturePreviews` du compilateur de bout en bout :
glTF réel → `compile()` → cache → colonnes `texturePreview*` de `clusters.bin`. Les tests en
éprouvette de `../../src/texture_preview/tests/` fixent la math sur des images construites en
mémoire ; celui-ci fixe les octets qu'un moteur lira vraiment, décodeur PNG et décodeur JPEG
compris.

## `atlas-couleur`

Quatre quads de deux triangles, écartés de trois unités pour qu'aucune paire ne soit coplanaire —
la scène ne parle que de textures.

| primitive | matériau | classe | texture couleur |
| --- | --- | --- | --- |
| 0 | `beton` | opaque | `baseColorTexture` → texture 0 |
| 1 | `grille` | `MASK`, `alphaCutoff` **0,25** | `baseColorTexture` → texture 1 |
| 2 | `vitre` | `BLEND` | `baseColorTexture` → texture 2 |
| 3 | `lampe` | opaque, émissif | `emissiveTexture` → **texture 2**, partagée avec `vitre` |

| image | fichier | provenance | dimensions | premier niveau porté | niveaux |
| --- | --- | --- | --- | --- | --- |
| 0 | `base-degrade.png` | `uri` | 40 × 24 | 0 | 6 |
| 1 | — | `bufferView` 6 de `atlas-couleur.bin` | 24 × 16 | 0 | 5 |
| 2 | `lueur.jpg` | `uri` | 80 × 48 | **1** | 6 |

Ce que chaque choix met sous surveillance :

- **40 × 24** n'est ni carré ni multiple de seize : les cases de la moyenne de boîte n'ont pas
  toutes la même taille et le dernier niveau s'atteint par troncature.
- **80 × 48** est la seule image dont un côté dépasse `PREVIEW_BASE` : son premier niveau porté est
  le mip 1, jamais le mip 0. C'est aussi le seul JPEG, donc le second décodeur.
- **24 × 16 à alpha strictement binaire** (une ellipse centrée, couverture exactement 192 texels
  sur 384) est la seule texture dont toutes les liaisons sont des couleurs de base `MASK` : c'est
  la seule dont l'alpha est remis à l'échelle pour préserver cette couverture. Les deux autres
  gardent leur alpha intact, ce que `coveredAtMaskCutoff` de `expected.json` montre en restant égal
  au nombre total de texels de chaque niveau.
- **La texture 2 est partagée** entre un `BLEND` et un émissif : aucune de ses liaisons n'est un
  `MASK`, donc aucun seuil ne s'y applique.
- **Une image par `uri`, une par `bufferView`** : les deux chemins de lecture des octets sources.

## `expected.json`

Pour chaque entrée du sidecar : les dix nombres qu'elle déclare, le condensé de son image source,
puis chaque niveau avec ses dimensions, le **sha256 de tous ses octets**, cinq texels (quatre coins
et centre) et sa couverture au seuil du matériau `MASK`. Le sha256 fait rougir le doré dès qu'un
octet d'aperçu change ; les texels et la couverture disent *où* le calcul a bougé. `case` et `rule`
ne sont que de la prose, le test les retire avant de comparer.

## Régénérer

La scène, ses images et son attendu sortent tous du même code, `../../src/tests/apercus_source.rs` :

```
cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
  -- --ignored regenere_la_fixture_des_apercus --nocapture
npx prettier --write packages/asset-compiler-rust/fixtures/apercus/atlas-couleur/expected.json
```

Le test qui l'écrit est ignoré par défaut. **Le diff qu'il produit se relit avant d'être commité** :
un attendu régénéré sans lecture ne surveille plus rien. Les octets d'un JPEG décodé dépendent du
décodeur : un changement de version de la caisse `image` demande de régénérer, et de justifier
l'écart dans le message de commit.
