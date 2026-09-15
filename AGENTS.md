# Règles du dépôt Web Geometry

Valables pour tout agent et tout contributeur, sur tout le dépôt.

- Pendant le développement, `npm run check:changed` vérifie le format, le lint, la limite de lignes et les doublons des fichiers modifiés puis lance les tests unitaires reliés par les imports ; `npm run test:changed` ne lance que ces tests. Après suppression, changement d'export public ou de configuration, examiner aussi les dépendants et lancer les contrôles pertinents. Ces commandes ne remplacent pas la validation finale.
- Portes de validation avant fusion : `npm run validate` (format, lint JS/TS et Clippy, code/fichiers/dépendances inutilisés, build TS et natif, structure, déclarations, liens, tests JS/TS et Rust) ; puis preuve navigateur : aucun trou (`tri = selected`), captures identiques à la référence ou différence expliquée au niveau du bruit A/A.
- Fidélité avant vitesse : aucune réduction de résolution, de distance ou de qualité ; un matériau transparent n'est jamais transformé en masqué ; un gain avec une image dégradée est rejeté.
- Moteur générique, pas de scène cible : il y aura des milliards de scènes. Emerald, la maison de test ou tout autre banc ne sont que des jeux de mesure. Aucun code du moteur ne nomme une scène, ne place une lampe ou une caméra à la main, ni ne traite un objet par son type (« miroir », « eau », « arbre »). Tout se code par propriété de matériau et de lampe déclarée dans les données importées : une seule façon d'éclairer toute surface, opaque ou transparente, une seule façon de réfléchir sur toute surface réfléchissante. Une règle prouvée sur un banc doit valoir pour n'importe quelle scène importée.
- Code d'abord, une seule passe de tests à la fin, un test par comportement modifié. Pas de code mort, pas de `deprecated`, pas de compatibilité avec un format abandonné, pas de doc qui annonce ce qui n'existe pas.
- Aucun fichier source maintenu (`.js`, `.mjs`, `.ts`, `.mts`, `.rs` et variantes) ne dépasse 200 lignes physiques. Pas d'exception historique : découper par responsabilité et garder les contrats publics cohérents. `npm run check:lines` est une porte de validation.
- `npm run check:duplicates` détecte les blocs dupliqués entre JS, TS et Rust (au moins 12 lignes et 100 tokens) et échoue s'il en trouve. Tout bloc signalé doit être résolu avant intégration ; extraire une logique commune uniquement lorsque les comportements sont réellement identiques.
- Le banc `render-tech-lab` est un hôte comme un autre : il utilise `prepare()`, `createExplorer()` et les validations publiques du SDK. Aucune ligne n'y est ajoutée pour faire marcher le moteur ; aucun agent n'écrit dans `public/benchmark-assets`.
- Les noms du système de géométrie virtualisée d'Epic et de son moteur n'apparaissent nulle part dans le dépôt. On dit « géométrie virtualisée », « DAG de clusters ».
- Mesures honnêtes : FPS = 1000 / intervalle rAF avec le plafond d'affichage indiqué ; CPU et GPU jamais additionnés ; `null` pour ce qui n'est pas mesuré ; DPR, seuil d'erreur, résolution et commit consignés.
- Orchestration : dans `orchestration/`, une reprise par session (`REPRISE_<SESSION>.md`, instructions et état courant) et les plans ouverts (`SPEC_*.md`). Aucun journal, historique, récit ni catalogue : l'historique est git. Aucun fichier d'orchestration au-delà de 200 lignes. Un plan terminé est supprimé.

## Règles des paquets (`packages/`)

These rules supplement repository-wide instructions; they do not replace them.

- Keep React, Electron, Vite, DOM and platform filesystem APIs out of runtime-core and shared contracts. Put browser and filesystem concerns in their named adapters.
- Consume public entry points. Do not import application internals from a package.
- Keep formatVersion separate from compilerVersion. Reject unknown formats; never silently interpret incompatible cached data.
- Any change to the compiler or cache identity needs correctness fixtures and source provenance. Never overwrite source assets.
- Record a before/after baseline on the same input, camera, quality, machine and resource budget. Unknown metrics are null, not estimates labeled as measured.
- Keep diagnostics outside measured beauty passes. Report unsupported capabilities explicitly.
- Target constrained machines too. Bound worker counts and allocation; distinguish admission estimates from enforced RSS limits.
- New pipeline stages need versioned contracts, cancellation, observable work and failure semantics. Do not bury algorithms in the CLI or UI.
- All generic Rust library/CLI code belongs under packages/, never inside a numbered benchmark. `test/engineStructure.test.mjs` enforces the core/adapters import restrictions in the normal test suite; `npm run check:structure` also type-checks sdk-core without DOM libraries.

## Règles du compilateur natif (`packages/asset-compiler-rust`)

Keep the CLI thin. Algorithms belong in the library behind versioned strategy/stage contracts. Check cancellation at bounded work boundaries, preserve triangle/material identity, validate every persisted cache entry, and retain golden fixtures and raw before/after timing evidence. Do not claim unimplemented simplification, compression, hard memory enforcement, N-API bindings or a platform release as delivered.
