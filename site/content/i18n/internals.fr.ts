import { engineLink } from '../entries/internals.ts';
import type { LocaleOverlay } from './entryOverlay.ts';

/** French overlay for the "How it works" guides. */
export const internalsFr: LocaleOverlay = {
  architecture: {
    title: 'Comment une image est dessinée',
    description:
      'Le chemin de votre scène jusqu’à l’image : les morceaux gardés, les pixels remplis, la lumière ajoutée.',
    html: `<ol>
<li><strong>Choisir les morceaux.</strong> Chaque modèle est fait de petits bouts de triangles, les <em>clusters</em>, rangés à plusieurs niveaux de détail. À chaque image, le GPU choisit pour chaque partie du modèle le niveau le plus grossier qui paraît encore exact à l’écran.</li>
<li><strong>Noter qui est où.</strong> Les triangles choisis sont dessinés une fois dans un <em>tampon de visibilité</em> : pour chaque pixel, seulement le numéro du triangle qu’il montre.</li>
<li><strong>Peindre les surfaces.</strong> Ensuite chaque pixel lit le matériau de son triangle : couleur, rugosité, métal, carte de normales. Les surfaces du même genre sont peintes ensemble, en une passe.</li>
<li><strong>Éclairer, puis lisser.</strong> Les lumières et les ombres s’ajoutent, les surfaces transparentes viennent en dernier, et l’<em>antialiasing temporel</em> mélange chaque image avec les précédentes pour garder des bords lisses.</li>
</ol>
<p>Quand rien ne bouge, rien de tout cela ne tourne : le monde garde la dernière image.</p>
${engineLink('webgpu-page-raster', 'Tout le chemin')}`,
  },
  'occlusion-two-phase': {
    title: 'Sauter ce qui est caché',
    description:
      'Pourquoi un mur cache gratuitement la pièce derrière lui : le moteur ne dessine pas ce que l’image précédente a prouvé caché.',
    html: `<p>Une ville a des milliers d’objets derrière la première rangée de maisons. Les dessiner coûterait du temps pour des pixels que personne ne voit. Le moteur dessine donc en deux passes :</p>
<ol>
<li>D’abord, ce qui était visible à l’image précédente. Cela donne une idée de la profondeur : à quelle distance se trouve la surface la plus proche, partout sur l’écran.</li>
<li>Puis chaque autre morceau est testé contre cette profondeur. Un morceau entièrement derrière est sauté ; le reste est dessiné.</li>
</ol>
<p>Le test ne saute que ce qui est sûrement caché : une erreur coûte un deuxième test, jamais un pixel manquant. Il n’y a rien à régler ; c’est toujours actif.</p>
${engineLink('webgpu-page-raster', 'Pour aller plus loin')}`,
  },
  'cluster-format': {
    title: 'Comment les modèles sont rangés',
    description:
      'Ce que le compilateur écrit : de petites pages de triangles, rangées de façon compacte, chacune lisible seule.',
    html: `<p>Le compilateur coupe un modèle en clusters d’au plus cent vingt-huit triangles, et enregistre chacun comme une <em>page</em> que le navigateur peut lire seule.</p>
<ul>
<li>Positions, coordonnées de texture et normales sont arrondies sur des grilles fines. Une page devient plusieurs fois plus petite que des nombres bruts, et l’arrondi reste bien en dessous d’un pixel.</li>
<li>Chaque page dit de combien son arrondi a déplacé un point : le moteur ne devine jamais.</li>
<li>Les pages sont nommées par leur contenu : deux modèles qui partagent un morceau partagent sa page.</li>
</ul>
<p>Le format exact est dans <a href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>.</p>`,
  },
  'water-pass': {
    title: 'L’eau et le verre',
    description:
      'Comment un matériau transparent plie ce qu’il y a derrière : le moteur relit l’image qu’il a déjà dessinée.',
    html: `<p>L’eau et le verre épais ne se dessinent pas comme de la peinture. Le moteur dessine d’abord tout ce qui est solide, garde une copie de cette image, puis, pour chaque pixel d’eau ou de verre, lit la copie un peu à côté, comme la lumière se plie en traversant la surface.</p>
<ul>
<li>Combien elle se plie et quelle couleur elle prend viennent du matériau importé : son indice de réfraction, son épaisseur et sa teinte.</li>
<li>La surface reflète aussi le ciel et les lumières, davantage en lumière rasante, comme une vraie eau.</li>
<li>Une limite : un verre ne montre pas un autre verre derrière lui.</li>
</ul>
${engineLink('transparent-surfaces', 'Pour aller plus loin')}`,
  },
  'memory-pools': {
    title: 'Où va la mémoire',
    description:
      'Deux quantités fixes de mémoire GPU, une pour les formes et une pour les textures, et ce qui arrive quand une vue en demande plus.',
    html: `<p>Le moteur garde deux <em>réserves</em> en mémoire GPU : une pour les pages de formes, une pour les tuiles de textures. Vous fixez leur taille avec <code>world.budget</code> (chapitre 8) ; le moteur ne lit jamais la machine pour la deviner.</p>
<ul>
<li>La version la plus grossière de chaque modèle reste toujours dedans : il n’y a jamais de trou.</li>
<li>Quand une vue demande plus qu’une réserve ne contient, le moteur dessine avec des morceaux plus grossiers jusqu’à ce que tout tienne : moins de détail, jamais de partie manquante.</li>
<li>Changer une réserve pendant que la scène tourne garde ce qui tient encore et lâche le reste.</li>
</ul>
${engineLink('memory', 'Pour aller plus loin')}`,
  },
  'texture-compression': {
    title: 'Des textures plus petites',
    description:
      'Les textures sont coupées en tuiles, chargées seulement là où l’image en a besoin, et compressées quand cela ne change pas l’image.',
    html: `<p>Une texture est une image peinte sur une surface. Le compilateur prépare chacune à toutes les tailles, de la pleine jusqu’à la toute petite, et les coupe en tuiles carrées. Le navigateur ne charge que les tuiles que l’image montre, à la taille où elle les montre.</p>
<p>Le compilateur peut aussi ranger les tuiles dans un format compressé que le GPU lit directement, environ quatre fois plus petit. Il ne garde la version compressée que si elle a l’air identique à l’originale ; sinon la tuile reste non compressée. Une tuile pas encore arrivée montre une version plus petite d’elle-même, jamais un trou.</p>
${engineLink('virtual-textures', 'Pour aller plus loin')}`,
  },
  'shadow-pages': {
    title: 'Des ombres en morceaux',
    description:
      'Pourquoi une caméra qui bouge ne redessine qu’une bande de ses ombres : la carte d’ombres est coupée en pages, comme les modèles.',
    html: `<p>Pour savoir ce qui est à l’ombre, chaque lumière dessine la scène depuis son propre point de vue dans une <em>carte d’ombres</em> : une image de distances. Le moteur coupe ces cartes en pages.</p>
<ul>
<li>Le soleil couvre la vue avec quelques cartes, fines près de la caméra et plus grossières au loin.</li>
<li>Quand la caméra bouge un peu, seule la bande de pages entrée dans la vue est redessinée ; les autres sont gardées.</li>
<li>Une page pas encore prête emprunte la carte plus grossière : une ombre ne manque jamais.</li>
</ul>
${engineLink('direct-lighting', 'Pour aller plus loin')}`,
  },
};
