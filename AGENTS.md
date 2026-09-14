# Règles du dépôt Web Geometry

Valables pour tout agent et tout contributeur, sur tout le dépôt.

- Une seule branche vivante : `develop`. Tout travail se fait dans un worktree isolé créé depuis `develop`, puis est fusionné dans `develop` après validation. Jamais de `git stash`, jamais de commit direct sur `develop` hors fusion.
- Portes de validation avant fusion : `npm test`, `npm run build`, `cargo test --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml`, `npm run build:native`, `npm run check:structure`, `npm run check:dts`, `npm run check:links` ; puis preuve navigateur : aucun trou (`tri = selected`), captures identiques à la référence ou différence expliquée au niveau du bruit A/A.
- Fidélité avant vitesse : aucune réduction de résolution, de distance ou de qualité ; un matériau transparent n'est jamais transformé en masqué ; un gain avec une image dégradée est rejeté.
- Code d'abord, une seule passe de tests à la fin, un test par comportement modifié. Pas de code mort, pas de `deprecated`, pas de compatibilité avec un format abandonné, pas de doc qui annonce ce qui n'existe pas.
- Le banc `render-tech-lab` est un hôte comme un autre : il utilise `prepare()`, `createExplorer()` et les validations publiques du SDK. Aucune ligne n'y est ajoutée pour faire marcher le moteur ; aucun agent n'écrit dans `public/benchmark-assets`.
- Les noms du système de géométrie virtualisée d'Epic et de son moteur n'apparaissent nulle part dans le dépôt. On dit « géométrie virtualisée », « DAG de clusters ».
- Mesures honnêtes : FPS = 1000 / intervalle rAF avec le plafond d'affichage indiqué ; CPU et GPU jamais additionnés ; `null` pour ce qui n'est pas mesuré ; DPR, seuil d'erreur, résolution et commit consignés.
- Plans et avancement : `orchestration/SPEC_MOTEUR_SANS_THREE.md` et `orchestration/JOURNAL.md`. Un plan terminé est supprimé.

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
