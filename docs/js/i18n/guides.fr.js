export const guidesFr = {
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
  'example-diagnostics': {
    title: 'Diagnostics et qualité',
    description:
      'Changez ce que dessine l’image et la finesse de la coupe sur un explorateur actif.',
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
<p>Parcours en deux temps : garder Three.js pour charger et construire la scène tout en dessinant avec le moteur, puis passer au cache compilé et retirer <code>three</code> des dépendances.</p>`,
  },
  'cluster-format': {
    title: 'Pages de grappes quantifiées',
    description:
      'Ce qu’une page de grappe compilée garde par triangle, sur quelles grilles, et où lire ce que la quantification a coûté.',
    html: `<p>Chaque grappe de 128 triangles au plus est écrite une fois, par le compilateur natif, comme une page décodable seule (<code>docs/FORMAT.md</code>, format <code>WGP3</code>) : indices locaux compactés bit à bit, positions sur une grille objet, normales octaédriques sur deux octets, coordonnées de texture entières, couleurs sur un octet — et aucune tangente, qu’un nuanceur reconstruit depuis le triangle. L’en-tête porte les comptes, les drapeaux et un enregistrement de quantification par attribut vectoriel ; chaque décalage de flux s’en déduit, si bien qu’un nuanceur lit n’importe quel sommet d’une page résidente sur place, en O(1), et que le décodeur JavaScript ou WebAssembly déplie les mêmes octets en flottants pour le moteur autonome.</p>
<h3 class="text-lg font-bold mt-4">Les grilles, et ce qu’elles coûtent</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Positions.</strong> Une grille par primitive, la plus fine de deux règles : <code>2^(floor(log2(plus grande étendue)) − 16)</code>, soit environ 65 536 pas sur l’objet, et un huitième de la plus fine erreur de groupe publiée par son DAG, pour qu’un déplacement de grappe se projette sous un huitième du seuil partout où la coupe la retient. Une grappe ne dépense que les bits que sa propre boîte réclame — 10 à 13 par axe sur une ville, pas 32 —, et sa valeur décodée vaut <code>min + q × pas</code>, produit exact et une seule somme arrondie : le même flottant 32 bits sur chaque décodeur.</li>
<li><strong>Coordonnées de texture.</strong> Une grille fixe de <code>2^-14</code> : un quart de texel sur une carte de 4096 de large.</li>
<li><strong>Normales.</strong> Deux octets octaédriques, à 1° de la source. <strong>Couleurs.</strong> Une grille de <code>2^-8</code> par canal, avec des minima par page : un canal constant — l’alpha, le plus souvent — ne coûte aucun bit.</li>
<li><strong>Sommets partagés.</strong> Deux sommets source qui tombent sur les mêmes cellules ne sont gardés qu’une fois : une source qui répète un sommet par coin retombe à ses sommets distincts sans changer un triangle.</li>
<li><strong>Ce qui n’est pas écrit.</strong> Les tangentes, reconstruites par le nuanceur depuis le triangle ; et un jeu de coordonnées de texture qu’aucune texture du matériau ne nomme dans <code>texCoord</code>.</li>
</ul>
<p>Le coût est déclaré, jamais caché. Chaque page porte dans son en-tête son pire déplacement de position ; chaque primitive publie <code>quantization</code> — <code>positionExponent</code>, <code>positionStep</code>, <code>uvExponent</code>, <code>maxPositionError</code> — dans le manifeste, et chaque descripteur de page nomme ses octets résidents (<code>geometry.bytes</code>) à côté de ce que son décodage flottant occupe (<code>geometry.uncompressedBytes</code>). La coupe n’ajoute pas encore l’erreur de quantification à la bande d’erreur d’une grappe ; le C4 de la spécification reste ouvert.</p>
<h3 class="text-lg font-bold mt-4">Comment l’observer</h3>
<p>Sur un explorateur actif, <code>explorer.metadata.primitives</code> est le manifeste ouvert : additionnez <code>pages[].geometry.bytes</code> sur <code>pages[].count / 3</code> triangles pour le chiffre compact, <code>uncompressedBytes</code> pour le chiffre flottant, et lisez le plus grand <code>quantization.maxPositionError</code>. Dans le dépôt, <code>node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs &lt;cache&gt;/native/full</code> imprime ces chiffres pour n’importe quel cache compilé. Ce sont les chiffres du cache : le moteur de dessin WebGPU téléverse encore les sommets flottants de la source et les pages d’indices, et son pool de géométrie le dit.</p>
<h3 class="text-lg font-bold mt-4">Contrat et refus</h3>
<p><code>pages[].geometry.formatVersion</code> vaut 3 et <code>codec</code> vaut <code>quantized</code> ; le sidecar binaire qui les nomme est en version 6, et un lecteur refuse une autre version en bloc plutôt que page par page. Une page dont l’en-tête sort du format — une largeur au-delà de 24 bits, un exposant au-delà de ±64, un drapeau inconnu, une longueur qui ne correspond pas à ses flux — est refusée avant toute lecture de flux ; un indice au-delà du nombre de sommets est refusé avant qu’un flottant ne soit produit. Les routines WGSL sont prouvées sur la carte graphique contre le décodeur JavaScript, bit à bit sur les positions, les coordonnées de texture et les couleurs (<code>test/justesse/decodage-cluster-gpu.mjs</code>).</p>`,
  },
};
