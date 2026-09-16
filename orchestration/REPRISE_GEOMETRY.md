# Geometry — reprise (16 sept. 2026, 22 h 30)

## Rôle et cycle

- `get_session("self")` doit dire `Geometry`. Suivre `AGENTS.md`. Voisins : Lumière, Calculateur, Compilateur, Validateur (seul à pousser `origin/develop`). Prévenir le Calculateur à chaque fusion avec le SHA.
- Fable orchestre sans coder. Un Opus 5 par lot, worktree créé à la main depuis `develop` (`git worktree add … -b lot/<nom> develop`, jamais l'isolation automatique : elle part d'un vieux SHA), Sonnet 5 relit en lecture seule, un bloquant retourne à l'Opus puis contre-relecture. Périmètres disjoints pour les lots parallèles.
- **Aucun lot ne part sans un ordre écrit de l'utilisateur.** Une phrase avec « ? » est une question : on répond, on ne lance rien. L'enchaînement automatique ne vaut qu'à l'intérieur d'un lot ordonné (relecture → fusion → build → reproduction).
- **Tests et campagnes interdits** jusqu'au verdict « plus de lag ». Autorisés : `tsc --noEmit`, `check:lines`, `check:duplicates`, `build`, et une reproduction par fusion.
- Cycle : code → relecture → fusion locale `--no-ff` → `npm run build` (le Lab 5174 lit `dist/`) → reproduction scratch `stable.mjs` (12 instances, pose sol puis caméra mobile ; appels, CPU, GPU, diagnostics, image rendue) → « à tester » ; l'utilisateur juge seul dans le Lab, debug « Désactivé ». Jamais de push. Réponses ≤ 5 lignes, mots simples.
- Règle d'or : le rendu de la référence de géométrie virtualisée sous la contrainte du chargement web. L'image n'attend jamais une arrivée ; tout par différence entre deux images, jamais par relecture de la coupe ou du catalogue ; aucune allocation par image. Valeur non mesurée = `null`.
- Fidélité : référence = develop ≥ e8819543 (Z inversé), seuils 0 et 1 ; égalités de profondeur départagées par identifiant acceptées. Imports relatifs ; aucun chemin absolu ; aucun nom du produit d'Epic ni de son moteur, commits compris.

## Où on en est (develop local b72278c6, non poussé)

Fusionné ce soir : sélection GPU compacte (024b3b01), hôte par delta et streaming par insertion (7a90e39e), compteurs à `null` (5f66f7cc), raster de calcul pour toute la coupe opaque et masquée avec tampon de visibilité et résolution plein écran (b72278c6). Chaque fusion reproduite : image rendue, aucun diagnostic. Headless 60 Hz : GPU 9,5 à 10 ms, CPU p50 12 à 22 ms, p95 80 ms, 4 331 appels. Verdict Lab attendu.

Deux audits (scratchpad de la session : `audit-lag.md`, `audit-architecture.md`) : la structure est la bonne (clusters de 128, DAG, erreurs monotones, streaming, coupe GPU, Hi-Z, raster de calcul). Le lag vient de trois habitudes, pas de la structure :
1. Le CPU recopie toute la coupe depuis le GPU à chaque image (186 943 fiches à 12 instances, 15,7 Mo, `gpuDagResources.ts:31`) et cinq lecteurs la relisent en entier (`webgpuPagesHostApi.ts:107,167`, `webgpuCutDelta`, `shownFromGpu`, `webgpuTexturePriority.ts:84,120`) : 60 à 75 % des 13 ms CPU.
2. Ces recopies créent des tableaux neufs ; le ramasse-miettes bloque 20 ms toutes les 5 à 8 images : c'est la saccade (1 s de GC sur 12 s de profil).
3. Les transparents font 4 288 appels de dessin, un par plan (`webgpuBlendDraw.ts:152`) ; l'opaque tient en 6.

| Poste | Référence | Nous |
|---|---|---|
| Coupe + raster géométrie, GPU | 2 à 4 ms | non mesuré par étape |
| Total GPU | 4 à 5 ms | 9,5 à 10 ms |
| CPU par image | < 1 ms | 12 à 22 ms p50, 80 ms p95 |
| Appels de dessin | quelques-uns | 4 331 (4 288 transparents) |

## Todo, dans l'ordre (chaque ligne = un lot, sur ordre de l'utilisateur)

1. **La coupe ne se recopie plus, elle se corrige.** Aujourd'hui le GPU renvoie toute la liste des grappes à dessiner et le CPU la relit cinq fois. Demain le GPU garde la liste chez lui et ne renvoie que la différence avec l'image d'avant : « ces grappes entrent, celles-là sortent », dans deux petits tampons réservés une fois. Les cinq lecteurs (pages à garder, pages à charger, relevé de coupe, journal, priorité des textures) mettent à jour leurs compteurs avec cette différence, sans tableau neuf. Sans WebGPU (repli WebGL2), la coupe est déjà calculée par le CPU : elle produit la même différence directement, il n'y a rien à recopier. Un seul contrat de différence, deux producteurs (GPU, CPU). Règle les causes 1 et 2. Fichiers : `gpuDag*`, `webgpuCut*`, `webgpuPagesHost*`, `webgpuTexturePriority*`, `webgpuBudget*`, `streaming*`, coupe CPU. Worktree `lot/coupe-sans-relecture` créé, vide.
2. **Transparents en un appel par tranche d'ordre** au lieu d'un par plan, même ordre de mélange, même image. Fichiers `webgpuBlend*`, `webgpuTransparent*`. Worktree `lot/transparents-un-appel` créé, vide.
3. **La sélection GPU garde la sélection d'avant et la corrige** au lieu de revisiter 1,96 M de grappes pour 21 955 utiles (`gpuDagEncode.ts:91`, 42 dispatch par image). Fichiers `gpuDag*`.
4. **Pompe de textures sans mesurer ni retrier toute la coupe** par image : priorité mise à jour par grappe entrée/sortie, file par insertion. Peut se fondre dans le lot 1.
5. **Une coupe par grappe, pas par (placement, grappe)** : 163 316 grappes à 1 instance deviennent 1 959 792 à 12 (`webgpuPagesLayout.ts:25`, `gpuDagPack.ts:153`). Gros lot, après 1 à 4.
6. Sur verdict « plus de lag » : lever l'interdiction ; preuve de navigation sur la scène réelle, puis remettre les tests caducs (`webgpuRowCommit`, `gpuDagLive`, `gpuDagSelection*`, `webgpuBlendPipelineBind`, `webgpuBindEntries`, `webgpuTransmissionPass`, `frameCostAudit`, `webgpuPages.11`) et l'hôte de test de coupe du Calculateur ; banc bit à bit du raster de calcul contre le raster matériel ; simplify ; confirmation ligne par ligne du tableau.
7. Plus tard : quantification des positions et compression des attributs hors ligne (absentes, ~48 o/tri), Hi-Z en deux passes, ombres par la même géométrie, matériaux par classes.

Relevés bruts sous `.mesure/out/` du checkout principal. `stable.mjs` et `profil.mjs` vivent dans le scratchpad de la session ; à recréer s'ils sont perdus (80 lignes sur `scripts/mesure/{options,serveur,page,rapport}.mjs`).
