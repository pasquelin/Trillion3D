# Geometry — reprise

## Identité et règles

- Confirmer le titre `Geometry` par `get_session("self")`. Suivre `AGENTS.md`. Voisins : Lumière, Calculateur, Compilateur, Validateur (seul à pousser `origin/develop`).
- Fable orchestre sans coder ; Opus 5 code en worktree ; Sonnet 5 lit et audite, ne commet jamais. Réponses ≤ 5 lignes, pas de relais des attentes.
- Ordre de l'utilisateur, 16 sept. 2026 : **interdiction formelle de tests et de campagnes de mesure**. Les agents codent, compilent (`tsc --noEmit`) et livrent ; fusion locale dans develop, reconstruction de `dist/` (le Lab sur 5174 lit `../webGeometry/dist`), puis l'utilisateur teste lui-même dans le Lab. Reprendre tests, simplify et validation seulement sur son ordre explicite.
- Règle d'or : le même rendu qu'Unreal sous la contrainte du chargement web. L'image n'attend jamais une arrivée. Toute mesure future couvre la traversée de la ville à cache froid, pas seulement des poses préchargées ; p95 et pic, pas la médiane.
- Imports relatifs uniquement ; jamais de chemin absolu de la machine dans un fichier livré ou jetable.
- Fidélité : référence = develop ≥ 37a55d59 aux seuils 0 et 1. Les écarts au seuil 1 contre une base antérieure (égalités de profondeur aux coutures LOD, ≤ 93 px, déterministes) sont acceptés, pas un lot de départage par identifiant (casserait le rejet anticipé).

## Tableau Unreal / nous (audit lecture seule du 16 sept.)

| Ligne | En place | Optimisé | Reste |
|---|---|---|---|
| Clusters 128, DAG, erreur écran | oui | oui | — |
| Coupe DAG sur GPU | oui | oui (fb96ffb2) | vérifier les 7 à 8 passes par niveau au Lab |
| Hi-Z deux passes, historique, partition GPU | oui | oui | — |
| Raster calcul petits, matériel gros | oui | oui | départage par identifiant seulement pour les petits |
| Tampon de visibilité, un ombrage par pixel | oui | oui | — |
| CPU par image quasi nul | oui (96d68279) | à tester | — |
| Textures progressives, budget | oui | oui | — |
| Streaming sans attente | oui (a9b3db14, 33e1db88, worker) | à tester | plages de téléversement et fiches de ligne restent sur le fil principal |
| WebGL mobile | coupe hiérarchique, forçage élagué (11666f9c) | à tester | noyaux Rust/Wasm du Calculateur (M5) quand livrés |

## État au 16 sept. 2026, 18 h — develop local (worker de streaming inclus), non poussé

Fusionnés dans l'ordre depuis b92e23e : image tenue + incrémental (4397df3, corrections c396c459), coupe GPU rétablie (2ddbdafe), reprise coupe incomplète + couleur tenue WebGL (b42948a9), transparents suivent les transformations (Calculateur), partition Hi-Z GPU (1f4a746c), rejet anticipé du mélange (dd3d604d), occlusion des transparents (fa876ed0), sélection indirecte (cc3b5033, a2507150), géométrie tronquée (37a55d59), streaming sans attente (a9b3db14), syncRows incrémental (33e1db88), élagage hiérarchique (fb96ffb2), transparents sur GPU (96d68279), coupe CPU WebGL élaguée sous forçage (11666f9c), intégration des pages en worker (fusion suivante).

Dernière mesure valable (avant les quatre derniers lots, machine chargée, 12 instances) : WebGPU immobile 2 ms CPU ; mobile CPU 2,5 ms, GPU 10 à 11 ms ; WebGL immobile 5 ms, mobile 41 ms. Navigation à froid : 2 images par seconde avant a9b3db14, non remesurée (interdit).

Tests devenus caducs, non adaptés sur ordre : `webgpuRowCommit.test.ts`, `gpuDagLive.test.ts`, `gpuDagSelection*.test.ts`, `webgpuBlendPipelineBind`, `webgpuBindEntries`, `webgpuTransmissionPass`, `frameCostAudit`, `webgpuPages.11`.

## Suite, dans l'ordre

1. Verdict de l'utilisateur dans le Lab (WebGPU puis WebGL, traversée à froid).
2. Sur son ordre : simplify des lots, remise des tests caducs, puis confirmation ligne par ligne du tableau avec preuve par le code.
3. Quand le Calculateur livre M5 (Rust/Wasm, tampon partagé, mêmes bits) : coupe WebGL sur ce socle (entrée matrice vue-projection + seuil, sortie liste compacte ordonnée), coupe de secours WebGPU, reconstruction des rangs, intégration des pages en worker.
4. Fusions locales en attente de validation et de push par le Validateur ; relevés bruts sous `.mesure/out/` du checkout principal.
