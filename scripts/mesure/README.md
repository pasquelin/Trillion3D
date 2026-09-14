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
- `--vues` parmi `generale`, `sol`, `rue`, `detail` (banc 15, pathVersion 5, vérifiée contre le Lab à
  chaque exécution) ; `--pixelError` prend une liste ; aussi `--chauffe`, `--largeur`, `--hauteur`, `--out` et `--port` (libre par défaut, jamais 5174).
- `--profil on|off` (par défaut `on`) : demande au moteur son découpage par étape. `off` rejoue
  exactement la même série sans ce chronométrage — deux exécutions dont seule cette option diffère
  donnent la porte de fidélité et le coût du profil.
- `--visible` : ouvre une vraie fenêtre. Sans fenêtre, l'affichage plafonne à 60 Hz sur ce Mac.

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
