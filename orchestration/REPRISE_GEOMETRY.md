# Geometry — reprise (16 sept. 2026, 21 h)

## Rôle et cycle

- `get_session("self")` doit dire `Geometry`. Suivre `AGENTS.md`. Voisins : Lumière, Calculateur, Compilateur, Validateur (seul à pousser `origin/develop`). Prévenir le Calculateur à chaque fusion avec le SHA.
- Fable orchestre sans coder. Un Opus 5 par lot, worktree isolé, branche `lot/<nom>` depuis `develop` (contrôler `merge-base` au lancement : les worktrees d'agents partent parfois d'un vieux SHA). Sonnet 5 relit chaque diff en lecture seule ; un bloquant retourne à l'Opus, puis contre-relecture ciblée. Périmètres de fichiers disjoints pour les lots parallèles.
- **Tests et campagnes interdits** (ordre du 16 sept.) jusqu'au verdict « plus de lag ». Autorisés : `tsc --noEmit`, `check:lines`, `check:duplicates`, `build`.
- Cycle : code → relecture → fusion locale `--no-ff` → `npm run build` (le Lab 5174 lit `dist/`) → reproduction scratch `stable.mjs` (12 instances, pose sol puis caméra mobile ; appels, CPU, GPU, diagnostics `lost|fallback|fail`, image rendue) → « à tester » ; l'utilisateur juge seul dans le Lab, debug « Désactivé ». Jamais de push. Réponses ≤ 5 lignes.
- Règle d'or : le rendu de la référence de géométrie virtualisée sous la contrainte du chargement web. L'image n'attend jamais une arrivée ; tout par delta, jamais par parcours de la coupe ou du catalogue par image ; aucune allocation par image. Valeur non mesurée = `null`.
- Fidélité : référence = develop ≥ 37a55d59, seuils 0 et 1 ; égalités de profondeur départagées par identifiant acceptées. Imports relatifs ; aucun chemin absolu, même jetable ; aucun nom du produit d'Epic ni de son moteur, commits compris.

## Cibles (1080p, carte génération PS5) et dernier relevé headless, 12 instances en mouvement

| Poste | Référence | Nous (5f66f7cc) |
|---|---|---|
| Coupe + raster géométrie, GPU | 2 à 4 ms | 5 à 6 ms |
| Visibilité + matériaux, GPU | 1 à 2 ms | 1 à 2 ms |
| Transparents, GPU | hors référence | 0,2 ms |
| Total GPU | 4 à 5 ms | 9,6 ms |
| CPU par image | < 1 ms | 13 ms p50 (Lab à confirmer) |
| Immobile | tenue | tenue, 2 ms |

Le harnais headless ne remonte que la dernière image pour `drawCalls` (4 331) et `frameHeld` ; CPU p95 ≈ 80 ms = pointes de streaming.

## Fait (develop local 5f66f7cc, non poussé)

Base b92e23e → 018c5b72 : image tenue + incrémental, coupe GPU, partition Hi-Z, transparents GPU, streaming sans attente, fiches et trace bornées. Depuis : M5 Calculateur (0f95e425) ; `lot/selection-compacte` (024b3b01) : résidence en bits, `Cluster` chaud 12 mots, `gpuDagLayout.ts` décodeur unique ; `lot/hote-delta` (7a90e39e) : rangs numériques `webgpuPagesHostRanks.ts`, file de streaming par insertion `streamingQueueOrder.ts`, fusion linéaire du relevé avec séquences adoptée/publiée dans `webgpuCutAdoption.ts` ; `lot/compteurs-null` (5f66f7cc). Chaque fusion reproduite : image rendue, 4 331 appels, aucun diagnostic.

## En cours

- `lot/raster-calcul` (Opus, worktree depuis 67830582) : raster de calcul pour tous les triangles opaques et masqués, tampon de visibilité, résolution matérielle plein écran, retrait de la passe d'appels de dessin opaque, BLEND inchangé, départage par identifiant. Cible GPU géométrie 5 → 3 ms. Fichiers `gpuRaster*`, `webgpuPages*`, `gpuDraw*`, `pageRaster*`, `gpuSmallTriangles*`. Puis relecture, fusion, build, reproduction.

## À faire, dans l'ordre

1. Reste CPU : `applyBudget`/`webgpuBudgetRanking.rank` parcourt `run.desired` par image ; `pendingUrls` garde son contrat chaîne et son parcours en mouvement.
2. Sur verdict « plus de lag » : lever l'interdiction ; d'abord la preuve de navigation sur la scène réelle (pipeline créé, aucune page manquante, appels et CPU dans une enveloppe), puis remettre les tests caducs (`webgpuRowCommit`, `gpuDagLive`, `gpuDagSelection*`, `webgpuBlendPipelineBind`, `webgpuBindEntries`, `webgpuTransmissionPass`, `frameCostAudit`, `webgpuPages.11`) et l'hôte de test de coupe du Calculateur (41dfcccc) ; simplify ; confirmation ligne par ligne du tableau.
3. Noyaux Rust/Wasm du Calculateur (M5, arène partagée) sur la coupe WebGL, la coupe de secours, la reconstruction des rangs.

Relevés bruts sous `.mesure/out/` du checkout principal. `stable.mjs` (80 lignes sur `scripts/mesure/{options,serveur,page,rapport}.mjs`) vit dans le scratchpad de la session ; à recréer s'il est perdu.
