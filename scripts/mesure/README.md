# Banc de mesure commun

Un seul harnais pour tous les lots. Une commande, aucun serveur à lancer à la main :

    node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
         --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000

- `--moteur` : `webgl` (exact-cluster-pages), `webgpu` (webgpu-page-raster) ou `webgl2`
  (autonomous-pages-webgl, le moteur autonome qui décode lui-même les pages de géométrie, donc le
  seul qui fait monter `pagesDecodedWasm`) ; il choisit aussi les drapeaux de Chromium, copiés de
  `render-tech-lab/scripts/headless/lib.mjs` et `shots.mjs`. `webgl2` exige un cache dont toutes les
  primitives sont des clusters exacts : sans cela le compilateur laisse `autonomousScene` nul et
  l'explorateur refuse la série par `AUTONOMOUS_SCENE_UNAVAILABLE`.
- `--avant` / `--apres` : un dossier `dist/` construit, ou une référence git, extraite hors du dépôt
  et construite. Sans `--avant`, un seul côté est mesuré ; `--apres` vaut le `dist/` du dépôt.
- `--moteur-avant` / `--moteur-apres` : le moteur d'un seul côté, qui l'emporte sur `--moteur`. C'est
  ainsi qu'on met **le moteur face au témoin Three dans une seule exécution** — mêmes poses, mêmes
  lampes, mêmes caches, même serveur —, et que `ecartAvantApres` devient un chiffre de fidélité et
  non plus une comparaison entre deux campagnes. Les drapeaux de Chromium sont alors la réunion de
  ceux dont les deux côtés ont besoin, et chaque côté publie son moteur dans `mesure.json`.
- `--cache-avant` / `--cache-apres` : le dossier « derived » d'un cache compilé (celui qui contient
  `native/full`), pour comparer deux compilateurs sur la même scène. Sans l'option, le côté lit le
  cache du Lab. Chaque cache nommé est rendu sous `/cache/<côté>/`.
- `--ressources <dossier>` : le dossier que le glTF d'un cache compilé désigne par chemin relatif,
  monté sous `/assets/`. Sans lui, un cache compilé sans base de ressources sort ses textures en 404
  et la mesure porterait sur des matériaux sans texture — ce ne serait plus la scène.
- `--vues` parmi `generale`, `sol`, `rue`, `detail` (banc 15, pathVersion 5, vérifiée contre le Lab à
  chaque exécution) ; `--pixelError` prend une liste ; aussi `--chauffe`, `--largeur`, `--hauteur`, `--out` et `--port` (libre par défaut, jamais 5174).
- `--rebond on|off` (par défaut `off`) : allume la lumière qui rebondit, éteinte par défaut dans
  le moteur. Sans elle, l'étape « Rebond » vaut « non mesuré » et l'image est celle d'avant le lot.
- `--profil on|off` (par défaut `on`) : demande au moteur son découpage par étape. `off` rejoue
  exactement la même série sans ce chronométrage — deux exécutions dont seule cette option diffère
  donnent la porte de fidélité et le coût du profil.
- `--lampes N` : allume N lampes ponctuelles du contrat, posées par la règle générique de
  `lampes.mjs` — une grille régulière dans l'emprise horizontale du modèle, à hauteur fixe au-dessus
  de son plancher, portée déduite de la maille. Aucune scène n'est nommée. `--ombres on|off` (par
  défaut `on`) dit si elles projettent une ombre ; `--lampe-mobile` déplace la première d'entre elles
  d'un petit cercle à chaque image, sans lui faire quitter sa maille. `--intensite N` (40 par
  défaut) règle ce qu'une ponctuelle émet, de la même façon pour tout modèle : sur un modèle dont
  la maille fait des dizaines de mètres, l'indirect d'une ponctuelle à intensité de rue tombe sous
  le quantum des huit bits de la capture et l'écart à l'oracle n'a plus rien à mesurer. La même
  option existe sur `oracle.mjs`.
- `--soleil` : ajoute la lampe directionnelle générique de `lampes.mjs` — direction, couleur et
  intensité fixes, les mêmes pour n'importe quel modèle — avec ses cascades d'ombre, soumises à
  `--ombres` comme les ponctuelles. Combinable avec `--lampes`.
- `--camera-mobile` : la pose avance d'un cran de la trajectoire du banc à chaque image mesurée, au
  lieu de rejouer la même. C'est ce qui distingue une scène immobile d'une caméra qui bouge — et
  donc, pour le soleil, une cascade en cache d'une cascade redessinée à chaque image. C'est aussi la
  seule façon de voir le coût d'une sélection : à pose figée, tout ce qui est tenu d'une image sur
  l'autre est gratuit et n'apparaît nulle part. Sur Emerald, vue générale, la sélection GPU des
  transparents fait passer `cpuFrameMs` p50 de 17,6 à 12,1 ms au seuil 0 et de 7,2 à 4,5 ms au
  seuil 1 — un écart invisible à caméra fixe. Le hash de coupe relevé peut différer d'un côté à
  l'autre sous cette option sans que l'image bouge : il vient d'une relecture asynchrone, en retard
  d'une image sur la coupe qu'il décrit.
- Sans `--lampes` ni `--soleil`, aucune lampe n'est déclarée : le moteur rend alors sa vue sans
  éclairage, l'albédo brut des matériaux. C'est son comportement par défaut, pas une option du banc.

## Le témoin Three et les lampes du contrat

Les adaptateurs Three ne lisent pas le magasin `SceneLight` : ils recopient les lampes du graphe
source, et rien d'autre. Le harnais est un hôte comme un autre — il pose donc lui-même, en Three,
les lampes que le magasin déclare, par l'option publique `sceneLighting` de `createExplorer`
(`pageTemoin.mjs`, servi à la page sous `/mesure/` et importé par son URL). Rien n'est écrit à la
main : tout vient de `explorer.lights()`, donc du cache compilé et du contrat — les lampes du
fichier importé comme celles du banc —, et aucune scène n'est nommée.

La correspondance est exacte dans les unités de Three : couleur linéaire, intensité radiométrique
sans facteur, `distance` = portée et `decay` = 2, ce qui donne le carré inverse fenêtré de
`directIncidence` ; le bord de cône d'un projecteur est reproduit par la pénombre. Chaque côté
publie dans son relevé `lampesTemoin` ce qu'il a reçu, ou `null` s'il ne dessine pas par Three.

Ce que le témoin ne rend pas, nommé plutôt que deviné : **aucune ombre portée** — le renderer Three
du SDK n'allume pas ses cartes d'ombre. Une campagne de fidélité se joue donc `--ombres off` des
deux côtés, sinon l'écart mesuré porte d'abord les ombres que seul le moteur dessine.

- `--budget-ombres <ms>` : le budget de l'étape Ombres, en millisecondes de carte graphique par
  image. Sans l'option, le moteur garde le sien (1,0 ms). Les pages invalidées au-delà attendent leur
  tour ; le profil publie `pagesEnAttente` et `retardMaxMs`.
- `--ombres-pages off` : fait repartir la face d'ombre entière dès qu'un objet bouge dans la portée
  d'une lampe, au lieu des seules pages que sa boîte projetée recouvre. C'est la porte d'identité des
  cartes : deux exécutions dont seule cette option diffère doivent rendre la **même empreinte**
  d'atlas et la même image.
- `--empreinte-ombres` : vide la file des pages d'ombre, relit l'atlas de profondeur et publie son
  empreinte dans `series[].sides[].atlasOmbres` (`hash`, `written`, `pagesEnAttente`, `images`).
  Éteint par défaut : c'est une lecture de 64 Mo, pas une mesure d'image. À n'employer qu'avec des
  poses et des lampes déterministes, sinon les deux côtés ne décrivent pas la même scène.
- `--instances N` (1, 4, 9 ou 12) : le SDK pose N copies de l'objet en grille (`replicaCount`).
  Par défaut 1. Un lot qui touche aux instances se mesure aux deux nombres, et le rapport porte
  dans chaque ligne la mémoire de géométrie publiée par le moteur (colonne « géométrie (Mo) » :
  octets du cache de pages plus tampons de sommets, `null` si le moteur ne la publie pas).
- `--visible` : ouvre une vraie fenêtre. Sans fenêtre, l'affichage plafonne à 60 Hz sur ce Mac.
- `--images-profil` (120 par défaut) : les images de la boucle de profil, jouée après la boucle
  mesurée et sans la remplacer. Elle rend la main au navigateur entre deux images, parce que les
  relevés d'horodatage reviennent par une promesse : une boucle qui n'attend jamais n'en récupère
  presque aucun. La fenêtre du profil est vidée avant cette boucle.

Sorties dans `--out` (par défaut `.mesure/out/<moteur>-<horodatage>/`, hors de git et du lint) :
`mesure.json`, `resume.md`, et par vue, par seuil et par côté un `.png`, un `.coupe.txt` et une ligne
de relevés — `cpuFrameMs` et `cpuSelectMs` p50/p95, `gpuFrameMs` p50 (WebGPU), triangles sélectionnés
et non couverts, compteurs Hi-Z, hash de l'ensemble sélectionné, budget de pages, charge machine au
début et à la fin —, plus le témoin A/A (même côté joué deux fois) et l'écart avant/après en pixels
et par canal. `null` = non mesuré, jamais déduit ; tout ce qui est lancé est arrêté, même sur erreur.

`resume.md` porte aussi la section « Coût par étape » : une ligne par étape de l'image, colonne CPU
et colonne GPU en p50/p95, jamais additionnées, plus les compteurs d'ombres (lampes, faces
redessinées, appels de dessin), le moyen de mesure carte graphique retenu par l'appareil et le coût
du profil lui-même. Le même découpage est enregistré tel quel dans `mesure.json`, sous
`series[].sides[].profilParEtape`, pour comparer lot à lot. « non mesuré » n'est pas zéro.

Chaque série est jouée dans une page neuve, fermée juste après. Une scène Emerald laisse plusieurs
centaines de mégaoctets vivants dans la page qui l'a jouée : en enchaînant les séries sur une seule
page, `new THREE.WebGLRenderer` finit par ne plus obtenir de contexte (« Error creating WebGL
context », relevé au passage de la vue `generale` à `sol` le 14 septembre 2026). Fermer la page rend
au navigateur le contexte WebGL et le tas de la série précédente.

## Mesurer une autre scène

Le harnais ne connaît aucune scène : il mesure celle des caches qu'on lui donne, et ses poses
viennent des bornes du modèle lues dans la page, pas d'une table. Trois choses à fournir.

1. **Compiler le glTF** avec le binaire Rust (`npm run build:native`, puis
   `packages/asset-compiler-rust/target/release/web-geometry-compiler`), vers un dossier
   `<nom>-derived/` hors du dépôt et hors du Lab — un cache compilé n'est jamais écrit dans
   `render-tech-lab/public/benchmark-assets`.
2. **Nommer ce cache aux deux côtés** : `--cache-avant <dossier>` et `--cache-apres <dossier>`. Le
   nom de la scène est déduit du dossier `derived` ; sans aucune de ces deux options, le harnais lit
   le cache du Lab et retombe sur la scène par défaut. Le cache du Lab n'est exigé que lorsqu'un
   côté au moins n'a pas le sien.
3. **Monter les ressources** : `--ressources <dossier>` est le dossier que le glTF du cache désigne
   par chemin relatif. Sans lui, les textures sortent en 404 et la mesure ne porte plus sur la
   scène. Un cache compilé avec un `resourceBaseUrl` absolu, lui, va chercher ses textures à cette
   URL — sous `/benchmark-assets/` pour les caches du Lab —, et `--ressources` ne le concerne pas :
   c'est le journal d'erreurs du relevé qui dit lequel des deux cas on est, page par page.

`--max-pages` est à régler pour la scène : la valeur qui convient à un modèle urbain de plusieurs
millions de triangles sature une petite scène en travail inutile et en sature une plus grosse en
résidence. Le relevé consigne le budget employé ; une comparaison n'a de sens qu'à budget égal des
deux côtés.

## Banc des calculs (`npm run bench:calculs`)

Les bancs et leurs oracles vivent dans le paquet mesuré, sous `packages/<paquet>/bench/` : la
vérité de test d'un paquet lui appartient, et un banc atteint les modules du paquet par chemin
relatif au lieu d'importer ses internes depuis l'extérieur. Un banc va donc dans le paquet dont il
mesure le code : `packages/sdk-core/bench/` pour les deux points qui ne touchent que `sdk-core`,
`packages/sdk-browser/bench/` pour tous les autres. Le harnais commun (`banc.mjs`, `bancF.mjs`) est
dans `sdk-core/bench/`, le paquet de base : la dépendance va de `sdk-browser` vers `sdk-core`,
jamais l'inverse.

Ils comparent, calcul par calcul, l'implémentation d'avant une optimisation à celle du paquet, sur
les mêmes entrées : un fichier par domaine, `banc.mjs` pour le chronomètre et l'égalité bit à bit
(`Object.is` sur chaque flottant, même ordre pour les tableaux, même contenu pour les Set et les
Map), `oracles/` pour les références d'avant optimisation (les tests unitaires du paquet les
importent par `./bench/oracles/…`), `scenes.mjs` pour les entrées — réalistes et hostiles :
triangles dégénérés, sommets derrière la caméra, NaN, Infinity, -0, boîtes vides ou inversées,
ensembles vides, générateur à graine fixe. La commande joue les fichiers un par un
(`--test-concurrency=1`) puis `scripts/mesure/calculs/agrege.mjs` — ce dossier ne garde que les
trois agrégateurs et leur `tableau.mjs` commun, sans aucun import de paquet — imprime le tableau
`Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Retenu` et l'écrit dans
`.mesure/out/calculs/calculs-<date>.md` (hors dépôt), les données brutes dans le `.json` voisin.

Une ligne n'est « retenue » que si les deux sorties sont identiques au bit près **et** que la
médiane d'après est meilleure. Chaque fichier de banc porte, en clair, une copie de l'ancien code
comme oracle : ces doublons-là sont voulus, d'où l'exclusion `jscpd` de `packages/*/bench`
dans `package.json`.
