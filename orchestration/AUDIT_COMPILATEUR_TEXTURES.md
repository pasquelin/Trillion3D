# Audit du compilateur natif — chantier textures progressives

Relevé du 2026-09-15 sur `packages/asset-compiler-rust`, attention portée au code introduit entre
`9a7821a` et `8ed6b8d` (20 fichiers, +1218/−13 lignes dans `src/`). Toutes les preuves sont des
lectures de source, pas des mesures : les ordres de grandeur sont annoncés comme des estimations
et aucun n'a été confirmé par une médiane de 5.

Aucun code mort, aucune dépendance Cargo inutilisée, aucun `#[allow(...)]`, aucun dépassement du
budget de 200 lignes. `cargo clippy --release --locked --all-targets -- -D warnings` : 0
avertissement. Le seuil `alphaCutoff` par défaut de 0,5 suit le défaut glTF et reste surchargeable
par matériau ; la pyramide 16×16 sur 5 niveaux est verrouillée par `TEXTURE_PREVIEW_VERSION`.

## P0 — `prune_cache` avale un sidecar de version différente

`src/manifest_binary.rs:34` porte `MANIFEST_BINARY_VERSION`, aujourd'hui à 4.
`src/manifest_binary.rs` (`digests()`) refuse bien un magic ou une version inattendue en rendant
une `Err` — mais le seul appelant l'avale : `src/compiler_prune.rs:29`
(`if let Ok(digests) = manifest_binary::digests(bytes)`) et `compiler_prune.rs:76-86`
(`… .ok().as_deref()`).

Mécanisme : après une compilation qui écrit `clusters.bin` à la version courante, `prune_cache` relit
l'autre scope (`slice`/`full`) pour décider quoi garder. Si ce scope porte encore un
`clusters.bin` d'une version antérieure, l'erreur est avalée, les objets référencés uniquement par ses
colonnes binaires (PAGE_SHA, GEOMETRY_SHA, BUNDLE_SHA) sortent de `keep`, et `prune_cache`
supprime des objets encore utilisés — sans qu'aucune erreur ne remonte à l'hôte.

Règle enfreinte : `AGENTS.md` (« Reject unknown formats; never silently interpret incompatible
cached data »). Le mécanisme est ancien — tout bump de `MANIFEST_BINARY_VERSION` y expose — mais
ce chantier est le premier à le déclencher en pratique.

*Note de relecture : l'audit d'origine situait le bump en `manifest_binary/format.rs:31` et
parlait d'un passage « 2 → 3 ». Vérifié : la constante vit en `manifest_binary.rs:34` et vaut 4.
Le mécanisme, lui, est confirmé ligne à ligne.*

Correctif attendu : échouer franchement, ou figer ce scope sans le purger avec une ligne de
rapport, quand le sidecar d'un scope non recompilé porte une autre version — plutôt que de le
lire comme « aucun objet référencé ».

## P1 — l'étape textures sort du pool rayon

`src/compiler_build.rs:49-66` construit un `rayon::ThreadPoolBuilder` à `o.threads` et compile
les primitives dedans. L'appel suivant, `compiler_build.rs:107-115`, est hors de ce pool, et
`src/texture_preview.rs:83-101` boucle en série : chaque `one_preview` décode l'image en pleine
résolution puis réduit vers 16×16 sur le seul thread appelant.

Estimation non mesurée : 232 textures couleur sur la scène de test, 8 threads employés partout
ailleurs, un seul ici. À confirmer par une médiane de 5 avant d'en tirer un chiffre.

Correctif attendu : paralléliser avec le pool déjà construit, en conservant l'ordre trié par
index de texture qu'exige `src/manifest_binary/preview.rs:10-19` — donc calcul en parallèle,
collecte et tri en série.

## P1 — copie évitable des octets d'une image déjà mappée

`src/texture_preview/source.rs:28-38` lit une tranche de mémoire déjà mappée par `memmap2`, puis
appelle `bytes.to_vec()` uniquement pour unifier son type de retour avec la branche `uri`, qui
doit vraiment lire un fichier. Les deux consommateurs, `decode()` (`texture_preview.rs:135-147`)
et `hash()` (`compiler_validate.rs:28`), acceptent un `&[u8]`.

Correctif attendu : rendre un `Cow<'a, [u8]>` (slice empruntée côté `bufferView`, `Vec` côté
`uri`) et adapter `one_preview`.

## P1 — aucune couverture dorée bout en bout pour `texturePreviews`

Les cinq fixtures de `fixtures/coplanar/` sont les seules à traverser `compile()` en entier
(`src/tests/coplanar_golden.rs`), et aucune ne porte d'image : `masked-overlay.gltf` a
`"images": []`, pas de `textures`, et son matériau MASK n'a qu'un `baseColorFactor`.
`stage_texture_previews` y produit donc toujours zéro aperçu — y compris pour la fixture MASK,
exactement le cas où `collect::color_textures` calcule un `cutoff` et où `reduce::alpha_scale`
s'exécute. Le test doré ne compare par ailleurs que `coplanar`, `depthLayerPerPage` et
`layeredObjects`.

Ce qui existe déjà couvre l'unité en éprouvette (images générées en mémoire), pas le chemin réel
glTF → `compile()` → cache → binaire.

Correctif attendu : une fixture dorée portant une vraie image liée en `baseColorTexture` d'un
matériau MASK, et une assertion sur `texturePreviews` (nombre d'entrées, provenance, extrait
déterministe du premier niveau) contre un `expected.json` versionné.

## P1 — deux verrous de dépendances suivis, un seul installé

`pnpm-lock.yaml` est suivi par git alors que `.github/workflows/quality.yml` ne fait que
`npm ci` et qu'`AGENTS.md` ne parle qu'en `npm run …`. Il reste pourtant vivant : son dernier
commit (`04fa5f0`) est postérieur à celui de `package-lock.json` (`5ae3b83`). Un second arbre de
dépendances que personne n'installe mais que quelque chose régénère encore, invisible de la CI.

Correctif attendu : supprimer le verrou perdant, ou déclarer pnpm et supprimer l'autre. Demande
un arbitrage.

## P2 — deux passages sur les mêmes pixels pour une texture MASK

`src/texture_preview/reduce.rs:37-69` (`box_reduce`) parcourt une fois tous les texels source.
Quand `cutoff.is_some()`, `reduce.rs:96-105` (`source_coverage`) reparcourt séparément les mêmes
octets bruts. Concerne le seul sous-ensemble MASK, et reste modeste devant le coût du décodage.

Correctif attendu : compter la couverture dans la boucle de `box_reduce`.

## Outillage manquant — cycles d'imports JS/TS

`eslint.config.mjs` n'a ni `eslint-plugin-import` ni règle `import/no-cycle` ; `package.json` n'a
ni `madge` ni équivalent ; aucun script `check:cycles`. La surface existe pourtant — modules ESM
à imports croisés entre `sdk-core`, `sdk-browser`, `sdk-node` et `page-codec`.

Tant qu'aucun outil n'est là, « aucun cycle d'imports nouveau » n'est pas vérifiable. Ajouter une
dépendance demande un accord préalable : ce lot commence par une question, pas par une
installation.
