import type { LocaleOverlay } from './entryOverlay.ts';

export const guidesFr: LocaleOverlay = {
  'example-many-lights': {
    title: 'Beaucoup de lumières, un seul budget',
    description:
      'Déclarez un anneau de lampes avec ombres, lisez le budget d’échantillonnage, et distinguez une image immobile convergée d’une image en mouvement.',
    html: `<p>Chaque lumière déclarée est triée par tuile d’écran de 16×16 pixels (<code>lightSettings.maxLightsPerTile</code> conservées au plus). Ce qu’un pixel fait de la liste de sa tuile dépend de l’image : une image <strong>en mouvement</strong>, que l’anticrénelage temporel accumule, pèse chaque lumière sans son ombre — la part bon marché — et n’en calcule entièrement que <code>lightSettings.samplesPerPixel</code> (4), lecture d’ombre comprise : une lumière qui vaut la part d’un échantillon est calculée exactement, les autres sont tirées en proportion de leur poids et divisées par leur probabilité, si bien que l’historique moyenne une estimation sans biais. Une image <strong>immobile</strong> calcule toutes les lumières de la tuile et converge vers la somme exacte sur ses seize images accumulées, puis se tient : deux exécutions donnent la même image au bit près.</p>
<p>Ce qu’un hôte observe : <code>explorer.lightSettings</code> publie les budgets ; <code>metrics().lightsSampled</code> est le drapeau du mode : <code>true</code> quand la résolution a tourné en mode échantillonné — une image en mouvement sur un historique, où un pixel ayant plus de lumières que d’échantillons en tire un sous-ensemble —, <code>false</code> quand elle a parcouru toute la liste ; <code>metrics().frameHeld</code> dit que l’image immobile a convergé ; <code>stageProfile()</code> porte l’étape de résolution de l’éclairage. Le coût déclaré est un léger grain sur les surfaces éclairées pendant que la caméra bouge, mesuré dans <code>docs/SDK.md</code> ; le gain, caméra mobile sur trente-deux lampes avec ombres atteignant un même pixel, est une enveloppe GPU de 39,9 → 17,9 ms en 2496×1404. La <a class="link link-primary" href="#/fr/playground/many-lights-sampling">leçon de l’anneau</a> le montre en direct.</p>`,
  },
  'example-explorer': {
    title: 'Démarrage et budgets de l’explorateur',
    description:
      'Démarrage interactif avec des budgets mémoire explicites ; le moteur gère les contrôles, la taille et le rendu à la demande.',
  },
  'example-camera': {
    title: 'Image caméra sans allocation',
    description:
      'Une projection et une image caméra allouées une fois, puis réécrites à chaque image depuis une matrice monde.',
  },
  'example-batch': {
    title: 'Une hiérarchie en un lot',
    description:
      'Dix mille nœuds composés puis multipliés par leurs parents en une passe sur des tampons plats.',
  },
  'example-texture-streaming': {
    title: 'Tuiles de texture sous un budget par image',
    description:
      'Comment les textures arrivent tuile par tuile, ce qui borne chaque image et comment l’hôte lit la cadence.',
    html: `<p>Les textures des matériaux sont virtuelles : des tuiles de 128×128 texels vivent dans deux pools fixes, et l’image rendue demande elle-même les tuiles qu’elle lit (<code>textureTilesRequested</code>). Une tuile absente affiche son plus fin niveau ancêtre résident, jusqu’à la queue épinglée — jamais un trou. À chaque image, une passe copie les tuiles demandées, les plus regardées d’abord, sous deux budgets fixes : <code>maxTextureTransferBytesPerFrame</code> (16 Mio) et <code>maxTextureUploadMsPerFrame</code> (1,0 ms de CPU). Dès que l’un est épuisé, la passe s’arrête ; le reste est reporté aux images suivantes — proposé à nouveau dans le même ordre jusqu’à ce qu’un retour d’image frais le remplace —, si bien qu’une traversée à cache froid diffuse à cadence fixe au lieu de bloquer l’image. La première tuile d’une passe est toujours copiée : même un budget nul avance. <code>flush()</code> lève les deux budgets et fait converger la pose.</p>
<p>Lisez la cadence sur les pics, jamais sur les médianes : <code>textureUploadPeakMs</code> est la pire passe budgétée depuis le départ, <code>textureUploadMs</code> la dernière passe (<code>null</code> quand elle n’avait rien à servir, ou sous une barrière), <code>textureTilesDeferred</code> ce que le budget a repoussé à l’image suivante, et <code>stageProfile()</code> donne les p50/p95 de l’étape « Textures ». Mesuré sur le cache Emerald au commit 8c20f71b, vue générale, cache froid et caméra mobile (1280×720, DPR 1, seuil 1 px, deux exécutions, Apple M2 Max, Chrome 153) : le p95 de l’étape « Textures » passe de 4,2–9,3 ms à 1,1–1,2 ms, le p99 de l’intervalle d’image du navigateur de 33–133 ms à 16,8 ms ; le coût déclaré est une image plus grossière pendant que les tuiles arrivent — 8 à 12 tuiles par image, 1,2–1,8 niveau manquant en moyenne en fin de traversée contre 0,6–0,7 avant — et une pose fixe converge vers la même capture à 0 px. L’horloge de la passe couvrant aussi le suivi des ombres des tuiles arrivées (619e34fb, même commande, deux exécutions) : « Textures » 1,0 / 1,2 ms p50/p95, pic de session 5,1–16,6 ms sur les quatre sessions (les deux exécutions et leurs répétitions A/A), sur la seule image qui pose la première tuile couleur. Le banc la lit avec <code>--budget-textures &lt;ms&gt;</code> (<code>scripts/mesure/README.md</code>).</p>`,
  },
  'example-diagnostics': {
    title: 'Diagnostics et qualité',
    description:
      'Changez ce que dessine l’image et la finesse de la coupe sur un explorateur actif ; et ce qu’un appareil GPU perdu laisse à l’écran — rien de périmé.',
  },
  'quick-start': {
    title: 'Démarrage rapide',
    description:
      'D’un fichier glTF à une scène diffusée dans un canevas : compilez une fois, explorez dans le navigateur.',
    html: `<p>Le moteur diffuse la géométrie par grappes : un compilateur natif découpe une fois la scène source en pages, puis l’explorateur du navigateur ne lit que celles demandées par la caméra, sous des budgets mémoire fixes. Le même point d’entrée sélectionne le contrat adapté à chaque environnement.</p>
<ol>
<li><strong>Compilez</strong> sur la machine qui détient la source avec <code>web-geometry</code>. Le cache reçoit manifeste, pages et textures annexes ; <code>resourceBaseUrl</code> est l’URL que lira le navigateur.</li>
<li><strong>Explorez</strong> dans le navigateur avec le même import <code>web-geometry</code>. <code>createExplorer</code> accepte un ID ou un élément canevas. Avec <code>interactive: true</code>, le moteur gère les contrôles, la taille et le rendu à la demande. Donnez au canevas une largeur et une hauteur CSS ; appelez <code>dispose()</code> à la fermeture. Ce démarrage simple nécessite WebGPU.</li>
</ol>
<p>Le contrat complet — options, budgets, éclairage, anticrénelage temporel et diagnostics — se trouve dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>.</p>`,
  },
  'occlusion-two-phase': {
    title: 'Occlusion : le Hi-Z en deux passes',
    description:
      'Comment une grappe cachée derrière une autre quitte l’image, ce qui en décide, et les compteurs qui le disent.',
    html: `<p>Le chemin de visibilité WebGPU dessine ses grappes opaques en deux passes, selon le schéma publié en deux phases. Aucune option à régler : le mécanisme est fixe, automatique, et lit sa propre histoire.</p>
<ol class="list-decimal pl-6 space-y-1">
<li><strong>Passe principale.</strong> Une grappe est un <em>occulteur</em> quand l’image précédente l’a dessinée et que la pyramide de profondeur de cette image ne la cache pas : son rectangle et sa borne de profondeur d’alors sont relus contre cette pyramide, encore dans son tampon. Les occulteurs sont rastérisés en premier.</li>
<li><strong>Pyramide.</strong> La profondeur de la passe principale devient une pyramide Hi-Z : une chaîne de mips où chaque texel garde la profondeur la plus lointaine de son empreinte.</li>
<li><strong>Seconde passe.</strong> Toute autre grappe — retirée des occulteurs, ou rejetée à l’image précédente — est testée contre cette pyramide : une empreinte découpée à la fenêtre, le mip qui la couvre en seize texels, et la comparaison de la profondeur la plus proche de la grappe à la plus lointaine lue là. Ce qui reste caché n’est pas dessiné ; le reste est rastérisé dans une seconde passe sur les mêmes cibles.</li>
</ol>
<p>Le test de la seconde passe est le seul autorisé à rejeter, et il est conservateur à l’ulp : le rectangle contient celui de la référence, la borne de profondeur reste en dessous, une boîte qui coupe le plan proche n’est jamais rejetée. Le verdict de la passe principale ne décide que de l’<em>ordre de dessin</em> : un verdict faux coûte un second test, jamais un pixel. C’est pourquoi un monde déplacé, une cible redimensionnée ou une page qui change de rang n’ont rien à invalider — seul un rang qui change de page oublie ce qu’il tenait.</p>
<p>Dans une vue immobile, les deux moitiés convergent en un cycle de gigue d’anticrénelage : une grappe que le test a gardée reste occulteur jusqu’à ce que la vue, ou un monde, bouge. L’image est alors tenue — aucune passe ne tourne — ce qu’une pyramide mouvante interdirait.</p>
<h3 class="text-lg font-bold mt-4">La lire</h3>
<ul class="list-disc pl-6 space-y-1">
<li><code>render()</code> renvoie <code>hizTestedClusters</code>, <code>hizRejectedClusters</code>, <code>hizRejectedTriangles</code> et <code>hizCountedFrame</code> : ce que la seconde passe a testé et rejeté sur l’image décrite par le dernier relevé périodique — la carte compte, l’hôte relit une image sur quinze, et <code>null</code> signifie aucun relevé encore, jamais zéro.</li>
<li><code>stageProfile()</code> porte l’étape de partition : <code>lignes</code> (lignes résidentes), <code>occulteurs</code>, <code>testees</code>, <code>historiqueOcculteurs</code> (lignes dessinées à l’image précédente) et <code>retiresParLaPyramide</code> (lignes que cette pyramide a retirées), avec les millisecondes GPU des passes <code>WG partition</code>, <code>WG HiZ pyramid</code>, <code>WG HiZ test</code>, <code>WG visibility primary</code> et <code>WG visibility secondary</code>.</li>
<li>Le banc de mesure imprime les mêmes nombres par vue sous <em>Hi-Z tested/rejected</em> ; la vue de rue de la scène de référence rejette 5 131 des 24 902 lignes là où l’ancienne histoire en rejetait 440.</li>
</ul>
<p>La leçon <a class="link link-primary" href="#/fr/examples/occlusion-two-phase">Cacher un anneau derrière un anneau</a> montre les compteurs bouger sur le jardin quand l’œil descend à hauteur d’anneau.</p>`,
  },
  'water-pass': {
    title: 'Eau et verre : la passe d’eau plein écran',
    description:
      'Comment un matériau transmissif est composé sur le chemin WebGPU — un tampon de surface, une composition plein écran sur l’arrière-plan figé — et ce que le matériau importé décide.',
    html: `<p>Un matériau qui transmet — glTF <code>KHR_materials_transmission</code>, avec <code>KHR_materials_ior</code> et <code>KHR_materials_volume</code> ; l’eau, le verre épais — n’est pas mélangé par son opacité : il relit ce que l’image a déjà dessiné derrière lui. Sur le chemin WebGPU, cette lecture est une passe à part, après les mélanges ordinaires, et il n’y a rien à régler : la classe se lit sur le matériau importé, jamais sur un nom.</p>
<ol class="list-decimal pl-6 space-y-1">
<li><strong>Arrière-plan figé.</strong> L’image éclairée est copiée une fois, et la profondeur opaque une fois dans la profondeur que l’étape de surface teste. Chaque surface transmissive lit la même image figée, si bien que l’ordre entre deux d’entre elles ne change rien — et aucune ne voit à travers une autre, la même limite déclarée que la visionneuse de référence glTF.</li>
<li><strong>Étape de surface</strong> (<code>WG water surfaces</code>). Les éléments transmissifs se dessinent avec l’étage de sommets du mélange et sa lecture du matériau, dans le tampon de surface de la résolution opaque elle-même, libre une fois cette résolution consommée — couleur de base, normale, rugosité, émission, occlusion — plus le rang d’eau de l’élément et l’opacité, avec la profondeur matérielle testée contre la copie opaque et écrite : la surface la plus proche d’un pixel est celle qui reste, quel que soit le nombre de surfaces empilées, et une surface derrière un opaque n’atteint jamais la composition.</li>
<li><strong>Composition</strong> (<code>WG water composite</code>). Un triangle plein écran éclaire chaque pixel d’eau une fois, avec la seule formule d’éclairage du moteur : l’arrière-plan réfracté par l’indice et atténué par la couleur du volume, le reflet des sondes pondéré par Fresnel, le spéculaire des lumières déclarées, et la couleur éclairée de la surface pour la part que le matériau ne transmet pas. Un pixel sans eau est rejeté, et l’image garde ce qu’elle tenait.</li>
</ol>
<p><strong>Le volume s’arrête où la scène opaque commence.</strong> Le rayon parcourt l’épaisseur déclarée, ou la distance à l’arrière-plan sous le pixel quand elle est plus courte ; la sortie où il est relu et l’atténuation suivent cette distance. Un bassin déclaré plus profond que son fond rend le même pixel qu’un bassin déclaré exactement aussi profond ; un bloc juste sous la surface est déplacé et teinté par sa propre profondeur, non par celle du bassin. Devant rien, la part transmise laisse passer le fond d’affichage au lieu d’une radiance noire.</p>
<h3 class="text-lg font-bold mt-4">Le lire</h3>
<ul class="list-disc pl-6 space-y-1">
<li><code>stageProfile()</code> dépose les deux passes sur l’étape <em>transparents</em>, par étiquette ; une scène sans matériau transmissif ne les encode jamais et n’alloue qu’un texel à leurs cibles. Une image dont toutes les surfaces transmissives sont hors champ n’en encode rien non plus.</li>
<li>Le budget des cibles d’image compte la couleur figée (8 octets par pixel) et la profondeur d’eau (4) seulement quand la scène transmet : <code>gpuFrameTargetBytes</code> le dit. Les surfaces elles-mêmes sont celles de la résolution opaque, déjà payées.</li>
<li>Une vue de diagnostic — grappes, fil de fer, erreur écran —, une variante GPU de diagnostic, ou une capture depuis une seconde caméra, qui lit le tampon de surface comme opaque, dessine la tranche de transmission comme un mélange de plus, si bien que la variante mesure le même étage de fragments sur tous les transparents.</li>
</ul>`,
  },
  architecture: {
    title: 'Architecture et règles',
    description:
      'Les promesses du moteur et les conventions suivies par chaque fonction ci-dessous.',
    html: `<p>La mission décrite dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/architecture/PRODUCT_PRINCIPLES.md">Principes du produit</a> est une géométrie virtualisée pour le web : grappes diffusées, une coupe du DAG par image, tampon de visibilité, anticrénelage temporel, budgets mémoire et de diffusion fixes. Les étapes d’éclairage figurent dans <code>docs/SPEC_ENGINE_WITHOUT_THREE.md</code> §8.</p>
<h3 class="text-lg font-bold mt-4">Une image, sur le chemin WebGPU</h3>
<p>Le GPU coupe le DAG et compacte les grappes à dessiner ; la rastérisation matérielle écrit un <strong>tampon de visibilité</strong> (un identifiant par pixel) derrière un test d’occultation Hi-Z ; la <strong>résolution des matériaux</strong> reconstruit ensuite la surface de chaque pixel — couleur de base, normale, rugosité, émission — <em>une classe de matériau par passe</em> : une passe écrit la classe de chaque pixel comme une profondeur exacte, puis chaque classe trace un triangle plein écran à sa propre profondeur sous le test matériel <code>equal</code>, avec un pipeline compilé pour ses seuls traits (cartes, découpe, normales de sommet, tangentes). Suivent l’éclairage différé, les transparents, l’anticrénelage temporel et la présentation. Observez-le en direct avec <code>setDiagnostic('materials')</code> (une couleur par classe), le diagnostic <code>material-classes-ready</code> (les classes de la scène) et <code>stageProfile()</code> (le bloc <code>materials</code> : <code>WG material depth</code> et <code>WG material surfaces v1</code>).</p>
<h3 class="text-lg font-bold mt-4">Conventions de l’API mathématique</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Matrices 4×4 en ordre colonne</strong>, seize nombres consécutifs, translation en <code>[12..14]</code>.</li>
<li><strong>Sortie d’abord, aucune allocation.</strong> Une fonction écrit dans <code>out</code> et le renvoie ; les décalages permettent à un grand tampon de contenir plusieurs opérandes.</li>
<li><strong><code>Float64Array</code> pour les calculs</strong>, <code>ArrayLike&lt;number&gt;</code> pour la lecture. La simple précision intervient lors de l’envoi vers le GPU.</li>
<li><strong>Mêmes bits que la référence</strong>, vérifiés par <code>pnpm run perf:core</code>, sauf les deux écarts déclarés : courbe sRGB et termes de profondeur de la projection inversée infinie.</li>
<li><strong>Mesurer avant d’optimiser.</strong> Les profils CPU et GPU localisent le coût d’une image ; aucune optimisation ne part d’une supposition.</li>
<li><strong>Matériaux prouvés à l’écran.</strong> <code>pnpm run test:gpu</code> rend douze matériaux témoins — couleur de base et sa carte, masque alpha à son seuil, mélange, faces arrière, métal-rugosité, émissif, carte de normales — avec le moteur et avec le témoin Three, tous deux depuis <code>dist/</code>, et tient chaque pixel lu à un niveau près du témoin ; le seul écart déclaré, un mélange sur une surface opaque, est mesuré à 45 niveaux et tenu là (<code>docs/SDK.md</code> § Separated surfaces and lighting).</li>
</ul>
<h3 class="text-lg font-bold mt-4">Lire ce portail</h3>
<p>Chaque entrée nomme le fichier qui la contient. Le badge <span class="badge badge-warning badge-sm">en développement</span> désigne une fonction absente de <code>develop</code> et renvoie vers l’issue qui porte son contrat. Toutes les autres entrées sont livrées aujourd’hui.</p>`,
  },
  'three-migration': {
    title: 'Migration depuis Three.js',
    description:
      'Ce qu’un hôte Three.js remplace, fonction par fonction, et les différences numériques déclarées.',
    html: `<p>Le moteur ne dépend plus de la bibliothèque hôte pour ses calculs : un hôte Three.js conserve sa scène et transmet des nombres. Les lignes ci-dessous sont livrées ; l’adaptateur et la table complète de migration relèvent de l’issue #79.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Moteur</th><th>Différence déclarée</th></tr></thead><tbody>
<tr><td><code>Matrix4.multiplyMatrices(a, b)</code></td><td><code>multiplyMatrix4(out, a, b)</code></td><td>aucune : mêmes bits, ×1,2</td></tr>
<tr><td><code>Matrix4.invert()</code></td><td><code>invertMatrix4(out, m)</code></td><td>aucune : une matrice singulière donne seize zéros</td></tr>
<tr><td><code>Matrix4.compose / decompose</code></td><td><code>composeMatrix4 / decomposeMatrix4</code></td><td>aucune</td></tr>
<tr><td><code>Vector3.dot / crossVectors / applyMatrix4</code></td><td><code>dotVector3 / crossVector3 / transformAffinePoint</code></td><td>aucune ; lecture par décalages</td></tr>
<tr><td><code>Color.convertSRGBToLinear()</code></td><td><code>srgbToLinear(c)</code></td><td>courbe exacte au lieu de constantes arrondies ; écart ≤ 1e-11</td></tr>
<tr><td><code>PerspectiveCamera.updateProjectionMatrix()</code></td><td><code>perspectiveProjection(...)</code></td><td>profondeur inversée, plan lointain infini</td></tr>
<tr><td><code>Frustum.setFromProjectionMatrix</code></td><td><code>updateCameraFrame(...)</code></td><td>le plan lointain vient du <code>far</code> déclaré</td></tr>
<tr><td><code>FrontSide / BackSide / DoubleSide</code></td><td><code>Side = 'front' | 'back' | 'double'</code></td><td>lu une fois à la frontière d’import</td></tr>
<tr><td><code>Object3D.updateMatrixWorld</code></td><td><code>updateNodeMatrixWorld(...)</code></td><td>même parcours sur des tableaux plats</td></tr>
<tr><td><code>THREE.LOD</code></td><td>—</td><td>la coupe du DAG choisit le détail par image selon l’erreur écran</td></tr>
</tbody></table></div>
<p>Les fonctions livrées et leurs preuves figurent dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/API.md">docs/API.md</a>.</p>
<h3 class="text-lg font-bold mt-4">Ce que le chemin WebGL2 dessine lui-même</h3>
<p>Sur une session WebGL2, le moteur possède le contexte et dessine chaque cluster paginé avec son propre programme — lots opaques, masqués et fondus, pages de diagnostic — et, depuis #120, les surfaces transmissives de la scène : un maillage <code>KHR_materials_transmission</code> reste une copie de scène, composée après les clusters sur un fond figé de l’image en lumière linéaire, le même modèle que la passe WebGPU. Il n’y a pas d’autre rendu pour les clusters : un matériau, une lumière ou une texture que le programme ne peut préserver fait échouer la préparation avec l’<code>EngineError</code> <code>CLUSTER_MATERIAL_UNSUPPORTED</code>, dont <code>details.reason</code> nomme l’entrée, jamais une image partielle. Le rendu hôte compose encore les copies fondues restantes, le compositeur de comparaison, les captures et les images tenues (#85).</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Moteur</th><th>Différence déclarée</th></tr></thead><tbody>
<tr><td><code>WebGLRenderer.renderTransmissionPass</code></td><td>passe de transmission de <code>WebglClusterRenderer</code></td><td>le fond est une copie brute : la rugosité ne le floute pas, un verre ne voit pas à travers un autre</td></tr>
<tr><td>extensions de <code>MeshPhysicalMaterial</code></td><td>facteurs de transmission, d’IOR et de volume seulement</td><td>clearcoat, sheen, iridescence, anisotropie, dispersion, spéculaire et leurs cartes sont refusés par leur nom</td></tr>
</tbody></table></div>
<p>Parcours en deux temps : garder Three.js pour charger et construire la scène tout en dessinant avec le moteur, puis passer au cache compilé et retirer <code>three</code> des dépendances.</p>`,
  },
  'cluster-format': {
    title: 'Pages de grappes quantifiées',
    description:
      'Ce qu’une page de grappe compilée garde par triangle, sur quelles grilles, et où lire ce que la quantification a coûté.',
    html: `<p>Chaque grappe de 128 triangles au plus est écrite une fois, par le compilateur natif, comme une page décodable seule (<code>docs/FORMAT.md</code>, format <code>WGP3</code>) : indices locaux compactés bit à bit, positions sur une grille objet, normales octaédriques sur deux octets, coordonnées de texture entières, couleurs sur un octet — et aucune tangente, qu’un nuanceur reconstruit depuis le triangle. L’en-tête porte les comptes, les drapeaux et un enregistrement de quantification par attribut vectoriel ; chaque décalage de flux s’en déduit, si bien qu’un nuanceur lit n’importe quel sommet d’une page résidente sur place, en O(1), et que le décodeur JavaScript ou WebAssembly déplie les mêmes octets en flottants pour le moteur autonome.</p>
<h3 class="text-lg font-bold mt-4">Les grilles, et ce qu’elles coûtent</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Positions.</strong> Une grille par primitive, la plus fine de deux règles : <code>2^(floor(log2(plus grande étendue)) − 16)</code>, soit environ 65 536 pas sur l’objet, et un huitième de la plus fine erreur de groupe publiée par son DAG, pour qu’un déplacement de grappe se projette sous un huitième du seuil partout où la coupe la retient — bornée pour que l’objet tienne en 2^23 pas au plus, car chaque page de la primitive garde ce seul exposant (deux grappes qui partagent un sommet le posent sur la même cellule ; une page trop large pour la grille est refusée, <code>PAGE_ATTRIBUTE_RANGE</code>, jamais regrillée). Une grappe ne dépense que les bits que sa propre boîte réclame — 10 à 13 par axe sur une ville, pas 32 —, et sa valeur décodée vaut <code>min + q × pas</code>, produit exact et une seule somme arrondie : le même flottant 32 bits sur chaque décodeur.</li>
<li><strong>Coordonnées de texture.</strong> Une grille fixe de <code>2^-14</code> : un quart de texel sur une carte de 4096 de large.</li>
<li><strong>Normales.</strong> Deux octets octaédriques, à 1° de la source. <strong>Couleurs.</strong> Une grille de <code>2^-8</code> par canal, avec des minima par page : un canal constant — l’alpha, le plus souvent — ne coûte aucun bit.</li>
<li><strong>Sommets partagés.</strong> Deux sommets source qui tombent sur les mêmes cellules ne sont gardés qu’une fois : une source qui répète un sommet par coin retombe à ses sommets distincts sans changer un triangle.</li>
<li><strong>Ce qui n’est pas écrit.</strong> Les tangentes : chaque passe d’éclairage reconstruit un seul repère cotangent depuis le triangle (<code>cotangentFrame</code>, WGSL et GLSL) ; et un jeu de coordonnées de texture qu’aucune texture du matériau ne nomme dans <code>texCoord</code>.</li>
</ul>
<p>Le coût est déclaré, jamais caché. Chaque page porte dans son en-tête son pire déplacement de position, et chaque décodeur le renvoie — le moteur autonome élargit la boîte d’une page d’exactement cela ; chaque primitive publie <code>quantization</code> — <code>positionExponent</code>, <code>uvExponent</code>, <code>maxPositionError</code> — dans le manifeste, pour le rapport, et chaque descripteur de page nomme ses octets résidents (<code>geometry.bytes</code>) à côté de ce que son décodage flottant occupe (<code>geometry.uncompressedBytes</code>). La coupe n’ajoute pas encore l’erreur de quantification à la bande d’erreur d’une grappe ; le C4 de la spécification reste ouvert.</p>
<h3 class="text-lg font-bold mt-4">Comment l’observer</h3>
<p>Sur un explorateur actif, <code>explorer.metadata.primitives</code> est le manifeste ouvert : additionnez <code>pages[].geometry.bytes</code> sur <code>pages[].count / 3</code> triangles pour le chiffre compact, <code>uncompressedBytes</code> pour le chiffre flottant, et lisez le plus grand <code>quantization.maxPositionError</code>. Dans le dépôt, <code>node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs &lt;cache&gt;/native/full</code> imprime ces chiffres pour n’importe quel cache compilé. Ce sont les chiffres du cache : le moteur de dessin WebGPU téléverse encore les sommets flottants de la source et les pages d’indices, et son pool de géométrie le dit.</p>
<h3 class="text-lg font-bold mt-4">Contrat et refus</h3>
<p>Le manifeste déclare son format de page une fois, en tête : <code>geometryPages.formatVersion</code> vaut 3 et <code>codec</code> vaut <code>quantized</code> ; le sidecar binaire qui les nomme est en version 6, chaque en-tête de page s’ouvre sur la même version, et un lecteur refuse un autre format en bloc plutôt que page par page. Une page dont l’en-tête sort du format — une largeur au-delà de 24 bits, un exposant au-delà de ±64, un drapeau inconnu, une longueur qui ne correspond pas à ses flux — est refusée avant toute lecture de flux ; un indice au-delà du nombre de sommets est refusé avant qu’un flottant ne soit produit. Les routines WGSL sont prouvées sur la carte graphique contre le décodeur JavaScript, bit à bit sur les positions, les coordonnées de texture et les couleurs (<code>test/justesse/decodage-cluster-gpu.mjs</code>).</p>`,
  },
  'memory-pools': {
    title: 'Pools mémoire et admission de la coupe',
    description:
      'Deux pools fixes réglés par l’hôte, ce qu’une vue demande au-delà, et comment lire le verdict.',
    html: `<p>Le moteur tient deux pools fixes, en octets, jamais lus sur la machine : <code>geometryPoolBytes</code> pour les pages de grappes (512 Mio par défaut, <code>floor(octets / pageBytes)</code> fentes) et <code>texturePoolBytes</code> pour les tuiles de texture virtuelle. Un budget qui ne peut être tenu tel quel est ramené à ce qui peut l’être, et la raison est publiée : <code>geometryPoolClamp</code> vaut <code>root-cover</code> (relevé à la couverture racine, toujours résidente), <code>scene</code> (la scène est plus petite), <code>ceiling</code> (au-dessus de <code>geometryPoolCeilingBytes</code>, le plus haut qu’une session puisse monter), <code>page-cap</code>, <code>device-limit</code> ou <code>null</code>.</p>
<h3 class="text-lg font-bold mt-4">Ce qu’une vue demande au-delà du pool</h3>
<p>Rien n’est refusé et rien ne s’arrête : la coupe est <strong>rendue plus grossière, jamais tronquée</strong>. Quand les pages demandées par la coupe — couverture racine comprise — dépassent les fentes, l’admission double l’erreur écran à laquelle l’image était dessinée (1 px au moins au premier débordement, puis 2, 4…), et la redescend cran par cran jusqu’à 0,125 px dès que la coupe tient avec de la marge. Deux règles la tiennent immobile : un cran ne bouge que sur une coupe échantillonnée au cran en vigueur, et un cran dont la coupe demandée a débordé pour cette vue n’est plus redemandé tant que ni la vue ni le pool ne changent. Une caméra immobile se pose donc en quelques échantillons et tient son image.</p>
<h3 class="text-lg font-bold mt-4">Changer un pool en cours de session</h3>
<p><code>explorer.setMemoryBudgets({ geometryPoolBytes, texturePoolBytes })</code> redimensionne sans vider : la couverture racine garde sa place avant toute autre page, puis les pages épinglées, puis les plus récentes ; seul ce qui ne tient plus part, et le rapport dit combien (<code>evictedPages</code>, <code>evictedTiles</code>, <code>durationMs</code>). Les groupes de liaison qui nommaient l’ancien pool sont rebâtis à l’image suivante, par l’identité de ce qu’ils nomment.</p>
<h3 class="text-lg font-bold mt-4">Lire le verdict</h3>
<p>À chaque image, <code>render()</code> renvoie <code>coverageBudgetLimited</code> (la coupe demandée ne tient pas encore) et <code>budgetPixelError</code> (0 tant que le détail demandé tient, sinon le cran auquel l’image est dessinée), ainsi que <code>geometryPoolSaturated</code>. Le diagnostic <code>coverage-budget</code>, livré pendant <code>flush()</code>, nomme chaque changement de verdict avec les fentes demandées et tenues.</p>`,
  },
};
