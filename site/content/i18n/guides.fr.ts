import type { LocaleOverlay } from './entryOverlay.ts';

export const guidesFr: LocaleOverlay = {
  'example-many-lights': {
    title: 'Beaucoup de lumières, un seul budget',
    description:
      'Déclarez un anneau de lampes avec ombres, lisez le budget d’échantillonnage, et distinguez une image immobile convergée d’une image en mouvement.',
    html: `<p>Chaque lumière déclarée est triée par tuile d’écran de 16×16 pixels, conservées jusqu’à un nombre fixe. Ce qu’un pixel fait de la liste de sa tuile dépend de l’image : une image <strong>en mouvement</strong>, que l’anticrénelage temporel accumule, pèse chaque lumière sans son ombre — la part bon marché — et n’en calcule entièrement que quelques-unes, lecture d’ombre comprise : une lumière qui vaut la part d’un échantillon est calculée exactement, les autres sont tirées en proportion de leur poids et divisées par leur probabilité, si bien que l’historique moyenne une estimation sans biais. Une image <strong>immobile</strong> calcule toutes les lumières de la tuile et converge vers la somme exacte sur ses images accumulées, puis se tient : deux exécutions donnent la même image au bit près.</p>
<p>Ce qu’un hôte observe : <code>metric.frame(world)</code> lit les pages résidentes et les triangles sélectionnés d’une image posée ; le monde lui-même se met en pause une fois l’image tenue pendant 120 images, ce qui distingue une image immobile convergée d’une image en mouvement. Le coût déclaré est un léger grain sur les surfaces éclairées pendant que la caméra bouge, mesuré dans <code>docs/SDK.md</code> ; le gain, caméra mobile sur trente-deux lampes avec ombres atteignant un même pixel, est une enveloppe GPU de 39,9 → 17,9 ms en 2496×1404. La <a class="link link-primary" href="#/fr/playground/many-lights-sampling">leçon de l’anneau</a> le montre en direct.</p>`,
  },
  'example-world': {
    title: 'Démarrage et budgets du monde',
    description:
      'Démarrage interactif avec des budgets mémoire explicites ; le monde gère les contrôles, la taille et le rendu à la demande.',
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
<p>Lisez la cadence sur les pics, jamais sur les médianes : <code>textureUploadPeakMs</code> est la pire passe budgétée depuis le départ, <code>textureUploadMs</code> la dernière passe (<code>null</code> quand elle n’avait rien à servir, ou sous une barrière), <code>textureTilesDeferred</code> ce que le budget a repoussé à l’image suivante, et <code>world.stageProfile()</code> donne les p50/p95 de l’étape « Textures ». Mesuré sur le cache Emerald au commit 8c20f71b, vue générale, cache froid et caméra mobile (1280×720, DPR 1, seuil 1 px, deux exécutions, Apple M2 Max, Chrome 153) : le p95 de l’étape « Textures » passe de 4,2–9,3 ms à 1,1–1,2 ms, le p99 de l’intervalle d’image du navigateur de 33–133 ms à 16,8 ms ; le coût déclaré est une image plus grossière pendant que les tuiles arrivent — 8 à 12 tuiles par image, 1,2–1,8 niveau manquant en moyenne en fin de traversée contre 0,6–0,7 avant — et une pose fixe converge vers la même capture à 0 px. L’horloge de la passe couvrant aussi le suivi des ombres des tuiles arrivées (619e34fb, même commande, deux exécutions) : « Textures » 1,0 / 1,2 ms p50/p95, pic de session 5,1–16,6 ms sur les quatre sessions (les deux exécutions et leurs répétitions A/A), sur la seule image qui pose la première tuile couleur. Le banc la lit avec <code>--budget-textures &lt;ms&gt;</code> (<code>scripts/mesure/README.md</code>).</p>`,
  },
  'example-diagnostics': {
    title: 'Diagnostics et qualité',
    description:
      'Changez ce que dessine l’image sur un monde actif ; et ce qu’un appareil GPU perdu laisse à l’écran — rien de périmé.',
  },
  'quick-start': {
    title: 'Démarrage rapide',
    description:
      'D’un fichier glTF à une scène diffusée dans un canevas : compilez une fois, explorez dans le navigateur.',
    html: `<p>Le moteur diffuse la géométrie par grappes : un compilateur natif découpe une fois la scène source en pages, puis l’explorateur du navigateur ne lit que celles demandées par la caméra, sous des budgets mémoire fixes. Le même point d’entrée sélectionne le contrat adapté à chaque environnement.</p>
<ol>
<li><strong>Compilez</strong> sur la machine qui détient la source avec <code>web-geometry</code>. Le cache reçoit manifeste, pages et textures annexes ; <code>resourceBaseUrl</code> est l’URL que lira le navigateur.</li>
<li><strong>Explorez</strong> dans le navigateur avec le même import <code>web-geometry</code>. <code>createWorld</code> accepte un ID ou un élément canevas et renvoie un monde vide ; <code>scene.load</code> y ajoute ensuite un modèle compilé, comme tout ce qu’on ajoute à la scène. Le monde soumet des images à la demande et se met en pause une fois l’image tenue. Donnez au canevas une largeur et une hauteur CSS ; appelez <code>dispose()</code> à la fermeture.</li>
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
<li><code>metric.frame(world)</code> porte <code>hizTestedClusters</code>, <code>hizRejectedClusters</code>, <code>hizRejectedTriangles</code> et <code>hizCountedFrame</code> : ce que la seconde passe a testé et rejeté sur l’image décrite par le dernier relevé périodique — la carte compte, l’hôte relit une image sur quinze, et <code>null</code> signifie aucun relevé encore, jamais zéro.</li>
<li><code>world.stageProfile()</code> porte l’étape de partition : <code>lignes</code> (lignes résidentes), <code>occulteurs</code>, <code>testees</code>, <code>historiqueOcculteurs</code> (lignes dessinées à l’image précédente) et <code>retiresParLaPyramide</code> (lignes que cette pyramide a retirées), avec les millisecondes GPU des passes <code>WG partition</code>, <code>WG HiZ pyramid</code>, <code>WG HiZ test</code>, <code>WG visibility primary</code> et <code>WG visibility secondary</code>.</li>
<li>Le banc de mesure imprime les mêmes nombres par vue sous <em>Hi-Z tested/rejected</em> ; la vue de rue de la scène de référence rejette 5 131 des 24 902 lignes là où l’ancienne histoire en rejetait 440.</li>
</ul>
<p>La leçon <a class="link link-primary" href="#/fr/lessons/occlusion-two-phase">Cacher un anneau derrière un anneau</a> montre les compteurs bouger sur le jardin quand l’œil descend à hauteur d’anneau.</p>`,
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
<li><code>world.stageProfile()</code> dépose les deux passes sur l’étape <em>transparents</em>, par étiquette ; une scène sans matériau transmissif ne les encode jamais et n’alloue qu’un texel à leurs cibles. Une image dont toutes les surfaces transmissives sont hors champ n’en encode rien non plus.</li>
<li>Le budget des cibles d’image compte la couleur figée (8 octets par pixel) et la profondeur d’eau (4) seulement quand la scène transmet : <code>gpuFrameTargetBytes</code> le dit. Les surfaces elles-mêmes sont celles de la résolution opaque, déjà payées.</li>
<li>Une vue de diagnostic — grappes, fil de fer, erreur écran —, une variante GPU de diagnostic, ou une capture depuis une seconde caméra, qui lit le tampon de surface comme opaque, dessine la tranche de transmission comme un mélange de plus, si bien que la variante mesure le même étage de fragments sur tous les transparents.</li>
</ul>`,
  },
  architecture: {
    title: 'Architecture et règles',
    description:
      'Les promesses du moteur et les conventions suivies par chaque fonction ci-dessous.',
    html: `<p>La mission décrite dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/PRODUCT_PRINCIPLES.md">Principes du produit</a> est une géométrie virtualisée pour le web : grappes diffusées, une coupe du DAG par image, tampon de visibilité, anticrénelage temporel, budgets mémoire et de diffusion fixes. Les étapes d’éclairage figurent dans <code>docs/LIGHTING_STRATEGY.md</code>.</p>
<h3 class="text-lg font-bold mt-4">Une image, sur le chemin WebGPU</h3>
<p>Le GPU coupe le DAG et compacte les grappes à dessiner ; la rastérisation matérielle écrit un <strong>tampon de visibilité</strong> (un identifiant par pixel) derrière un test d’occultation Hi-Z ; la <strong>résolution des matériaux</strong> reconstruit ensuite la surface de chaque pixel — couleur de base, normale, rugosité, émission — <em>une classe de matériau par passe</em> : une passe écrit la classe de chaque pixel comme une profondeur exacte, puis chaque classe trace un triangle plein écran à sa propre profondeur sous le test matériel <code>equal</code>, avec un pipeline compilé pour ses seuls traits (cartes, découpe, normales de sommet, tangentes). Suivent l’éclairage différé, les transparents, l’anticrénelage temporel et la présentation. Observez-le en direct avec <code>world.diagnostic.mode = 'triangles'</code> et le diagnostic <code>material-classes-ready</code> (les classes de la scène).</p>
<h3 class="text-lg font-bold mt-4">Conventions de l’API du monde</h3>
<p>Un état lu et écrit est une propriété (<code>camera.near = 0.1</code>, <code>world.exposure</code>) ; une valeur à plusieurs composantes est un objet à <code>.set()</code> (<code>position.set(0, 1, 0)</code>) ; une méthode est une action ou un calcul (<code>lookAt</code>, <code>add</code>, <code>load</code>, <code>world.stageProfile()</code>) — chaque fonction qui écrit applique elle-même ses conséquences, rien n’est mis à jour à la main. Les familles sont au singulier ; un membre qui produit une chose de la scène porte le nom de cette chose (<code>geometry.box</code>), un membre qui met en place une machinerie porte <code>create</code> + son nom (<code>page.createStreamer</code>). Contrat complet, chaque famille et un exemple pour chacune : <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md#api-rule">docs/SDK.md</a>.</p>
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
      'Ce qu’une page qui écrit déjà du Three.js change, appel par appel, pour écrire directement contre le monde.',
    html: `<p>Une page qui construit déjà une scène Three.js ne l’enveloppe pas dans un adaptateur : elle écrit les mêmes formes avec les familles propres à ce moteur, et le monde possède la scène, la caméra, le moteur de rendu et la boucle dès le premier appel. Three.js lui-même reste un témoin de comparaison, atteint par le point d’entrée de mesure pour le banc et les preuves — jamais mélangé à un monde publié.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Ce moteur</th></tr></thead><tbody>
<tr><td><code>new THREE.WebGLRenderer()</code> + <code>new THREE.Scene()</code> + <code>new THREE.PerspectiveCamera(...)</code></td><td><code>createWorld('id')</code> — un seul appel possède le moteur de rendu, la scène et la caméra</td></tr>
<tr><td><code>new THREE.Mesh(g, m)</code></td><td><code>object.mesh(g, m)</code></td></tr>
<tr><td><code>new THREE.BoxGeometry(w, h, d)</code></td><td><code>geometry.box(w, h, d)</code></td></tr>
<tr><td><code>new THREE.MeshStandardMaterial({ ... })</code></td><td><code>material.meshStandard({ ... })</code></td></tr>
<tr><td><code>new THREE.DirectionalLight(color, intensity)</code></td><td><code>light.directional({ color, intensity })</code></td></tr>
<tr><td><code>new THREE.Vector3(...)</code> / <code>Matrix4</code> / <code>Quaternion</code> / <code>Color</code></td><td><code>math.vector3(...)</code> / <code>math.matrix4()</code> / <code>math.quaternion()</code> / <code>math.color(...)</code></td></tr>
<tr><td><code>new THREE.TextureLoader().load(url, cb)</code></td><td><code>await loader.texture(url)</code></td></tr>
<tr><td><code>THREE.DoubleSide</code></td><td><code>side.double</code></td></tr>
<tr><td><code>renderer.setAnimationLoop(fn)</code></td><td><code>world.onFrame(fn)</code> ; <code>world.invalidate()</code> après un changement que le monde ne verrait pas de lui-même</td></tr>
<tr><td><code>camera.updateProjectionMatrix()</code></td><td>rien à appeler — chaque propriété (<code>camera.fov = …</code>, <code>camera.near = …</code>) applique sa propre conséquence</td></tr>
<tr><td><code>new GLTFLoader().load(url, cb)</code></td><td><code>await world.scene.load(manifestUrl)</code>, une fois la source compilée — le modèle se diffuse ensuite par pages au lieu de charger en entier</td></tr>
<tr><td><code>THREE.LOD</code> / <code>THREE.InstancedMesh</code> / <code>THREE.BatchedMesh</code></td><td>rien : la coupe du DAG, une par image, est ce que ces classes existent pour approcher (délibérément absentes : un rendu par maillage entier en a besoin, un rendu par pages non)</td></tr>
</tbody></table></div>
<h3 class="text-lg font-bold mt-4">Où les deux diffèrent vraiment</h3>
<p>Ce que le moteur calcule lui-même lit les mêmes entrées physiques que Three.js, avec deux écarts déclarés : la conversion sRGB suit la courbe exacte plutôt que les constantes arrondies de Three (écart ≤ 1e-11, invisible sur 8 bits), et la projection de la caméra est à profondeur inversée avec un plan lointain infini (<code>near</code> devient 1, l’infini devient 0) — les mêmes optiques relisent une profondeur différente.</p>
<p>Les noyaux de calcul par lots sur tableaux plats qu’un hôte pilotant des milliers d’objets à la main pourrait chercher (<code>batch.multiplyMatrix4</code>, <code>batch.transformPoints</code>, …) sont une famille publique, exportée par <code>web-geometry</code> comme les autres : ils sont catalogués lot par lot dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/API.md">docs/API.md</a>.</p>`,
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
<p>Sur un monde actif, <code>metadata.primitives</code> d’un modèle chargé est le manifeste ouvert : additionnez <code>pages[].geometry.bytes</code> sur <code>pages[].count / 3</code> triangles pour le chiffre compact, <code>uncompressedBytes</code> pour le chiffre flottant, et lisez le plus grand <code>quantization.maxPositionError</code>. Dans le dépôt, <code>node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs &lt;cache&gt;/native/full</code> imprime ces chiffres pour n’importe quel cache compilé. Ce sont les chiffres du cache : le moteur de dessin WebGPU téléverse encore les sommets flottants de la source et les pages d’indices, et son pool de géométrie le dit.</p>
<h3 class="text-lg font-bold mt-4">Contrat et refus</h3>
<p>Le manifeste déclare son format de page une fois, en tête : <code>geometryPages.formatVersion</code> vaut 3 et <code>codec</code> vaut <code>quantized</code> ; le sidecar binaire qui les nomme est en version 7, chaque en-tête de page s’ouvre sur la même version, et un lecteur refuse un autre format en bloc plutôt que page par page. Une page dont l’en-tête sort du format — une largeur au-delà de 24 bits, un exposant au-delà de ±64, un drapeau inconnu, une longueur qui ne correspond pas à ses flux — est refusée avant toute lecture de flux ; un indice au-delà du nombre de sommets est refusé avant qu’un flottant ne soit produit. Les routines WGSL sont prouvées sur la carte graphique contre le décodeur JavaScript, bit à bit sur les positions, les coordonnées de texture et les couleurs (<code>test/justesse/decodage-cluster-gpu.mjs</code>).</p>`,
  },
  'memory-pools': {
    title: 'Pools mémoire et admission de la coupe',
    description:
      'Deux pools fixes réglés par l’hôte, ce qu’une vue demande au-delà, et comment lire le verdict.',
    html: `<p>Le moteur tient deux pools fixes, en octets, jamais lus sur la machine : un pool de géométrie pour les pages de grappes (512 Mio par défaut, <code>floor(octets / pageBytes)</code> fentes) et un pool de texture pour les tuiles de texture virtuelle. <code>world.budget.geometryPool</code> et <code>world.budget.texturePool</code> sont des propriétés lues et écrites : écrire l’une la fixe, ramenée aux propriétés en lecture seule <code>world.budget.geometryPoolCeiling</code>/<code>world.budget.texturePoolCeiling</code> — 512 Mio fixes chacune, les budgets de départ du moteur, jamais lus sur la machine ; la relire renvoie ce qui est réellement tenu.</p>
<h3 class="text-lg font-bold mt-4">Ce qu’une vue demande au-delà du pool</h3>
<p>Rien n’est refusé et rien ne s’arrête : la coupe est <strong>rendue plus grossière, jamais tronquée</strong>. Quand les pages que la coupe demande — couverture racine comprise — dépassent les fentes, l’admission relâche l’erreur écran à laquelle l’image est dessinée, cran par cran, jusqu’à ce que la coupe tienne avec de la marge. Une caméra immobile se pose en quelques échantillons et tient son image ; <code>metric.frame(world)</code> lit ce qu’une image posée a réellement dessiné.</p>
<h3 class="text-lg font-bold mt-4">Changer un pool en cours de session</h3>
<p>Assigner <code>world.budget.geometryPool</code> ou <code>world.budget.texturePool</code> redimensionne sans vider : la couverture racine garde sa place avant toute autre page, puis les pages épinglées, puis les plus récentes ; seul ce qui ne tient plus part. Deux écritures en une image ne rééquilibrent qu’une fois.</p>`,
  },
  'texture-compression': {
    title: 'Textures compressées par blocs sous une barrière de qualité',
    description:
      'BC7/BC5 pour les cartes de bureau, ASTC 4×4 pour les mobiles, cuits une fois par le compilateur et gardés seulement là où l’image ne bouge pas ; les pools tiennent une voie par format.',
    html: `<p>Les textures des matériaux sont virtuelles : le compilateur cuit toute la chaîne de mips de chaque texture lue par un atlas, le navigateur ne lit que les tuiles de 128×128 demandées par l’image, et des pools fixes les portent. Sans compression, un texel coûte quatre octets dans le pool. Le compilateur peut aussi cuire chaque niveau dans une <strong>famille de blocs</strong> à côté du PNG sans perte — la famille BC (<code>--textures-format=bc7</code>, par défaut : BC7 pour la couleur et les cartes de données lisses, BC5 pour les cartes de normales) ou ASTC 4×4 (<code>astc</code> : mode d’extrémités 12, ou luminance-alpha pour les normales) — un octet par texel, et la queue de chaque chaîne voyage dans l’annexe du manifeste dans cette famille aussi. La règle du dépôt est qu’aucune optimisation ne fait bouger l’image : une chaîne n’est gardée en blocs que <strong>sous une barrière de qualité</strong>.</p>
<h3 class="text-lg font-bold mt-4">La barrière, à la cuisson</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Relue, jamais crue.</strong> Chaque niveau est décodé à nouveau par un décodeur indépendant et comparé à la chaîne RGBA8 sur les canaux que les matériaux lisent : l’alpha d’une couleur de base opaque n’est pas lu, les trois canaux d’une carte de normales le sont, son Z reconstruit contre le Z qu’elle stocke.</li>
<li><strong>La barre.</strong> Un PSNR de 48 dB sur toute la chaîne, aucun texel décalé de plus de 3 niveaux sur 255 sur un canal lu — la barre d’une capture fixe, sous ce qu’un écran 8 bits distingue, portée au texel —, et aucun texel d’une texture masquée qui change de côté de son seuil alpha. Sous la barre, la chaîne reste sans perte dans cette famille : pas de fichier de blocs, pas de queue en blocs, et le mot de disposition de l’annexe le dit.</li>
<li><strong>Les normales sur deux canaux, jamais en BC7.</strong> Une texture que seul <code>normalTexture</code> lit est ajustée canal par canal — X et Y chacun sur sa propre échelle — et le shader reconstruit Z comme le reste unitaire. Un Z stocké qui n’est pas ce reste échoue à la barrière, et la carte reste sans perte.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Ce que le moteur en fait</h3>
<p>Chaque atlas a un pool par <strong>voie</strong> : <code>lossless</code> (RGBA8), <code>rgba</code> (blocs BC7 ou ASTC) et <code>two-channel</code> (BC5 ou ASTC luminance-alpha). <code>textureCompression</code> (<code>'auto'</code> par défaut) nomme la famille que la session lit — la première que la carte sait lire et où le cache garde des chaînes, BC avant ASTC ; RGBA8 quand la carte n’a ni l’une ni l’autre, quand aucune chaîne n’est gardée dans une famille qu’elle a, ou que l’hôte demande <code>'none'</code> —, et chaque texture prend la voie où sa chaîne a été gardée : une chaîne refusée, une texture sans chaîne cuite entière ou une image de l’hôte se lit dans la voie sans perte, quelle que soit la carte. <code>texturePoolBytes</code> reste le même réservoir fixe, moitié par atlas ; dans un atlas, chaque voie qui a des textures reçoit une couche, puis le reste selon les octets que ses tuiles prendraient, et jamais plus que ce que ses tuiles demandent.</p>
<h3 class="text-lg font-bold mt-4">Ce qu’il faut lire</h3>
<p>Le rapport de compilation (<code>texturePreviews</code> dans <code>clusters.json</code>) publie la barre, combien de chaînes chaque famille a gardées dans chaque disposition, leurs quantiles de PSNR, et chaque chaîne laissée sans perte avec ses chiffres. Dans les métriques d’image, <code>texturePoolFormat</code> nomme la famille tenue (<code>bc7</code>, <code>astc</code> ou <code>rgba8</code>), <code>texturePoolLayers</code> et <code>texturePoolBytes</code> additionnent chaque pool de voie, <code>textureResidentBytes</code> compte chaque voie à son propre coût par texel ; le diagnostic <code>material-textures-ready</code> liste les pools et les textures par voie. Mesuré sur la scène de référence, les captures fixes de trois vues bougent d’au plus 3 sur 255 sur n’importe quel canal de n’importe quel pixel avec l’une ou l’autre famille, pour 25,5 → 19,7 Mo, 56,1 → 40,3 Mo et 76,4 → 64,3 Mo d’octets de texture résidents avec la famille BC (21,6, 43,2 et 71,1 Mo avec ASTC).</p>
<p>Contrat dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>, disposition du cache et barrière dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>, option de cuisson dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/COMPILER.md">docs/COMPILER.md</a>.</p>`,
  },
};
