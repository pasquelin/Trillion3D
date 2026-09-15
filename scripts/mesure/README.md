# Banc de mesure commun

Un seul harnais pour tous les lots. Une commande, aucun serveur à lancer à la main :

    node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
         --vues generale,sol,rue --images 60 --pixelError 0,1 --max-pages 100000

- `--moteur` : `webgl` (exact-cluster-pages) ou `webgpu` (webgpu-page-raster) ; il choisit aussi les
  drapeaux de Chromium, copiés de `render-tech-lab/scripts/headless/lib.mjs` et `shots.mjs`.
- `--avant` / `--apres` : un dossier `dist/` construit, ou une référence git, extraite hors du dépôt
  et construite. Sans `--avant`, un seul côté est mesuré ; `--apres` vaut le `dist/` du dépôt.
- `--cache-avant` / `--cache-apres` : le dossier « derived » d'un cache compilé (celui qui contient
  `native/full`), pour comparer deux compilateurs sur la même scène. Sans l'option, le côté lit le
  cache du Lab. Chaque cache nommé est rendu sous `/cache/<côté>/`.
- `--ressources <dossier>` : le dossier que le glTF d'un cache compilé désigne par chemin relatif,
  monté sous `/assets/`. Sans lui, un cache compilé sans base de ressources sort ses textures en 404
  et la mesure porterait sur des matériaux sans texture — ce ne serait plus la scène.
- `--vues` parmi `generale`, `sol`, `rue`, `detail` (banc 15, pathVersion 5, vérifiée contre le Lab à
  chaque exécution) ; `--pixelError` prend une liste ; aussi `--chauffe`, `--largeur`, `--hauteur`, `--out` et `--port` (libre par défaut, jamais 5174).
- `--profil on|off` (par défaut `on`) : demande au moteur son découpage par étape. `off` rejoue
  exactement la même série sans ce chronométrage — deux exécutions dont seule cette option diffère
  donnent la porte de fidélité et le coût du profil.
- `--lampes N` : allume N lampes ponctuelles du contrat, posées par la règle générique de
  `lampes.mjs` — une grille régulière dans l'emprise horizontale du modèle, à hauteur fixe au-dessus
  de son plancher, portée déduite de la maille. Aucune scène n'est nommée. `--ombres on|off` (par
  défaut `on`) dit si elles projettent une ombre ; `--lampe-mobile` déplace la première d'entre elles
  d'un petit cercle à chaque image, sans lui faire quitter sa maille.
- `--soleil` : ajoute la lampe directionnelle générique de `lampes.mjs` — direction, couleur et
  intensité fixes, les mêmes pour n'importe quel modèle — avec ses cascades d'ombre, soumises à
  `--ombres` comme les ponctuelles. Combinable avec `--lampes`.
- `--camera-mobile` : la pose avance d'un cran de la trajectoire du banc à chaque image mesurée, au
  lieu de rejouer la même. C'est ce qui distingue une scène immobile d'une caméra qui bouge — et
  donc, pour le soleil, une cascade en cache d'une cascade redessinée à chaque image.
- Sans `--lampes` ni `--soleil`, aucune lampe n'est déclarée : le moteur rend alors sa vue sans
  éclairage, l'albédo brut des matériaux. C'est son comportement par défaut, pas une option du banc.
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
`orchestration/mesures/calculs-<date>.md`, les données brutes dans le `.json` voisin.

Une ligne n'est « retenue » que si les deux sorties sont identiques au bit près **et** que la
médiane d'après est meilleure. Chaque fichier de banc porte, en clair, une copie de l'ancien code
comme oracle : ces doublons-là sont voulus, d'où l'exclusion `jscpd` de `packages/*/bench`
dans `package.json`.
