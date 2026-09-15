# Backlog

Format d'une entrée : priorité, preuve `fichier:ligne`, règle enfreinte, date d'apparition. Une
entrée sans preuve n'entre pas.

## P0

### P0 · cache/provenance · `prune_cache` avale silencieusement un sidecar de version différente

- **État** : **en revue** — branche `loop-code/p0-prune-cache` (depuis `develop` à `4d466dd`),
  worktree `.claude/worktrees/agent-ac1babe36eb77551a`, non fusionnée. La purge refuse désormais un
  sidecar absent ou d'une autre version binaire (`CompilerError` code `UNSUPPORTED_FORMAT`) et ne
  supprime rien ; test `tests::part7::a_sidecar_of_another_version_stops_the_prune_without_removing_anything`.
- **Preuve** : `packages/asset-compiler-rust/src/manifest_binary/format.rs:31` bascule
  `MANIFEST_BINARY_VERSION` de 2 à 3 (chantier textures progressives). Le lecteur
  `packages/asset-compiler-rust/src/manifest_binary.rs:156-161` (`digests()`) refuse bien un
  magic ou une version différente en rendant une `Err`. Mais l'appelant avale cette erreur sans
  distinction : `packages/asset-compiler-rust/src/compiler_prune.rs:29`
  (`if let Ok(digests) = manifest_binary::digests(bytes) { into.extend(digests); }`) et
  `compiler_prune.rs:76-86` (`fs::read(entry.path().join(MANIFEST_BINARY_FILE)).ok().as_deref()`
  pour le scope qui n'est pas celui qu'on vient de compiler). Recherche collée :
  `grep -rn "manifest_binary::digests" packages/asset-compiler-rust/src` → un seul appelant,
  `compiler_prune.rs:29`, aucun traitement dédié du cas `Err`.
- **Mécanisme** : après une compilation qui écrit `clusters.bin` en version 3 (ce chantier),
  `prune_cache` relit aussi l'autre scope (`slice`/`full`, celui qu'on n'a pas recompilé) pour
  décider quels objets garder (`referenced_objects`, `compiler_prune.rs:3-30`). Si ce scope
  porte encore un `clusters.bin` en version 2 (compilé avant ce chantier), `digests()` échoue,
  l'erreur est avalée par `if let Ok` / `.ok()`, et les objets référencés uniquement par les
  colonnes binaires (PAGE_SHA, GEOMETRY_SHA, BUNDLE_SHA) de ce scope ne sont plus comptés dans
  `keep`. `prune_cache` peut alors supprimer des objets encore utilisés par ce scope, cassant son
  cache sans qu'aucune erreur ne remonte à l'appelant ni à l'hôte.
- **Règle enfreinte** : `AGENTS.md:23` (« Keep formatVersion separate from compilerVersion.
  Reject unknown formats; never silently interpret incompatible cached data. ») — ici l'absence
  de traitement explicite d'un format incompatible avant une suppression est silencieuse ; l'effet
  (perte d'objets persistés d'un cache encore valide) est celui que la règle interdit.
  `references/core/gates.md` catégorie P0 : « perd du travail ».
- **Apparue le** : 2026-09-15, audit `loop-code-auditor` sur `packages/asset-compiler-rust`,
  commit `753d8ab` (branche visant `develop` à `8ed6b8d`). Le mécanisme est ancien (tout bump de
  `MANIFEST_BINARY_VERSION` y est exposé), mais ce chantier est le premier qui le déclenche en
  pratique depuis le passage en v2.
- **Ce que corrige ce lot** : faire échouer fort `prune_cache` (ou figer explicitement ce scope
  sans le purger, avec une ligne de rapport) quand le sidecar d'un scope non recompilé porte une
  `MANIFEST_BINARY_VERSION` différente de celle qu'on vient d'écrire, plutôt que de le traiter
  comme « aucun objet référencé ». Sujet unique : ce garde-fou, rien d'autre.

### P0 · outillage · cycles d'imports JS/TS

- **Preuve** : `eslint.config.mjs` (racine) — aucun plugin `eslint-plugin-import`, aucune règle
  `import/no-cycle` ; `package.json` — aucune dépendance `madge` ni équivalent ; recherche
  `grep -r madge package.json` et lecture de `eslint.config.mjs` en entier, 0 résultat.
- **Règle enfreinte** : `references/core/gates.md` #16 et `references/core/gate-merge.md` point
  16 — « aucun cycle d'imports nouveau » doit être rejouable à chaque lot avec une commande
  exacte ; `references/core/capacites.md` — un gate dont la surface existe (modules ESM avec
  imports croisés dans `packages/sdk-core`, `sdk-browser`, `sdk-node`, `page-codec`) et dont
  l'outil manque est NON VÉRIFIABLE, jamais N/A, et génère ce lot P0 automatiquement.
- **Apparue le** : 2026-09-15, `/loop-code init`.
- **Ce que corrige ce lot** : ajouter un outil de détection de cycles d'imports JS/TS (candidat :
  `eslint-plugin-import` + règle `import/no-cycle`, ou `madge --circular`) et l'exposer comme
  script npm dédié (`check:cycles` ou intégré à `lint`). **Ajouter une dépendance nouvelle exige
  un accord explicite de l'utilisateur** (`~/.claude/shared/escalade.md`, point 4) : ce lot
  commence par une escalade, pas par une installation.

## P1

### P1 · performance · `stage_texture_previews` rompt le parallélisme rayon du reste du pipeline

- **Preuve** : `packages/asset-compiler-rust/src/compiler_build.rs:49-66` construit un
  `rayon::ThreadPoolBuilder` à `o.threads` et compile les primitives avec
  `pool.install(|| jobs.par_iter().map(...).collect())`. L'appel à l'étape textures, juste après,
  n'est pas dans ce pool : `compiler_build.rs:107-115`
  (`texture_preview::stage_texture_previews(&texture_preview::PreviewInputs { ... })?`). À
  l'intérieur, `packages/asset-compiler-rust/src/texture_preview.rs:83-101`
  (`stage_texture_previews`) boucle en série — `for entry in &wanted { check(inputs.o)?; ...
  one_preview(...) }` — et chaque `one_preview` (texture_preview.rs:107-131) décode l'image en
  pleine résolution (`decode`, texture_preview.rs:135-147) puis réduit vers 16×16
  (`reduce::pyramid`, texture_preview/reduce.rs:11-33) sur le seul thread appelant.
- **Ordre de grandeur (estimation, pas une mesure)** : Emerald compte 232 textures couleur
  candidates. Le reste de la compilation utilise 8 threads (`o.threads`, voir
  `.agents/loop-profile.md`) pendant que cette étape en utilise un seul. Si chaque
  décodage+réduction coûte, par exemple, 5 à 20 ms selon la taille des PNG/JPEG sources, la
  section représente environ 1 à 5 s de temps mur non recouvert sur un total mesuré de
  `wallMs` 22136 (voir `.agents/loop-profile.md`, section « Mesure du compilateur natif »), soit
  de l'ordre de 5 à 20 % du temps total — à confirmer par une vraie médiane de 5, pas ici.
- **Règle enfreinte** : `references/core/gates.md` point 8 (mesure de performance du lot) et la
  checklist de cet audit, point 4 — décodage séquentiel repéré et quantifié par lecture, pas par
  supposition ; incohérence avec le reste du fichier qui utilise déjà rayon pour un travail de
  même nature (par texture / par primitive, indépendant).
- **Apparue le** : 2026-09-15, audit `loop-code-auditor`, commit `753d8ab`.
- **Ce que corrige ce lot** : paralléliser `stage_texture_previews` avec le pool rayon déjà
  construit (ou un `par_iter` dédié), en conservant l'ordre trié par index de texture qu'exige
  `manifest_binary/preview.rs:10-19` (`encode_previews` rejette un ordre non strictement
  croissant) — donc paralléliser le calcul, puis trier/collecter en série. Sujet unique : ce
  parallélisme, rien d'autre.

### P1 · performance/allocations · copie inutile des octets d'une image `bufferView` déjà mappée

- **Preuve** : `packages/asset-compiler-rust/src/texture_preview/source.rs:28-38` lit une tranche
  de `inputs.bin` (mémoire déjà mappée par `memmap2`, voir `.agents/loop-profile.md`) puis appelle
  `bytes.to_vec()` (ligne 38) pour la retourner — une copie complète, uniquement pour unifier le
  type de retour `Vec<u8>` avec la branche `uri` qui doit, elle, lire un fichier
  (`fs::read`, ligne 49). Les deux seuls consommateurs de ces octets, `decode()`
  (`texture_preview.rs:135-147`) et `hash()` (`compiler_validate.rs:28`), acceptent un `&[u8]` :
  aucun des deux n'a besoin de la possession.
- **Ordre de grandeur (estimation)** : sur Emerald, si une majorité des 232 textures couleur sont
  embarquées en `bufferView` (cas probable pour un export empaqueté) avec une taille moyenne de
  l'ordre du mégaoctet, cela représente environ 100 à 300 Mo de copie mémoire évitable par
  compilation complète — à mesurer avant de conclure à un gain observable.
- **Règle enfreinte** : checklist de cet audit, point 4 (« allocations répétées ... copies de
  tampons »).
- **Apparue le** : 2026-09-15, audit `loop-code-auditor`, commit `753d8ab`.
- **Ce que corrige ce lot** : remplacer le retour `Vec<u8>` de `image_bytes` par un
  `Cow<'a, [u8]>` (ou une slice empruntée côté `bufferView`, un `Vec` côté `uri`), et adapter
  `one_preview` en conséquence. Sujet unique : ce type de retour, rien d'autre.

### P1 · tests · aucune couverture dorée bout en bout pour `texturePreviews`

- **Preuve** : les cinq fixtures de `packages/asset-compiler-rust/fixtures/coplanar/`
  (`three-stack`, `full-overlap`, `partial-overlap`, `masked-overlay`, `blend-overlay`), seules
  fixtures dorées du dépôt à passer par `compile()` au complet
  (`packages/asset-compiler-rust/src/tests/coplanar_golden.rs:1-104`), n'ont **aucune** image :
  vérifié sur `fixtures/coplanar/masked-overlay/masked-overlay.gltf` —
  `"images": []`, `"textures"` absent, matériau `grate` en `alphaMode: "MASK"` mais sans
  `baseColorTexture` (seulement `baseColorFactor`). `stage_texture_previews` y produit donc
  toujours zéro aperçu (`wanted.len() == 0`, `texture_preview.rs:86`), y compris pour la fixture
  MASK — exactement le cas où `collect::color_textures` calcule un `cutoff`
  (`texture_preview/collect.rs:30-45`) et où `reduce::alpha_scale` s'exécute
  (`texture_preview/reduce.rs:110-135`). Le test doré lui-même ne compare que les champs
  `coplanar`/`depthLayerPerPage`/`layeredObjects` (`coplanar_golden.rs:80-100`) : la section
  `texturePreviews` de `clusters.json` et les colonnes `TEXTURE_PREVIEW_*` de `clusters.bin` n'y
  sont jamais vérifiées.
- **Ce qui existe déjà** : `texture_preview/tests/*.rs` (8 fichiers, 624 lignes cumulées) et
  `manifest_binary/preview_tests.rs` (92 lignes) couvrent la logique en éprouvette — images
  générées en mémoire (`rgba_from`, `texture_preview/tests/mod.rs:40-46`), pas le chemin complet
  glTF réel → `compile()` → cache → binaire, et pas avec un matériau MASK réel piloté par
  `alphaCutoff`.
- **Règle enfreinte** : checklist de cet audit, point 5 ; `references/core/archi-tests.md` («
  les tests accompagnent le code dans le même mouvement » — ici le mouvement a couvert l'unité,
  pas l'intégration dorée que le dépôt tient déjà pour le reste du pipeline coplanar).
- **Apparue le** : 2026-09-15, audit `loop-code-auditor`, commit `753d8ab`.
- **Ce que corrige ce lot** : ajouter une fixture dorée (nouvelle, ou variante de
  `masked-overlay`) portant une vraie image liée en `baseColorTexture` d'un matériau MASK, et
  étendre `coplanar_golden.rs` (ou un test doré dédié) pour comparer `texturePreviews` — au moins
  le nombre d'entrées, la provenance, et un extrait déterministe des octets de premier niveau —
  à un `expected.json` versionné. Sujet unique : cette fixture et son assertion, rien d'autre.

## P2

### P2 · performance mineure · deux passes complètes sur les mêmes pixels pour une texture MASK

- **Preuve** : `packages/asset-compiler-rust/src/texture_preview/reduce.rs:37-69` (`box_reduce`)
  parcourt une fois tous les texels source (une partition disjointe de l'image, donc un passage
  O(largeur×hauteur)). Quand `cutoff.is_some()`, `texture_preview/reduce.rs:96-105`
  (`source_coverage`) reparcourt séparément les mêmes octets bruts (`source.as_raw()`) pour
  calculer la couverture cible — un second passage O(largeur×hauteur) sur la même image, visible
  à l'appel `texture_preview/reduce.rs:20` (`cutoff.map(|threshold| source_coverage(source,
  threshold))`).
- **Ordre de grandeur** : concerne seulement les textures liées à un matériau MASK (sous-ensemble
  des 232 d'Emerald) ; double la lecture mémoire séquentielle de l'image source pour ce
  sous-ensemble — modeste comparé au coût du décodage PNG/JPEG lui-même.
- **Règle enfreinte** : checklist de cet audit, point 4.
- **Apparue le** : 2026-09-15, audit `loop-code-auditor`, commit `753d8ab`.
- **Ce que corrige ce lot** : calculer la couverture cible dans la même boucle que `box_reduce`
  (un compteur additionnel sur les mêmes texels visités) au lieu d'un second parcours dédié.
  Sujet unique : cette fusion, rien d'autre.
