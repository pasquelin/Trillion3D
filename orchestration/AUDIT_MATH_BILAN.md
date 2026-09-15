# Audit des calculs mathématiques — bilan (15 septembre 2026)

Règle appliquée à tout : une optimisation n'est retenue que si le résultat est **identique au bit près** (banc avec l'ancien code en référence, `Object.is` / `to_bits` valeur par valeur). Un point qui change un pixel, une coupe, un ordre ou un arrondi est refusé, même s'il est plus rapide.

## Bancs commis

- `npm run bench:calculs`, `bench:calculs-c`, `bench:calculs-f`, `bench:calculs-g` : JavaScript, oracles et bancs dans `packages/sdk-browser/bench/` et `packages/sdk-core/bench/`, agrégateurs `scripts/mesure/calculs/`.
- `npm run bench:calculs:natif` (+ `-g`) : Rust, `packages/asset-compiler-rust/src/bench_calculs*/`.
- Tableaux : `orchestration/mesures/calculs-*-2026-09-15.md`.

## Résultat par lot

| Lot | Périmètre                               | Points | Retenus   | Refusés (résultat différent)                                     | Neutres / sans objet                            |
| --- | --------------------------------------- | ------ | --------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| A   | JS par image                            | 14     | 14        | 0                                                                | 0                                               |
| B   | Rust compilation                        | 12     | 7         | 0                                                                | 5 (bruit, neutre, déjà fait, rien à recalculer) |
| C   | ordre flottant                          | 7      | 3         | 4 (raster affine 809 px, préchargement, forçage, seuil mémorisé) | 0                                               |
| D   | shaders GPU                             | 7      | 4         | 1 (fusion check+mask)                                            | 2 (D3 en attente de sa campagne, D6 sans objet) |
| E   | déménagement des bancs dans les paquets | —      | —         | —                                                                | déplacement pur, validé                         |
| F   | reste par image + chargement            | 20     | 17 lignes | 4 (tri insertion NaN, `viewProj`, `uncovered`, anisotropie)      | 3 neutres, 1 déjà fait, 1 sans objet            |
| G   | passage global de vérification          | 12     | 10        | 0                                                                | 2 neutres                                       |
| H2  | décodage des pages hors fil principal + décodeur WebAssembly (`30f2b33`) | 1      | 1         | 0                                                                 | 0                                                |
| H3  | textures atlas + proxy du rebond, code fusionné par les autres sessions depuis `a59c05a` | 4      | 3         | 1 (proxy : référence conservée entre images, non appliqué)       | 0                                                |

**59 optimisations retenues, 0 pixel changé, 0 écart bit à bit.** Tests d'équivalence : un par comportement (A 61, B 8, C 3 fichiers, D 6 commits, F 69, G 8 commits, H2 32 tests). `npm run validate` vert à chaque fusion. H2 : 30 % plus rapide, identique, campagne 0 px sur 4 vues. H3 : fichiers `webgpuAtlasJobs.ts`, `webgpuTexturePriority.ts`, `proxy.rs` ; bancs `npm run bench:calculs-h3` et natif `h3_proxy`.

## Plus gros gains mesurés (Node, médianes)

| Calcul                                                         | Avant → Après (ms) |
| -------------------------------------------------------------- | ------------------ |
| urls de résidence autonome (A7)                                | 222 → 1,35         |
| `visibilityDepth`, sommets projetés une fois par triangle (A1) | 5,65 → 1,21        |
| télémétrie en tampon circulaire (A14)                          | 3,20 → 0,34        |
| occulteurs par tri radix (A3)                                  | 9,70 → 3,18        |
| étiquettes des colonnes du manifeste, Rust (G7)                | 13,8 → 0,36        |
| colonnes du manifeste binaire, Rust (B2)                       | 27,6 → 1,77        |
| renumérotation d'une page, Rust (B5)                           | 291 → 140          |
| relance sur budget (C5)                                        | 22,0 → 9,78        |
| ombrage CPU par pixel (G3)                                     | 23,5 → 15,1        |
| file d'adresses de préchargement (G6)                          | 0,96 → 0,05        |
| bandes d'un niveau vers l'atlas (H3)                            | 0,864 → 0,046      |
| primitives du proxy indexées par maillage (H3, Rust)            | 271,8 → 176,7       |
| décodage d'une page en WebAssembly, décodeur seul (H2)          | 11,8 → 8,3          |

Compilation complète d'un maillage de 500 000 triangles : 3 909 → 3 501 ms, sortie identique octet par octet.

## Harnais

`--moteur webgl2` (moteur autonome, réglage `autonomousGeometry`) disponible pour mesurer `pagesDecodedWasm` en campagne, sur un cache dont toutes les primitives sont en `exact-clusters` seulement (Emerald du Lab n'en a pas).

## Ce qui reste

- **D3** (scan préfixe parallèle du dessin indirect) : prouvé identique sur tampons GPU, pas encore couvert par une campagne navigateur ; à faire seul, chez Geometry.
- **Mesure finale des temps par image A→H** : jamais faite le 15 septembre, charge machine entre 8 et 155 toute la journée, quatre sessions en parallèle, verrou de mesure en file. Commande à lancer au calme, verrou `.claude/mesure.lock` pris (fichier `proprietaire`), charge < 4 : `node scripts/mesure/banc.mjs --moteur webgpu --avant a59c05a --apres <develop> --vues generale,sol,rue,detail --images 300 --pixelError 1 --out .mesure/finale-webgpu`, puis la même commande avec `--moteur webgl`. Develop contient aussi les lots des autres sessions depuis `a59c05a`, à préciser dans le résultat.
- **Refusés définitivement** tant que la règle est « résultat identique » : raster affine, tuilage des lampes de scène, factorisation de la BRDF, accélération du transport lumineux.
