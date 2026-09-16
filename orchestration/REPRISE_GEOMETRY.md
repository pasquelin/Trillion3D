# Geometry — reprise (16 sept. 2026, 23 h)

Ce fichier est la todo de la session Geometry. Tout ce qui n'est pas ici est dans Git ou dans `AGENTS.md`.

## 1. Rôle et règles

- `get_session("self")` doit dire `Geometry`. Suivre `AGENTS.md`. Voisins : Lumière, Calculateur, Compilateur, Validateur (seul à pousser `origin/develop`). Prévenir le Calculateur à chaque fusion avec le SHA.
- Fable orchestre sans coder. Un Opus 5 par lot, dans un worktree créé à la main depuis `develop` (`git worktree add .claude/worktrees/lot-<nom> -b lot/<nom> develop` ; jamais l'isolation automatique, elle part d'un vieux SHA). Sonnet 5 relit chaque diff en lecture seule ; un bloquant retourne à l'Opus, puis contre-relecture ciblée. Lots parallèles seulement sur des fichiers disjoints.
- **Aucun lot ne part sans un ordre écrit de l'utilisateur** (« lance », « fais », « go »). Une phrase avec « ? » est une question : on répond, on ne lance rien. L'enchaînement automatique ne vaut qu'à l'intérieur d'un lot ordonné.
- **Tests et campagnes interdits** jusqu'au verdict « plus de lag » de l'utilisateur. Autorisés : `npx tsc -p tsconfig.json --noEmit`, `npm run check:lines`, `npm run check:duplicates`, `npm run build`, et une reproduction par fusion.
- Cycle d'un lot : code → relecture → fusion locale `--no-ff` dans `develop` → `npm run build` (le Lab de l'utilisateur sur `localhost:5174` lit `dist/`) → reproduction `stable.mjs` (scène emerald-square, 12 instances, WebGPU, pose sol puis caméra mobile ; lire appels, CPU, GPU, diagnostics, image rendue) → « à tester ». L'utilisateur juge seul dans le Lab, debug « Désactivé ». Jamais de push. Réponses ≤ 5 lignes, mots simples.
- Règle d'or : le rendu de la référence de géométrie virtualisée sous la contrainte du chargement web. L'image n'attend jamais une arrivée ; tout par différence entre deux images, jamais par relecture de la coupe ou du catalogue ; aucune allocation par image. Valeur non mesurée = `null`, jamais 0.
- Fidélité : référence = develop ≥ e8819543 (Z inversé), seuils 0 et 1 ; égalités de profondeur départagées par identifiant acceptées. Imports relatifs ; aucun chemin absolu, même dans un script jetable ; aucun nom du produit d'Epic ni de son moteur, commits compris.

## 2. Où on en est (develop local b72278c6, non poussé)

Fusionné le 16 sept. au soir : sélection GPU compacte (024b3b01), hôte par différence et streaming par insertion (7a90e39e), compteurs à `null` (5f66f7cc), raster de calcul pour toute la coupe opaque et masquée avec tampon de visibilité et résolution plein écran (b72278c6). Chaque fusion reproduite : image rendue, aucun diagnostic. Verdict Lab attendu sur b72278c6.

Deux audits du 16 sept. (scratchpad de la session, `audit-lag.md` et `audit-architecture.md`, à demander si perdus) disent : la structure est la bonne, la même que la référence (clusters de 128, arbre de détails, erreurs monotones, streaming de pages, coupe GPU, Hi-Z, raster de calcul). Le lag vient de trois habitudes :
1. Le CPU recopie toute la coupe depuis le GPU à chaque image (186 943 fiches à 12 instances, 15,7 Mo, `gpuDagResources.ts:31`) et cinq lecteurs la relisent en entier (`webgpuPagesHostApi.ts:107,167`, `webgpuCutDelta`, `shownFromGpu`, `webgpuTexturePriority.ts:84,120`) : 60 à 75 % des 13 ms CPU.
2. Ces recopies créent des tableaux neufs ; le ramasse-miettes bloque 20 ms toutes les 5 à 8 images : c'est la saccade.
3. Les transparents font 4 288 appels de dessin, un par plan (`webgpuBlendDraw.ts:152`) ; l'opaque tient en 6.

| Poste | Référence | Nous (headless 60 Hz) |
|---|---|---|
| Total GPU | 4 à 5 ms | 9,5 à 10 ms (part par étape non mesurée) |
| CPU par image | < 1 ms | 12 à 22 ms p50, 80 ms p95 |
| Appels de dessin | quelques-uns | 4 331, dont 4 288 transparents |

## 3. Comment marchent les transparents (pour comprendre les lots 2 et 14)

L'opaque n'a pas d'ordre : la profondeur garde le plus proche. Un matériau en mélange (vitre, eau, verre à réfraction) se mélange sur ce qui est derrière, donc l'ordre compte, du plus loin au plus près. Chaque objet transparent est un item avec une fiche fixe sur GPU (`webgpuBlendItems.ts`). Par image, le CPU trie les items du fond vers l'avant et écrit un plan (`webgpuBlendPlan.ts`), deux entrées par item (faces arrière puis avant). Un noyau GPU (`webgpuBlendSelect.ts`) rejette le hors champ ; l'occlusion Hi-Z (`gpuTransparentOcclusion.ts`) retire le caché ; puis un `drawIndirect` par entrée. La réfraction lit une copie du fond (`webgpuTransmission.ts`). La référence fait pareil hors de sa géométrie virtualisée, mais un objet = un ordre, copies instanciées, quelques dizaines d'objets ; le masqué (à trous) est dans la géométrie virtualisée, sans ordre : chez nous c'est fait depuis b72278c6 (test alpha dans le raster), à vérifier dans le Lab que le compilateur classe bien ces matériaux « masqué ».

## 4. Todo, dans l'ordre (chaque ligne = un lot, sur ordre écrit)

| # | Quoi | Gain | Effort |
|---|---|---|---|
| 1 | Coupe par différence | très élevé | moyen |
| 2 | Transparents en quelques ordres | élevé | moyen |
| 3 | Sélection GPU persistante, coupe en une passe | élevé | élevé |
| 4 | Pompe de textures par différence, puis textures virtuelles | élevé | faible puis élevé |
| 5 | Une coupe par grappe, placements en index | structurel | très élevé |
| 6 | Image tenue conservée à l'arrivée d'une page | moyen | faible |
| 7 | Surveillance de scène par version | faible | faible |
| 8 | Priorité par erreur d'écran sur WebGPU | moyen | faible |
| 9 | Partition Hi-Z par visibilité passée, puis Hi-Z deux passes | moyen | moyen |
| 10 | Filets de sécurité (avant 5) | sûreté | moyen |
| 11 | Compression des sommets hors ligne | majeur réseau | élevé |
| 12 | Ombres par la même géométrie | moyen | élevé |
| 13 | Matériaux par classes | moyen | élevé |
| 14 | Eau en passe plein écran | moyen | moyen |
| 15 | Noyaux Rust/Wasm M5 sur la coupe WebGL et les rangs | moyen | moyen |
| 16 | Compilateur : `DAG_GROUP_MIN`, `CLUSTER_TRIANGLES` | propreté | très faible |

Les lots 1 à 4 font disparaître le lag ; 5, 9, 11 rapprochent de la référence ; 10 passe avant 5.

### Détail des lots

1. **Coupe par différence.** Aujourd'hui le GPU renvoie toute la liste des grappes à dessiner et le CPU la relit cinq fois. Demain le GPU garde la liste chez lui et ne renvoie que la différence avec l'image d'avant (« ces grappes entrent, celles-là sortent ») dans deux petits tampons réservés une fois. Les cinq lecteurs (pages à garder, pages à charger, relevé de coupe, journal, priorité des textures) mettent à jour leurs compteurs avec cette différence, sans tableau neuf. Sans WebGPU (repli WebGL2), la coupe est déjà calculée par le CPU : elle produit la même différence directement. Un seul contrat, deux producteurs. À fondre dedans : classement du budget encore O(coupe) en régime dépassé (`webgpuBudgetRanking.ts:128`), `maxStretch`/`frames` recalculés quand seule l'origine bouge (`gpuDagRuntime.ts:121`), compteur de pages sans octets dans l'image tenue (`webgpuFrameHold.ts:11`). Règle les causes 1 et 2. Fichiers : `gpuDag*`, `webgpuCut*`, `webgpuPagesHost*`, `webgpuTexturePriority*`, `webgpuBudget*`, `streaming*`, coupe CPU. Worktree à créer depuis `develop`.
2. **Transparents en quelques ordres.** Un appel de dessin, c'est le CPU qui dit au GPU « dessine ce paquet » ; chaque ordre coûte. Le plan trié du fond vers l'avant reste, mais le GPU le lit seul : un ordre par tranche d'ordre et par pipeline, les 12 placements d'un même item en instances. Même mélange, même image. Supprime aussi les 68 608 octets d'arguments réécrits par image (`webgpuBlendArgs.ts:46`). Gain CPU non mesuré (estimation 4 à 9 ms). Fichiers `webgpuBlend*`, `webgpuTransparent*`. Worktree à créer depuis `develop`.
3. **Sélection GPU persistante, coupe en une passe.** La sélection revisite 1 959 792 grappes par image pour 21 955 utiles, en 42 lancements (un par niveau de l'arbre, `gpuDagEncode.ts:91`). Garder la sélection d'avant et la corriger ; puis une seule passe à fils persistants. Fichiers `gpuDag*`.
4. **Pompe de textures.** Aujourd'hui le CPU projette les 186 943 grappes pour deviner la taille de texture de chacune et retrie toute la file, pour 16 Mo de chargement sur 4,99 Go. (a) Note mise à jour seulement par grappe entrée/sortie (différence du lot 1), file par insertion. (b) Plus tard, comme la référence (« textures virtuelles ») : dans la passe de résolution, 1 pixel sur 16 incrémente un compteur par tuile demandée dans un petit tampon GPU ; le CPU le lit par `mapAsync` une image en retard, sans bloquer ; une texture d'indirection dit où est chaque tuile dans l'atlas ou quel niveau grossier prendre en attendant. Faisable en WebGPU ; en WebGL2 par une petite image relue. Deux lots.
5. **Une coupe par grappe.** 163 316 grappes × 12 placements = 1 959 792 fiches de 96 octets (`webgpuPagesLayout.ts:25`, `gpuDagPack.ts:153`). La référence garde l'arbre une fois par modèle, un placement n'est qu'une matrice, la résidence des pages est partagée. Chez nous : fiches uniques, placement en index dans la fiche de travail produite par la sélection pour les grappes retenues seulement. Mémoire GPU ÷ 12. Après 1 à 4 et 10 : changement de disposition qui touche tous les lecteurs.
6. **Image tenue à l'arrivée d'une page.** Toute arrivée casse l'image tenue et touche une ligne par grappe du paquet (`webgpuPagesPageApi.ts:37-44`) ; la garder quand l'arrivée ne change rien à l'écran.
7. **Surveillance de scène.** `hostSceneWatch` compare 4 300 nœuds × 18 valeurs par image (`frameGateCore.ts:125`) ; passer par un compteur de version.
8. **Priorité par erreur d'écran.** Le chemin WebGL2 l'a (`streamingPriority.ts:66`), pas WebGPU (`webgpuPagesHostApi.ts:123`) : à cache froid le lointain peut arriver avant le proche.
9. **Hi-Z.** La partition choisit les occulteurs par médiane de profondeur (557 352 lignes classées pour 21 955 testées) ; les choisir par visibilité passée. Puis deux passes : dessiner ce qui était visible, bâtir la pyramide, re-tester les rejetés dans la même image.
10. **Filets de sécurité, sur verdict « plus de lag ».** (1) Preuve de navigation sur la scène réelle : pipeline créé, aucune page manquante, appels et CPU dans une enveloppe. (2) Tests caducs réécrits pour le contrat d'aujourd'hui : `webgpuRowCommit`, `gpuDagLive`, `gpuDagSelection*`, `webgpuBlendPipelineBind`, `webgpuBindEntries`, `webgpuTransmissionPass`, `frameCostAudit`, `webgpuPages.11`, hôte de test de coupe du Calculateur. (3) Banc bit à bit du raster de calcul contre l'ancien raster matériel. (4) Simplify, puis tableau référence / nous mesuré.
11. **Compression des sommets.** ~48 octets par triangle aujourd'hui ; la référence quantifie les positions par grappe (14 à 16 bits par axe), normales sur 2 octets, UV en entiers : ~3 fois moins. Compilateur Rust, nouvelle version de format de page.
12. **Ombres par la même géométrie** : même sélection, même raster, mêmes pages depuis la lumière.
13. **Matériaux par classes** : une passe par matériau avec profondeur matérielle au lieu d'un branchement par pixel.
14. **Eau en passe plein écran dédiée** (copie du fond déjà en place pour la transmission).
15. **Noyaux Rust/Wasm M5 du Calculateur** sur la coupe WebGL, la coupe de secours, la reconstruction des rangs.
16. **Compilateur** : `dag/groups.rs:20` n'applique pas `DAG_GROUP_MIN` ; `lib.rs:101` constante morte `CLUSTER_TRIANGLES = 256`.

Ce que la référence a et qu'on ne fera pas : mesh shaders et atomique 64 bits, absents du web, remplacés par nos deux passes atomiques 32 bits. Relevés bruts sous `.mesure/out/` ; `stable.mjs` et `profil.mjs` dans le scratchpad de la session, à recréer s'ils sont perdus (80 lignes sur `scripts/mesure/{options,serveur,page,rapport}.mjs`).
