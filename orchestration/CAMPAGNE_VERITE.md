# Campagne de vérité — banc 15 (géométrie virtualisée)

Protocole exécutable par un agent qui ne connaît pas le projet. Tout ce qui suit a été vérifié par
lecture du code le 2026-09-14. Ce qui reste à établir avant le premier bloc est listé au §7 : ne
rien inventer, ne rien contourner. Vocabulaire imposé : « géométrie virtualisée »,
« DAG de clusters ».

## 1. Objectif et verdict

Objectif : **120 FPS partout sans aucune perte de rendu**. Un verdict est rendu par couple (scène,
moteur) et ne vaut que si les deux moitiés sont vraies : la performance atteint la cible **et**
l'image est identique à la référence. Mesures, toutes issues des images retenues d'une passe :

| Champ | Définition | Source |
|---|---|---|
| FPS | `1000 / médiane(rafIntervalMs)` | `samples[].rafIntervalMs` du rapport |
| Plafond calibré | fréquence maximale réellement atteignable par le navigateur sur ce bloc | `refreshCeiling` du rapport de campagne |
| p95, p99 | percentiles de `rafIntervalMs` | `frameDistribution()`, `shared/campaign/truthReport.ts` |
| Images > 8,33 ms | compte des `rafIntervalMs` au-delà de `SLOW_FRAME_MS` | `slowFrames` du rapport de campagne |
| Fidélité | pixels différents A/B, plancher A/A, erreur max par canal | `pngdiff.mjs`, `aaControl` |

Règles de lecture non négociables :

- CPU et GPU ne sont **jamais** additionnés. `cpuFrameMs` (appel synchrone de rendu) et
  `cpuSubmitMs` (soumission) sont deux distributions séparées.
- Ce qui n'est pas mesuré vaut `null` : aujourd'hui la durée GPU par image et la VRAM physique.
- **FPS et « Images > 8,33 ms » ne se jugent qu'en mode visible** (`HEADLESS=0`,
  `scripts/headless/README.md`) : Chrome headless plafonne vers 60 Hz quels que soient les
  drapeaux GPU posés, donc son rAF ne peut jamais démontrer ni infirmer une cible à 120 FPS. Le
  headless reste le mode de preuve de fidélité (captures, trous, §5) et de mesure relative
  (`cpuFrameMs`, `cpuSubmitMs`, `gpuFrameMs` du moteur quand il l'expose) : ces distributions-là
  comparent des moteurs entre eux sans dépendre du rafraîchissement de l'écran.
- Le plafond du navigateur se déclare à côté de chaque FPS. Un FPS collé au plafond ne démontre
  rien d'autre que le plafond.
- Le rapport du Lab déclare lui-même que son contrôle visuel ne vaut pas verdict de performance
  (`aaControlReason`) : le verdict est construit ici, à partir des données brutes.

## 2. Préconditions

**Moteur (SDK).** Checkout `/Users/pasquelin/Applications/webGeometry`, branche `develop`, HEAD
`791245b` à la rédaction. Le Lab lit `dist/` de ce checkout (ou `SDK_DIST`) ; `dist/` est présent
(`sdk-browser`, `sdk-core`, `sdk-node`), construit le 2026-09-14 00:45 par `pnpm build` (`tsc` +
`rewrite-dts-extensions.mjs` + `write-build-provenance.mjs`). Avant le premier bloc, relever :

```bash
git -C /Users/pasquelin/Applications/webGeometry rev-parse HEAD
git -C /Users/pasquelin/Applications/webGeometry status --porcelain --untracked-files=no   # vide = propre
```

`dist/sdk-browser/buildProvenance.js` porte `{version, hash, modules, generatedAt}` : un hash de
contenu, **pas** le commit ni un drapeau « dirty ». Le Lab relève lui-même le commit et le drapeau
(`shared/campaign/sdkProvenance.ts`) et les consigne dans chaque rapport de campagne. « dirty » veut
dire **fichiers suivis modifiés** (`git status --porcelain --untracked-files=no`) : un dossier de
travail non suivi, `orchestration/` en premier, ne salit pas la mesure.

**Caches de scènes.** Les huit modèles du catalogue
(`15-virtualized-integration/assets/modelCatalog.ts`) ont déjà leur cache complet sous
`public/benchmark-assets/<id>-derived/native/full/`, `status: "ready"`, compilateur
`native-rust`, `clusterStrategy: dag-groups`, `errorModel: dag-group-qem-v1`,
`compilerVersion 0.1.0`. **Ne lancer aucun `prepare:models`** : rien ne manque.

| Scène (id) | Triangles source | Primitives | dont transparents clusterisés | Format | Pages |
|---|---|---|---|---|---|
| `emerald-square` | 10 046 405 | 281 | 29 | 2 | 204 Mo |
| `drive-for-speed-map` | 2 956 492 | 12 103 | 4 633 | 2 | 223 Mo |
| `bistro-exterior` | 2 829 226 | 1 591 | 189 | 2 | 1,0 Go |
| `low-poly-city` | 1 039 082 | 78 | 0 | 1 | 54 Mo |
| `new-york` | 777 357 | 566 | 0 | 1 | 303 Mo |
| `new-york-manhattan` | 733 182 | 12 | 0 | 1 | 79 Mo |
| `skibidi-toilet-77-map` (Episode 77 Map) | 359 526 | 37 | 0 | 1 | 27 Mo |
| `accucities-london` | 172 319 | 76 | 0 | 1 | 667 Mo |

Le SDK accepte les formats 1 et 2 ; la passe `clustered-blend` exige le format 2, et aucune scène
en format 1 n'en contient. `emerald-derived` (1,1 Go, `exact-source-order`) n'est pas au
catalogue : résidu, ne pas mesurer.

**Machine.** MacBook Pro M2 Max, écran 120 Hz, Chrome stable. Avant chaque bloc : `pgrep -fl chrome`
et `lsof -i :5174` (port du bloc) ne doivent montrer que le Chrome et le serveur du bloc — aucun autre
agent qui construit, teste ou mesure. Puis `waitForQuiet(3)` (`load1 ≤ 3`, plus strict que le défaut
8 : au-delà, le plafond rAF dérive, comme les 75,8 Hz mesurés un jour de charge, ni 60 ni 120 Hz).
Rejeter le bloc, sans le consigner, si `refreshCeiling.hz` vaut `null` ou `load1` > 3 ; relancer au calme. Aucun `prepare:models` ni autre mesure pendant un bloc ; charge toujours jointe.
Le bloc de verdict se joue en **mode visible** (`HEADLESS=0`) : session macOS ouverte, fenêtre
Chrome au premier plan, veille et économiseur d'écran désactivés, machine non utilisée pendant la
mesure (`scripts/headless/README.md`, section « Mode visible »).

**Serveur.** `cd /Users/pasquelin/Applications/render-tech-lab && pnpm dev` sert le Lab sur
**5174** (`vite.config.ts`, `server.port`). Vite y écoute en IPv6 : utiliser `http://localhost:5174`,
jamais `127.0.0.1` (connexion refusée, constaté ce jour) ; port occupé par un tiers → un autre port
et `LAB_URL=http://localhost:<port>` (la preuve du jour a pris 5177). Un seul serveur suffit à l'interface et au headless.

## 3. Matrice

Quatre moteurs, dans l'ordre figé par `PATH_CAMPAIGN_ENGINES`
(`15-virtualized-integration/implementation/engines.ts:21`) :
A `three-webgl-reference`, B `three-lod`, C `exact-cluster-pages` (WebGeometry WebGL),
D `webgpu-page-raster` (WebGeometry WebGPU).

- 8 scènes × {1 instance, 9 instances} × {DPR 1, DPR 2}, résolution **1280 × 720 CSS**.
- Mode mesure : **summary** (« Mode debug » → « Désactivé — journal résumé »). Jamais `trace`.
- Niveau de détail figé sur **Qualité élevée** (`LOD_QUALITY.high`, `pixelError = 1`, valeur de
  production de référence) pour les deux moitiés du verdict ; `pixelError = 0` = témoin optionnel hors matrice.
- **Un bloc** = une scène × une étendue × un DPR, avec l'aller `A B C D` puis le retour `D C B A`
  (ABBA). Les deux passes sont conservées ; l'agrégat par moteur est la **médiane des deux sens** ;
  un écart aller/retour > 5 % déclenche une alerte et la reprise du bloc. Les deux sens sont les
  deux répétitions : une troisième ne s'exécute que si l'alerte s'est déclenchée.
- **32 blocs** (8 × 2 × 2), **256 passes moteur**. Par passe : 10 segments × (30 images de
  préchauffage + 60 mesurées) = 900 images, dont **600 retenues** (`framesPerSegment = 60`,
  `warmupFrames = 30`, `pathVersion = 5`).

Ordre des scènes : `emerald-square` d'abord (charge maximale et transparents clusterisés), puis
par charge décroissante : `drive-for-speed-map`, `bistro-exterior`, `low-poly-city`, `new-york`,
`new-york-manhattan`, `skibidi-toilet-77-map`, `accucities-london`. Dans chaque scène : 1 instance
avant 9 instances, DPR 1 avant DPR 2.

**Durée.** À calibrer en chronométrant le premier bloc (emerald-square, 1 instance, DPR 1), puis
extrapoler : quelques minutes par passe (900 images, contrôle A/A), une vingtaine de minutes par
bloc, **une dizaine d'heures de machine dédiée** pour les 32 blocs — aucune estimation plus fine n'est légitime avant calibration.

## 4. Déroulé d'un bloc

1. Vérifier le dépôt et noter commit + état propre (§2).
2. Attendre le repos machine, joindre le relevé (`machineLoad()`).
3. Lancer le Lab, ouvrir `http://localhost:5174/?test=15-virtualized-integration`,
   scène « Modèles préparés ».
4. Régler : « Modèle » = la scène du bloc ; « Que voulez-vous faire ? » =
   **Parcours reproductible (4 moteurs)** ; « Mode debug » = **Désactivé — journal résumé** ;
   « Étendue » = 1 ou 9 modèles ; « Niveau de détail » = **Qualité élevée** (`pixelError = 1`).
5. Renseigner « Largeur de mesure (px CSS) » = 1280, « Hauteur de mesure (px CSS) » = 720,
   « Pixels physiques par pixel CSS » = le DPR du bloc, et « Nom de campagne » = le nom du bloc
   (lettres, chiffres, tirets ; le préfixe `campaign-` est refusé). Le parcours enregistre
   `clientWidth × clientHeight` et **échoue** si la taille change en cours de route.
6. « Sens des moteurs » = **Aller · ordre du protocole**, puis lancer le parcours. Les quatre
   moteurs s'enchaînent dans l'ordre A B C D ; ne rien toucher.
7. À la fin, repasser « Sens des moteurs » sur **Retour · ordre inversé** et relancer (D C B A).
   Les deux rapports portent le nom de campagne et échappent à la rétention (§6).
8. Exécuter les captures de fidélité du bloc (§5), puis consigner commit SDK, charge machine, DPR,
   pixelError, résolutions CSS et physique, plafond navigateur constaté, chemins d'archive.

Voie headless, qui joue le bloc entier sans interface — **verdict de performance** (FPS, rAF,
images > 8,33 ms) : ajouter `HEADLESS=0` pour ouvrir Chrome stable visible, seul mode où le
rafraîchissement mesuré peut dépasser le plafond ~60 Hz du headless (§1, §7) ; prérequis de session
au §2 « Machine ». Sans `HEADLESS=0`, la même commande reste valide pour la fidélité (§5) et les
mesures relatives (`cpuFrameMs`, `cpuSubmitMs`) mais son rAF ne vaut pas verdict :

```bash
cd /Users/pasquelin/Applications/render-tech-lab
HEADLESS=0 CAMPAIGN=verite-emerald-square-1i-dpr1 SCENE=emerald-square PRELOAD=all DETAIL=summary \
  PIXEL_ERROR=1 node scripts/headless/walk.mjs
```

`walk.mjs` joue la séquence ABBA des quatre moteurs — `ENGINES`, ou le premier argument positionnel,
pour en choisir d'autres —, imprime une ligne JSON par passe (moteur, sens, taille du canvas,
erreurs, diagnostics) puis `{report, refreshCeiling, aggregates}`, et écrit son rapport sous
`reports/15-virtualized-integration/<CAMPAIGN>/walk-<scène>-<8 hex>.json` avec l'index `latest.json`
du dossier — le champ `environment` du rapport consigne le mode joué (`headless` ou `visible`).
`REPLICAS=9` et `DPR=2` couvrent les trois autres étendues de la matrice ; `WIDTH`,
`HEIGHT`, `FRAMES`, `SLOW_FRAME_MS`, `MAX_PAGES`, `LAB_URL` (`localhost`, §2) et `SDK_DIST`
complètent le réglage — `PIXEL_ERROR=1` est obligatoire (§3), jamais son défaut `0`. Catalogue des
variables et défauts : `scripts/headless/README.md`.

## 5. Fidélité

La fidélité se juge par capture PNG sans perte, aux mêmes poses, à la même résolution.

**Plancher de bruit A/A (témoin).** Même moteur, deux fois, même pose. Le parcours de l'interface
le fait déjà : `runAaControl` rejoue les 10 points de contrôle, rend deux fois, compare avec
`compareModelPixels`, et publie `aaControl` (`passed` / `failed` / `not-run`) avec
`differentPixels` et `maxChannelError`. Ce couple **est** le plancher de bruit du bloc. En
headless, deux captures successives du même moteur, à `pixelError = 1` (§3), puis comparaison :

```bash
SCENE=emerald-square MAX_PAGES=4096 TAG=aa1- node scripts/headless/shots.mjs exact-cluster-pages 0,150,300,450 1
SCENE=emerald-square MAX_PAGES=4096 TAG=aa2- node scripts/headless/shots.mjs exact-cluster-pages 0,150,300,450 1
node scripts/headless/pngdiff.mjs \
  scripts/headless/shots/aa1-emerald-square-exact-cluster-pages-e1-f300.png \
  scripts/headless/shots/aa2-emerald-square-exact-cluster-pages-e1-f300.png
```

**Comparaison A/B.** Le moteur évalué contre `three-webgl-reference`, mêmes poses, `pixelError = 1`
(§3 ; `pixelError = 0` optionnel hors matrice, témoin de feuilles exactes), `MAX_PAGES=4096` :

```bash
SCENE=emerald-square MAX_PAGES=4096 TAG=ref- node scripts/headless/shots.mjs three-webgl-reference 0,150,300,450 1
SCENE=emerald-square MAX_PAGES=4096 TAG=ab-  node scripts/headless/shots.mjs exact-cluster-pages   0,150,300,450 1
node scripts/headless/pngdiff.mjs \
  scripts/headless/shots/ref-emerald-square-three-webgl-reference-e1-f300.png \
  scripts/headless/shots/ab-emerald-square-exact-cluster-pages-e1-f300.png
```

`shots.mjs` écrit ses PNG dans
`scripts/headless/shots/<TAG><scène>-<moteur>-e<pixelError>-f<image>.png`, imprime par pose
`selected`, `submitted`, `transparent`, `draws`, `resident` et `trous`, et écrit son rapport de
campagne à côté de celui de `walk.mjs`. `pngdiff.mjs` rend `{pixels, differing, pct,
maxChannelError, buckets, rowsTouched, worstRow}`.

Critères d'acceptation, tous obligatoires :

- **Aucun trou** : `holes.value == 0` à chaque pose (`computeHoles`, `shared/campaign/
  truthReport.ts` du Lab ; `selectedTriangles` moins le cut opaque effectivement soumis une seule
  fois — `submittedTriangles` seul pour `exact-cluster-pages`/`three-lod`/`three-webgl-reference`,
  moins `transparentSubmittedTriangles` pour `webgpu-page-raster`). Sur ces trois premiers moteurs
  la mesure est exacte (même sélection résidente pour `selectedTriangles` et `submittedTriangles`) ;
  sur `webgpu-page-raster`, `holes.value` reste une **approximation documentée** en `holes.method` —
  son `selectedTriangles` public est le cut idéal avant repli vers un ancêtre résident, alors que
  le cut opaque isolé ici vient du cut après repli réellement dessiné, donc l'écart mélange repli
  LOD ordinaire et trou réel et reste positif même à résidence non plafonnée (constaté sur
  `emerald-square`) : un `trous` positif sur ce seul moteur ne prouve pas à lui seul un défaut de
  résidence saturée. `holes.value` vaut `null` — jamais un chiffre trompeur — dès qu'une métrique
  requise manque pour le moteur. Un `holes.value` non nul (exact ou approximatif) signale de la
  géométrie sélectionnée mais non dessinée : la case est rejetée, sauf mention contraire écrite
  pour `webgpu-page-raster` compte tenu de l'approximation ci-dessus.
- **Pixels différents = 0**, ou au plus le plancher A/A mesuré sur ce même bloc.
- **Erreur max ≤ 2 par canal.** Tout écart restant est expliqué par écrit, pose par pose ; un écart
  non expliqué vaut échec.

Interdits, qui invalident la case et le bloc entier : réduire la résolution, le DPR, la distance de
rendu ou la qualité (`pixelError` > 1, LOD « équilibré » ou « adaptatif ») pour gagner des images
par seconde ; transformer un matériau transparent en matériau masqué ; comparer des captures de
résolutions ou de poses différentes. **Un gain obtenu avec une image dégradée est rejeté**, sans
discussion de FPS.

`shots.mjs` parcourt toutes les scènes de `SCENES` (`SCENES=emerald-square,drive-for-speed-map,…`,
défaut `emerald-square`) : les huit scènes se mesurent en une passe par moteur, chaque PNG portant le nom de sa scène.

## 6. Archivage et nommage

À la fin d'un parcours, l'interface poste le rapport ; le serveur écrit, sous
`reports/15-virtualized-integration/` : `campaign-<uuid>/REPORT.md` (rapport lisible),
`campaign-<uuid>/objects/result.json.gz` (données brutes, dont `samples[]` et `captures[]`),
`objects/manifest.json`, `logs/engine-events.jsonl`, `media/*.jpg`, et l'index `latest.json`
= `{archivedAt, reportPackage: "campaign-<uuid>"}`.

Deux pièges vérifiés dans le code :

1. **`latest.json` est à la racine du dossier de banc**, pas dans le dossier de campagne. Il
   pointe la dernière campagne et ne contient aucune mesure.
2. **Rétention = 2** (`CAMPAIGN_RETENTION_LIMIT`, `benchmarks/campaignRetention.ts:4`) : chaque
   nouvelle campagne supprime la troisième plus ancienne ; 64 parcours s'effaceraient eux-mêmes.

Le champ « Nom de campagne » du parcours coupe ce piège : le dossier s'appelle alors
`<nom de campagne>-<8 premiers de l'identifiant de passe>` (exemple :
`verite-emerald-square-1i-dpr1-aller-a3f19c02`), hors du préfixe `campaign-` balayé par la
rétention, et le rapport de campagne y est écrit tel quel dans `truth-report.json`, relisible sans
décompression. Les rapports headless suivent la même règle sous
`reports/15-virtualized-integration/<CAMPAIGN>/`. Nommer chaque bloc
`verite-<scène>-<instances>i-dpr<n>-<aller|retour>` suffit donc à le conserver ; les PNG du bloc y
sont copiés sous `fidelite/`.

## 7. Ce qui manque pour lancer

Le chantier banc 15 a fermé dans le code les six manques relevés à la rédaction :
`--disable-gpu-vsync` (inoffensif) est dans les drapeaux Chrome de **tous** les scripts
(`BASE_FLAGS`, `lib.mjs`) ; `--disable-frame-rate-limit` en a été retiré (il dégrade le headless à
54,6 Hz et désynchronise le visible du vsync réel) et le commutateur `HEADLESS` (défaut headless,
`HEADLESS=0` = visible) y a été ajouté ; `DPR`, `WIDTH` et `HEIGHT` sont des variables de campagne et des
champs de l'interface ; `REPLICAS` est lu par tous les scripts ; le rapport
`banc15-truth-campaign/v1` (`shared/campaign/truthReport.ts`) porte DPR, `pixelError`, résolutions
CSS et physique, plafond rAF calibré, commit SDK avec drapeau dirty, charge machine par passe, ordre
ABBA, médiane des deux sens et alerte au-delà de 5 % ; FPS médian et nombre d'images au-delà du
seuil (`SLOW_FRAME_MS`, défaut 8,333 ms) sont dérivés par `frameDistribution`.

Reste, avant le premier bloc :

1. **Preuve navigateur.** Faite le 2026-09-14 (parcours court, capture courte) : plafond rAF
   calibré, canvas physique et rapport de campagne complet confirmés sur la machine de mesure —
   avec trois écarts corrigés ci-dessus : `pixelError` par défaut 0 au lieu de 1 (§3, §5), plafond
   `null` sous charge à 75,8 Hz (§2 « Machine »), et `127.0.0.1` refusé par Vite (§2 « Serveur »).
2. **Archivage.** Un parcours nommé échappe à la rétention (§6) ; un parcours lancé sans nom de
   campagne retombe sur `campaign-<uuid>` et doit être copié hors de `reports/` avant le troisième.
3. **Durée totale** à établir en chronométrant le premier bloc, comme dit au §3.

## 8. Format de la synthèse finale

Une table par scène, une ligne par moteur, dans l'ordre A B C D. En-tête de table : scène, nombre
d'instances, DPR, résolution CSS et physique, commit SDK (avec état propre ou dirty), plafond
navigateur calibré, charge machine, écart aller/retour.

| Moteur | FPS | p95 (ms) | p99 (ms) | Images > 8,33 ms | Pixels différents A/B | Plancher A/A | Verdict |
|---|---|---|---|---|---|---|---|
| three-webgl-reference | | | | | | | |
| three-lod | | | | | | | |
| exact-cluster-pages | | | | | | | |
| webgpu-page-raster | | | | | | | |

Verdict par ligne : `atteint` (FPS ≥ 120 sous le plafond calibré **et** fidélité conforme),
`non atteint` (fidélité conforme, performance insuffisante), `rejeté` (fidélité non conforme, quelle
que soit la performance), `non mesuré` (bloc non exécutable). Une case vide est interdite : écrire
`null` et la raison.
