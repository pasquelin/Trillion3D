# loop-profile

Généré le 2026-09-15 11:25 par `/loop-code init` · skills v1

Dépôt : `/Users/pasquelin/Applications/webGeometry` · branche `loop-code-init` (créée depuis
`develop`, commit `2f4224e`) · audit demandé centré sur `packages/asset-compiler-rust`, scène
Emerald, baseline `9a7821a` (avant le chantier « textures progressives »).

## Outillage

| Rôle | Commande exacte | Vérifiée |
|---|---|---|
| gestionnaire de paquets | npm (lockfile: `package-lock.json`) — `pnpm-lock.yaml` est aussi présent et suivi par git, mais `AGENTS.md` et tous les scripts documentés parlent en `npm run …` : npm fait foi, voir Contradictions | oui |
| gestionnaire de paquets (Rust) | cargo (lockfile: `packages/asset-compiler-rust/Cargo.lock`) | oui |
| typecheck | `npm run build` (tsc `tsconfig.json`) ; `npm run check:structure` inclut `tsc -p tsconfig.core.json --noEmit` sur sdk-core sans DOM | oui |
| lint | `npm run lint` = `eslint .` puis `cargo clippy --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml --all-targets -- -D warnings` | oui |
| test | `npm test` (Node `--test`, JS/TS) ; `npm run test:native` (`cargo test --release --locked`) | oui |
| build | `npm run build` (tsc + réécriture `.d.ts` + provenance) | oui |
| build natif | `npm run build:native` = `cargo build --release --locked --manifest-path packages/asset-compiler-rust/Cargo.toml` → `packages/asset-compiler-rust/target/release/web-geometry-compiler` | oui |
| package | absent — voir Capacités (N/A, raison donnée) | — |
| e2e | pas de commande dédiée ; couvert par `npm test` via `packages/sdk-node/*.test.mjs` qui font tourner le vrai binaire compilé (`prepare`, `prepareMany`) en sous-processus | oui |
| analyse de bundle | absente — voir Capacités (N/A, raison donnée) | — |
| format | `npm run format:check` = `prettier --check "**/*.{js,cjs,mjs,ts,mts,tsx,json}"` puis `cargo fmt --all --manifest-path packages/asset-compiler-rust/Cargo.toml -- --check` | oui |
| lignes (budget 200) | `npm run check:lines` (`scripts/check-file-lines.mjs`, source `\.(?:[cm]?js\|[cm]?ts\|jsx\|tsx\|rs)$`) | oui |
| duplication | `npm run check:duplicates` = `jscpd packages scripts test --format typescript,javascript,rust --cross-formats js-ts --min-lines 12 --min-tokens 100 --reporters console --exit-code 1 --no-tips` | oui |
| code mort JS/TS | `npm run check:unused` = `knip` | oui |
| code mort Rust | inclus dans `npm run lint` (`cargo clippy -D warnings`, lint `dead_code` actif par défaut) — aucune commande séparée | oui |
| structure (frontières core/adapters) | `npm run check:structure` = `node --test test/engineStructure.test.mjs && tsc -p tsconfig.core.json --noEmit` | oui |
| liens documentaires | `npm run check:links` (`scripts/check-links.mjs`, vérificateur Markdown zéro dépendance, parcourt tout `*.md` sauf `.git .idea node_modules dist target .claude`) | oui |
| déclarations `.d.ts` | `npm run check:dts` = `node scripts/rewrite-dts-extensions.mjs --check` | oui |
| cycles d'imports JS/TS | **aucun outil** (pas de `madge`, pas de règle `import/no-cycle`, pas de plugin `eslint-plugin-import` dans `eslint.config.mjs`) | **NON** |
| dépendances en double version (npm) | pas de script dédié ; vérifié avec `npm dedupe --dry-run` (rien à faire) + `node -e '…'` lisant `package-lock.json` pour lister les paquets à ≥ 2 versions | oui (outillage ad hoc, pas de script npm) |
| dépendances en double version (cargo) | `cargo tree -d --manifest-path packages/asset-compiler-rust/Cargo.toml` (commande native cargo, pas d'outil externe) | oui |
| mesure — compilateur natif, scène Emerald | voir « Mesure du compilateur natif » ci-dessous | oui (une exécution ; médiane de 5 à faire au lot qui la consomme) |
| mesure — moteur de rendu (WebGL/WebGPU) | `node scripts/mesure/banc.mjs --moteur <webgl\|webgpu> --avant <réf> --apres <réf> --vues … --images … --pixelError …` (voir `scripts/mesure/README.md`) | outillage identifié, **non exécuté** à cet `init` — voir note |

**Note mesure moteur de rendu** : `banc.mjs` n'a pas de mode `--help` (l'invocation sans mesure
réelle reste bloquée en attente de navigateur/serveur — un processus lancé pour vérifier l'aide a
dû être tué). Au moment de cet `init`, plusieurs autres sessions font déjà tourner `banc.mjs` en
parallèle sur cette machine (`ps aux` en liste au moins quatre) : lancer une mesure de plus aurait
contredit la convention « machine calme » suivie sur ce dépôt. La commande et son contrat sont
documentés et suffisants pour qu'un lot du moteur de rendu s'en serve ; ils ne sont pas exécutés
ici parce que l'audit demandé porte sur le compilateur, pas sur le moteur.

## Mesure du compilateur natif (`web-geometry-compiler`), scène Emerald

Source retrouvée dans `docs/COMPILER.md:47` (exemple Emerald) et confirmée sur disque — dossier
glTF avec `manifest.json` :

```
/Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square
```

Lab en lecture seule (`AGENTS.md`) : lu comme source, jamais écrit. Le cache de sortie va dans le
scratchpad de la session, jamais dans le Lab.

Commande exécutée (binaire construit par `npm run build:native`, une exécution, machine non
isolée d'autres sessions actives — pas une médiane de 5, voir `protocole-mesure.md`).
**Non rejouable telle quelle** : `<scratchpad>` remplace ici le chemin réel du cache de session,
dans la commande comme dans le JSON ci-dessous. Tout le reste est collé verbatim.

```
packages/asset-compiler-rust/target/release/web-geometry-compiler \
  /Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square \
  <scratchpad>/cache-emerald \
  full 150000 8 32768 /assets/emerald/ qem-endpoints
```

Sortie (stdout, pointeur JSON) :

```
{"cache":"<scratchpad>/cache-emerald","compilerVersion":"0.1.0","formatVersion":4,
"key":"c82eb644b3dfe32d9d79b2ea7762cc055804accb296306f51298141660faddfb",
"metrics":{"clusterHierarchyPagesMs":20640.94,"importMs":1494.998,
"outputGeometryBytes":195404028,"ramBudgetMb":32768,"threads":8,"wallMs":22136.09},
"primitives":281,"scope":"full","selectedNodes":1030,"selectedTriangles":10046405,
"simplification":true,"sourceTriangles":10046405,"status":"ready","totalNodes":1030,
"unsupported":["hard RSS enforcement","N-API binding"]}
```

`/usr/bin/time -p` : `real 22.67`, `user 19.31`, `sys 13.83`. Cache scratchpad supprimé après la
mesure (751 Mo, hors dépôt, jamais dans le Lab). Ce chiffre est **une observation isolée**, pas une
baseline : la boucle qui compare `9a7821a` à `develop` devra reconstruire les deux binaires, lancer
5 exécutions consécutives par côté sur machine calme, et retenir la médiane — le plancher de bruit
n'a pas été mesuré ici.

## Stacks détectées

| Stack | Preuve de détection | Module chargé |
|---|---|---|
| TypeScript / Node (noyau) | `package.json` (`"type":"module"`, `engines.node >=22.18`), `tsconfig.json`, `tsconfig.core.json` | aucun module dédié dans `references/stacks/` — seul le noyau s'applique ; voir Contradictions |
| Rust / cargo (noyau) | `packages/asset-compiler-rust/Cargo.toml`, `cargo build/test/clippy/fmt` | aucun module dédié dans `references/stacks/` — seul le noyau s'applique ; voir Contradictions |
| gpu-realtime | `packages/sdk-browser/gpuPresentation.ts` et `capabilities.ts` demandent un contexte `webgpu` ; `packages/sdk-browser/*.ts` importe `three` (peerDependency `three@^0.174.0` du `package.json` racine, consommé réellement dans `packages/`, pas seulement dans le Lab) | `references/stacks/gpu-realtime.md` |
| react-web | absente — aucune dépendance `react` dans `package.json` racine ni dans aucun `packages/*/package.json` | non chargé |
| electron | absente — aucune dépendance `electron` dans `package.json` racine ni dans aucun `packages/*/package.json` | non chargé |

**Gates G1–G8 de `gpu-realtime`** s'appliquent au runtime de rendu de `packages/sdk-browser`
(zéro allocation par image, libération des ressources GPU, pas d'import du framework d'UI dans le
rendu, etc.). Ce sont des critères de revue de code par lot, pas des commandes uniques : ils ne
sont pas exécutés à cet `init` et n'entrent pas dans le décompte de capacités ci-dessous — ils sont
à vérifier par le reviewer à chaque lot qui touche `packages/sdk-browser`.

## Chemins réels

| Élément | Chemin | Présent |
|---|---|---|
| fichier de contexte agent | `AGENTS.md` (racine) — `CLAUDE.md` racine renvoie dessus explicitement | oui |
| design system | — | NON (aucune UI dans `packages/`) |
| jetons de design | — | NON |
| composant de liste partagé | — | NON |
| modules noyau partagés | `packages/sdk-core` (sans React/Electron/Vite/DOM/fs, frontière testée par `test/engineStructure.test.mjs`) | oui |
| dossier de locales | — | NON |
| dossier de documentation | `docs/` (`docs/COMPILER.md`, `docs/SDK.md`, `docs/FORMAT.md`, `docs/architecture/`) | oui |
| scène de référence pour la mesure | `/Users/pasquelin/Applications/render-tech-lab/public/benchmark-assets/emerald-square` (Lab, lecture seule) | oui |
| commande de compilation Emerald | voir « Mesure du compilateur natif » | oui |
| harnais de mesure du moteur de rendu | `scripts/mesure/banc.mjs` (+ `options.mjs`, `page.mjs`, `rapport.mjs`, `serie.mjs`, `serveur.mjs`) | oui |
| journal d'orchestration | `orchestration/JOURNAL.md` | oui |

## Surfaces fonctionnelles

- `packages/asset-compiler-rust` — compilateur natif CLI (Rust) : lit glTF/GLB/FBX/OBJ (`ufbx`
  compilé en dur), écrit un cache paginé sur disque, parle à son hôte par trois flux seulement
  (JSON sur stderr, pointeur sur stdout, annulation sur stdin). Bibliothèque (`lib.rs`) + deux
  binaires (`main.rs` CLI, `oracle_main.rs` outil de vérité indépendant).
- `packages/sdk-core` — contrats et logique sans DOM ni Node ni React.
- `packages/sdk-node` — hôte Node : lance le compilateur natif (`prepare`, `prepareMany`), CLI
  `web-geometry-compile`.
- `packages/sdk-browser` — runtime de rendu navigateur (WebGL/WebGPU), pagination, sélection,
  Hi-Z ; consomme `three` en dépendance de types/rendu.
- `packages/page-codec` — codec des pages de géométrie partagé par les deux runtimes.
- Aucune UI applicative dans `packages/` : `render-tech-lab` est un hôte de banc externe, en
  lecture seule, hors périmètre de ce profil au-delà de la lecture de sa scène Emerald.

## Parcours critique

Aucun parcours utilisateur interactif dans ce dépôt (pas d'application, pas d'UI dans
`packages/`). Le parcours vérifiable de bout en bout est celui du compilateur : source glTF/FBX/OBJ
→ `web-geometry-compiler` → cache paginé sur disque → chargé par `packages/sdk-node` (`prepare`)
ou `packages/sdk-browser` (runtime) → rendu par un hôte externe (Lab ou autre). Ce chemin est
exercé de bout en bout par `packages/sdk-node/*.test.mjs` (sous-processus réel) et par les
fixtures `packages/asset-compiler-rust/fixtures/`.

## Conventions

| Sujet | Valeur, ou renvoi |
|---|---|
| branche | une seule branche vivante `develop` ; tout travail dans un worktree isolé créé depuis `develop` (`orchestration/JOURNAL.md` ; **pas** dans `AGENTS.md`) |
| worktree | `git worktree add .claude/worktrees/<nom> -b <branche> develop` |
| commit | français, style `type(scope): résumé` (voir historique), sans ligne d'attribution quand l'utilisateur le demande |
| merge | fusion dans `develop` après validation complète ; jamais de commit direct sur `develop` hors fusion ; jamais de `git stash` (`orchestration/JOURNAL.md`) |
| mots interdits | les noms du système de géométrie virtualisée d'Epic et de son moteur ne s'écrivent nulle part dans le dépôt (`AGENTS.md`) — dire « géométrie virtualisée », « DAG de clusters » |
| ports interdits | 5174, serveur de l'utilisateur (`orchestration/JOURNAL.md`, `docs/SDK.md`) |
| zones en lecture seule | `render-tech-lab`, `public/benchmark-assets` |

## Seuils

| Seuil | Valeur | Défaut du noyau |
|---|---|---|
| régression perf | 3 % | 3 % |
| régression autre | 5 % | 5 % |
| budget fichiers | — | — |
| budget lignes | 200 lignes physiques, tout fichier source maintenu `.js/.mjs/.ts/.mts/.rs` (`AGENTS.md`, `npm run check:lines`) | — |
| duplication | ≥ 12 lignes et ≥ 100 tokens, JS/TS/Rust croisés (`jscpd`) | — |

## Capacités

Relevé du 2026-09-15 sur `develop` à `2f4224e`. **Les chiffres de cette table ne se
revalident pas tout seuls** : `develop` a avancé depuis, rejouer `npm run validate` avant de s'y
fier.

| Capacité | État | Raison si N/A · outillage si non vérifiable |
|---|---|---|
| typecheck | VÉRIFIÉ | — |
| lint | VÉRIFIÉ | — |
| test (JS/TS) | VÉRIFIÉ | 705 tests, 0 échec |
| test (Rust) | VÉRIFIÉ | 147 + 4 (intégration CLI) = 151 tests, 2 ignorés, 0 échec |
| build | VÉRIFIÉ | — |
| build natif | VÉRIFIÉ | — |
| package | NON APPLICABLE | `package.json` porte `"private": true` ; aucune chaîne d'empaquetage/distribution multi-plateforme dans ce dépôt ; `AGENTS.md` interdit de prétendre une release de plateforme livrée |
| e2e | VÉRIFIÉ | via `npm test` (`packages/sdk-node/*.test.mjs`, sous-processus réel du binaire natif) |
| analyse de bundle | NON APPLICABLE | `dist/` est la sortie ESM 1:1 de `tsc` pour consommation en bibliothèque ; aucun bundler (pas de webpack/rollup/esbuild/vite en dépendance), rien à analyser comme bundle applicatif |
| format | VÉRIFIÉ | — |
| lignes (budget 200) | VÉRIFIÉ | — |
| duplication | VÉRIFIÉ | 0 clone sur 723 fichiers (JS 65, Rust 140, TS 518) |
| code mort JS/TS | VÉRIFIÉ | `knip`, aucun signalement |
| code mort Rust | VÉRIFIÉ | `cargo clippy -D warnings`, aucun avertissement |
| structure (frontières) | VÉRIFIÉ | — |
| liens documentaires | VÉRIFIÉ | 54 liens locaux, 0 erreur |
| déclarations `.d.ts` | VÉRIFIÉ | — |
| cycles d'imports JS/TS | **NON VÉRIFIABLE** | aucun outil de détection de cycles (ni `madge`, ni règle `import/no-cycle`) ; surface présente (modules ESM avec imports croisés) → **lot P0 d'outillage** |
| dépendances en double version (npm) | VÉRIFIÉ | `npm dedupe --dry-run` propre ; 3 paquets à 2 versions dans `package-lock.json` (`eslint-visitor-keys`, `ignore`, `hookified`), tous transitifs de l'outillage de dev, non introduits par ce profil |
| dépendances en double version (cargo) | VÉRIFIÉ | `cargo tree -d` : `miniz_oxide` en 2 versions (via `image`→`png` et `flate2`), transitif, préexistant |
| listes / composant partagé | NON APPLICABLE | aucune UI dans `packages/` |
| valeurs de design en dur | NON APPLICABLE | idem |
| captures / diff visuel | NON APPLICABLE | idem |
| parité de locales / i18n | NON APPLICABLE | aucun dossier de locales dans le dépôt |
| gates Electron (E1–E8) | NON APPLICABLE | aucune dépendance `electron` dans `packages/` |
| mesure — compilateur (Emerald) | VÉRIFIÉ (commande) | commande exécutée, sortie collée ; médiane de 5 non faite à cet `init` (voir section dédiée) |
| mesure — moteur de rendu | outillage identifié, **non exécuté** | machine partagée par d'autres sessions actives à l'heure de cet `init` ; hors périmètre de l'audit compilateur demandé ; ne compte pas dans le décompte ci-dessous (pas un rôle fixe du schéma) |

**Gates : 18 vérifiés · 5 non applicables justifiés · 1 non vérifiable.**
Le non-vérifiable (cycles d'imports) bloque le merge tant qu'il reste rouge : entrée de backlog
P0 créée dans `.agents/loop-code/BACKLOG.md`.

## Contradictions signalées entre le skill et `AGENTS.md`

1. **`references/stacks/` n'a pas de module Rust ni de module « CLI Node générique »** — seuls
   `electron.md`, `gpu-realtime.md` et `react-web.md` existent. Ce n'est pas une contradiction
   avec `AGENTS.md` (qui ne demande rien de tel), mais un trou de couverture du skill sur ce
   dépôt : la moitié du code audité (`packages/asset-compiler-rust`) n'a que les gates du noyau,
   aucun gate Rust spécifique. Non modifié ici (`references/` n'est pas à éditer par un `init`) ;
   signalé pour arbitrage.
2. **Deux lockfiles suivis par git** (`package-lock.json` et `pnpm-lock.yaml`) alors que
   `AGENTS.md` et tous les scripts documentés (`docs/`, `README.md`) parlent uniquement en
   `npm run …`. Le skill (`profil-schema.md`) veut un gestionnaire de paquets déclaré sans
   ambiguïté. Tranché en faveur de npm (usage majoritaire du dépôt) ; le `pnpm-lock.yaml` n'est
   pas modifié ni supprimé.

Aucune contradiction trouvée qui opposerait une règle du skill à une règle explicite
d'`AGENTS.md` sur le périmètre audité (portes de validation, limite de lignes, duplication,
lecture seule du Lab, mots interdits) : les commandes qu'`AGENTS.md` cite (`npm run
check:changed`, `npm run validate`) correspondent exactement à ce que ce profil déclare.
