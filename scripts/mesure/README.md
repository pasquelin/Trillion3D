# Banc de mesure commun

Un seul harnais pour tous les lots. Une commande, aucun serveur à lancer à la main :

    node scripts/mesure/banc.mjs --moteur webgl --avant <ref-git|dist> --apres <ref-git|dist> \
         --vues generale,sol,rue --images 300 --pixelError 0,1 --max-pages 100000

- `--moteur` : `webgl` (exact-cluster-pages) ou `webgpu` (webgpu-page-raster) ; il choisit aussi les
  drapeaux de Chromium, copiés de `render-tech-lab/scripts/headless/lib.mjs` et `shots.mjs`.
- `--avant` / `--apres` : un dossier `dist/` construit, ou une référence git, extraite hors du dépôt
  et construite. Sans `--avant`, un seul côté est mesuré ; `--apres` vaut le `dist/` du dépôt.
- `--vues` parmi `generale`, `sol`, `rue`, `detail` (banc 15, pathVersion 5, vérifiée contre le Lab à
  chaque exécution) ; `--pixelError` prend une liste ; aussi `--chauffe`, `--largeur`, `--hauteur`, `--out` et `--port` (libre par défaut, jamais 5174).

Sorties dans `--out` (par défaut `.mesure/out/<moteur>-<horodatage>/`, hors de git et du lint) :
`mesure.json`, `resume.md`, et par vue, par seuil et par côté un `.png`, un `.coupe.txt` et une ligne
de relevés — `cpuFrameMs` et `cpuSelectMs` p50/p95, `gpuFrameMs` p50 (WebGPU), triangles sélectionnés
et non couverts, compteurs Hi-Z, hash de l'ensemble sélectionné, budget de pages, charge machine au
début et à la fin —, plus le témoin A/A (même côté joué deux fois) et l'écart avant/après en pixels
et par canal. `null` = non mesuré, jamais déduit ; tout ce qui est lancé est arrêté, même sur erreur.
