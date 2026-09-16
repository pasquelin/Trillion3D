# Geometry — reprise (16 sept. 2026, 19 h)

## Identité et règles

- Confirmer le titre `Geometry` par `get_session("self")`. Suivre `AGENTS.md`. Voisins : Lumière, Calculateur, Compilateur, Validateur (seul à pousser `origin/develop`).
- Fable orchestre sans coder ; Opus 5 code en worktree ; Sonnet 5 relit en lecture seule avant fusion. Réponses ≤ 5 lignes, tableau seulement si demandé.
- **Interdiction formelle de tests et de campagnes** (ordre du 16 sept.) tant que l'utilisateur lague en se déplaçant. Cycle : l'agent code et compile (`tsc --noEmit`) → relecture Sonnet du diff (invariants, doublons, chemins absolus) → fusion locale → `npm run build` (le Lab 5174 lit `dist/`) → **reproduction sur la scène réelle avant de dire « à tester »** (script scratch : 12 instances, pose sol, caméra fixe puis mobile ; lire appels, CPU, GPU, diagnostics) → verdict de l'utilisateur dans le Lab, mode debug « Désactivé ». Cette reproduction a attrapé trois régressions le 16 sept. (shader `fwidth` non uniforme, « Missing page » par adresse partagée entre placements, 23 151 appels hors champ) ; sans elle rien ne protège.
- Règle d'or : le même rendu qu'Unreal sous la contrainte du chargement web. L'image n'attend jamais une arrivée ; tout par delta, jamais par parcours de la coupe ou du catalogue par image ; aucune allocation par image.
- Imports relatifs uniquement ; jamais de chemin absolu de la machine, même dans un script jetable.
- Fidélité : référence = develop ≥ 37a55d59, seuils 0 et 1. Les écarts au seuil 1 contre une base antérieure (égalités de profondeur aux coutures LOD, ≤ 93 px) sont acceptés ; pas de départage par identifiant sur la passe matérielle.

## Cibles (Nanite, 1080p, carte génération PS5) et état mesuré en mouvement, 12 instances

| Poste | Nanite | Nous (018c5b72) |
|---|---|---|
| Coupe + raster géométrie, GPU | 2 à 4 ms | 5 à 6 ms |
| Visibilité + matériaux, GPU | 1 à 2 ms | 1 à 2 ms |
| Transparents, GPU | hors Nanite | 0,2 ms |
| Total GPU | 4 à 5 ms | 11 ms |
| CPU par image | < 1 ms | 8 à 14 ms |
| Immobile | tenue | tenue, 2 ms |

## Fait (develop local 018c5b72, non poussé, depuis b92e23e)

Image tenue + incrémental ; coupe GPU rétablie ; transparents suivent les transformations ; partition Hi-Z, rejet anticipé du mélange, occlusion des transparents, sélection indirecte et par niveaux, géométrie tronquée ; streaming sans attente, worker d'intégration, syncRows incrémental, fiches bornées à 2 ms/image, journal sans débordement, trace bornée ; transparents sur GPU (sélection, fiches par item, hors champ non encodés) ; coupe CPU WebGL élaguée sous forçage ; listes de l'hôte sans ensembles de clés.

## En cours (agents Opus, code seul)

1. `lot/hote-delta` : contrat hôte par delta et rangs numériques, file de priorité par insertion, delta de relevé par fusion linéaire → CPU < 1 ms. Fichiers : explorer*, streaming*, webgpuPages*, webgpuCut*.
2. `lot/selection-compacte` : enregistrements chauds/froids, résidence en bits, oracle miroir → sélection 1,5 → 0,5 ms. Fichiers : gpuDag*.

## À faire, dans l'ordre

3. Raster de calcul pour tous les triangles (plus de passe matérielle) : GPU géométrie 5 → 3 ms, départage par identifiant gratuit. Le plus gros lot.
4. Sur verdict « plus de lag » : relever l'interdiction ; écrire d'abord la preuve de navigation sur la scène réelle (pipeline créé, aucune page manquante, appels et CPU dans une enveloppe), puis remettre les tests caducs : `webgpuRowCommit`, `gpuDagLive`, `gpuDagSelection*`, `webgpuBlendPipelineBind`, `webgpuBindEntries`, `webgpuTransmissionPass`, `frameCostAudit`, `webgpuPages.11` ; reprendre l'hôte de test de coupe du Calculateur (41dfcccc). Puis simplify, puis confirmation ligne par ligne du tableau Unreal/nous.
5. Noyaux Rust/Wasm du Calculateur (M5, arène partagée) sur la coupe WebGL, la coupe de secours, la reconstruction des rangs.
6. `webgpuPagesPrepare.ts` à 202 lignes (porte check:lines) à régler au simplify.

Relevés bruts sous `.mesure/out/` du checkout principal ; scripts de reproduction dans le scratchpad de la session (stable.mjs, profil.mjs, heldpx.mjs : à recréer si perdus, ils tiennent en 60 lignes chacun sur `scripts/mesure/{options,serveur,page}.mjs`).
