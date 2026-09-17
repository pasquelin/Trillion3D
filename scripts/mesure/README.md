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
- `--chemin-math auto|js|wasm` (par défaut `auto`) : le chemin des calculs en lot du socle. `auto`
  laisse le gouverneur arbitrer par la mesure — aucun seuil n'est écrit dans le code —, `js` et
  `wasm` l'imposent pour toute la campagne, ce qui met les deux chemins face à face à scène, poses
  et cache identiques. Le tableau « Chemin de calcul en lot » de `resume.md` publie, par côté et par
  opération, le chemin réellement joué, les deux médianes en nanosecondes par élément, les bascules
  et les éléments traités ; le relevé complet est dans `series[].sides[].cheminCalcul`. Une médiane
  qu'aucune exécution n'a nourrie vaut « non mesuré », jamais zéro.
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

### Les compteurs de triangles et de repli

Tous sont lus sur **une seule image** : la dernière de la boucle mesurée, dont l'indice est publié à
côté d'eux dans `series[].sides[].imageDuReleve`. Aucun n'est cumulé sur la série.

- `selectedTriangles` : les triangles de la coupe de clusters que cette image a choisie, avant tout
  rejet postérieur (tronc de vision, occultation). `null` si le moteur ne tient pas de coupe.
- `drawnTriangles` : les triangles que cette image remet au dessin — la coupe publiée, opaques et
  transparents de la hiérarchie confondus, moins les grappes qu'aucune page résidente ne porte
  (`uncoveredTriangles`). Il est compté **sur l'image du relevé elle-même**, au moment où la coupe
  est adoptée, sans attendre aucun retour de la carte graphique : c'est ce qui le distingue de
  `submittedTriangles`, et pourquoi il ne vaut jamais `null` faute de temps. Le rejet d'occultation
  ne s'en retire pas ; `hiZ.rejectedTriangles` le compte à part. `null` hors de ce moteur.
- `couverture` (colonne de `resume.md`, calculée par le rapport) :
  `selectedTriangles − drawnTriangles − uncoveredTriangles`. **Zéro est la valeur attendue** : chaque
  triangle de la coupe est soit remis au dessin, soit compté comme trou. Autre chose signifie que
  l'un des trois compteurs décrit une autre image. Un tiret quand l'un des trois manque.
- `submittedTriangles` : un compte tout autre — les triangles que cette image a réellement soumis au
  dessin de la passe opaque, relevés par la carte graphique elle-même et non sur la coupe ; l'occultation en rejette une part après la soumission, ils y sont donc comptés. `null`
  quand le moteur choisit sa coupe sur la carte graphique et que le compte n'en était pas encore
  revenu au moment du relevé — un chiffre plus tard n'est pas un chiffre de cette image-là.
- `totalSubmittedTriangles` : le même compte de la carte, les passes transparentes en plus. `null`
  aux mêmes conditions — sur banc à caméra mobile, la coupe change à chaque image et ce retour
  asynchrone n'arrive jamais : les deux valent alors `null` là où `drawnTriangles` est chiffré. C'est lui, et lui seul, que `metrics.triangles` reprend, pour les hôtes qui lisent
  encore ce nom ; il vaut `null` quand rien ne l'a compté, et jamais zéro.
- `imageTenue` (contrat `frameHeld`) : vrai quand l'image relevée a été **tenue** — rien n'avait
  bougé, le moteur n'a réencodé qu'une présentation. Elle n'a alors dessiné aucun cluster, donc ses
  triangles soumis valent zéro : c'est le compte exact de ce qu'elle a fait, et non une mesure
  absente. Un banc à caméra fixe tient presque toujours sa dernière image ; lire `submittedTriangles`
  sans lire cette colonne fait prendre une image tenue pour une image vide. `null` hors de ce moteur.
- `uncoveredTriangles` : les triangles que la coupe publiée nomme mais que l'image ne peut pas
  dessiner — aucune page résidente, aucun ancêtre couvrant. C'est un trou dans l'image : zéro est la
  seule valeur saine. `null` sur un moteur qui dessine exactement ce qu'il a sélectionné.
- `hiZ` (contrat `hiz*Clusters`, `hiz*Triangles`, `hizCountedFrame`) : ce que le test d'occultation
  a reçu, éliminé et renvoyé vers un mip plus grossier, en clusters et en triangles. Sur le chemin
  GPU ils décrivent une image **antérieure** à celle du relevé : `hiZ.image` la nomme, et le tableau
  la met entre parenthèses. `null` quand aucune image n'a encore été comptée.
- `repliSelectionGpu` (contrat `gpuSelectionFallback`) : vrai quand ce moteur avait une coupe choisie
  sur la carte graphique et l'a abandonnée pour la coupe processeur de secours — tout ce qui est
  mesuré ensuite décrit ce secours, pas la coupe GPU. `null` sur un moteur sans coupe GPU, le témoin
  WebGL par exemple ; `resume.md` l'affiche en `oui` / `non` / `—`.

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

1. **Compiler le glTF** avec le binaire Rust (`pnpm run build:native`, puis
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

## Bancs de performance

Ils vivent dans le paquet mesuré, sous `packages/<paquet>/bench/`, et se lancent par
`pnpm run perf:all`. Leur fonctionnement, leurs oracles et leurs baselines sont décrits dans
[`docs/TESTS.md`](../../docs/TESTS.md) ; ce README-ci ne couvre que le harnais de campagne
ci-dessus, celui qui mesure une scène réelle dans un navigateur.
