import { courseEntries } from '../entries/courseHtml.ts';
import type { ChapterText, CourseWords } from '../entries/courseHtml.ts';
import type { LocaleOverlay } from './entryOverlay.ts';

const WORDS: CourseWords = {
  picture: 'Ce que vous allez construire',
  steps: 'Pas à pas',
  code: 'Le code',
  tryIt: 'Essayez',
  open: 'Ouvrez-le en grand, lisez tout son code et modifiez-le',
  next: 'Chapitre suivant',
  end: 'Parcourez maintenant les exemples',
};

/** Each chapter's words, in French. */
const TEXT: Record<string, ChapterText> = {
  'create-a-world': {
    title: 'Créer un monde',
    description:
      'Un monde est l’endroit où vit votre scène 3D. Un seul appel le crée, et il dessine dans un canvas de votre page.',
    steps: [
      'Récupérez le moteur. Il n’est pas encore sur npm : clonez le dépôt, lancez <code>pnpm install</code> puis <code>pnpm run build</code> dedans, puis ajoutez-le à votre projet depuis ce dossier.',
      'Placez un <code>&lt;canvas&gt;</code> dans votre page. Un canvas est un rectangle de la page dans lequel un programme peut dessiner. Donnez-lui une largeur et une hauteur.',
      'Appelez <code>createWorld</code> avec l’id du canvas. Vous obtenez un monde : une <em>scène</em> (la liste des choses à dessiner), une <em>caméra</em> (l’œil qui les regarde) et tout ce qui dessine l’image.',
      'Ajoutez un cube et une lumière, pour avoir quelque chose à voir. Les chapitres suivants expliquent ces lignes une par une.',
      'Quand votre page se ferme, appelez <code>world.dispose()</code> pour rendre la mémoire.',
    ],
    tryIt:
      'Faites glisser l’image pour tourner autour du cube. Choisissez une autre couleur dans le panneau.',
  },
  'add-a-shape': {
    title: 'Ajouter une forme',
    description:
      'Tout ce que vous voyez est un mesh : une forme avec un matériau dessus. Créez la forme avec `geometry`, enveloppez-la dans un mesh avec `object.mesh`, et ajoutez-la à la scène.',
    steps: [
      'Une forme, ou <em>géométrie</em>, n’est que la silhouette : ses coins et ses faces. <code>geometry.box(1, 1, 1)</code> est un cube d’un mètre de côté, <code>geometry.sphere(0.75)</code> une boule. Il y a aussi des cylindres, des cônes, des anneaux, des tores et d’autres.',
      'Un <em>mesh</em> est une forme plus un matériau : <code>object.mesh(forme, matériau)</code>. Le matériau, c’est le chapitre suivant.',
      'Placez un mesh avec <code>position</code>, tournez-le avec <code>rotation</code> et changez sa taille avec <code>scale</code>. Les rotations sont en radians : un tour complet vaut <code>Math.PI * 2</code>.',
      '<code>object.group()</code> réunit plusieurs meshes pour qu’ils bougent ensemble, comme le plateau tournant.',
      'Rien n’apparaît tant que vous n’appelez pas <code>world.scene.add(mesh)</code>.',
    ],
    tryIt: 'Changez la couleur des formes, arrêtez la rotation ou accélérez-la.',
  },
  'give-it-a-material': {
    title: 'Lui donner un matériau',
    description:
      'Un matériau dit de quoi une surface est faite : sa couleur, si c’est du métal, si elle est rugueuse. `material.meshStandard` couvre presque tout.',
    steps: [
      "<code>color</code> est la peinture, écrite comme une couleur du web : <code>'#e8a25a'</code>.",
      '<code>metalness</code> va de 0 (plastique, argile, bois) à 1 (métal). Un métal montre les couleurs de ce qu’il reflète.',
      '<code>roughness</code> va de 0 (lisse comme un miroir, avec de petits reflets nets) à 1 (rugueux comme la craie, avec une lumière douce partout).',
      'Changez un matériau quand vous voulez : <code>chrome.roughness = 0.3</code>. Tous les meshes qui l’utilisent changent en même temps.',
      'Le verre, c’est <code>material.meshPhysical</code> avec <code>transmission: 1</code> : la lumière le traverse. <code>ior</code>, l’indice de réfraction, dit combien il plie la lumière : 1,5 pour une vitre. Voyez-le dans <a href="#/fr/examples/glass-on-the-table">Du verre sur la table</a>.',
    ],
    tryIt:
      'Chaque colonne est plus métallique que la précédente, chaque rangée plus rugueuse. Choisissez une couleur pour toutes, et rendez les lampes plus fortes.',
  },
  'light-it': {
    title: 'L’éclairer',
    description:
      'Sans lumière, tout est noir. Ajoutez des lumières avec la famille `light`, et laissez-les projeter des ombres.',
    steps: [
      '<code>light.directional</code> est le soleil : tous ses rayons vont dans le même sens, et <code>position</code> dit d’où il brille.',
      '<code>light.point</code> est une ampoule : elle éclaire tout autour et faiblit avec <code>distance</code>. <code>light.spot</code> est une lampe torche : un cône de lumière.',
      '<code>light.ambient</code> est une lumière douce qui vient de partout. Un peu suffit pour que les ombres ne soient pas toutes noires.',
      'Ajoutez <code>castShadow: true</code> et ce que la lumière touche projette une ombre.',
      '<code>intensity</code> est la force d’une lumière, <code>color</code> sa couleur. Changez-les quand vous voulez : <code>sun.intensity = 1</code>.',
    ],
    tryIt:
      'Changez l’heure : le soleil traverse le ciel, rougit au crépuscule, et chaque ombre tourne avec lui.',
  },
  'move-the-camera': {
    title: 'Déplacer la caméra',
    description:
      'La caméra est votre œil dans le monde. Placez-la dans le code, puis laissez le lecteur la bouger avec `world.controls`.',
    steps: [
      '<code>world.camera.position.set(x, y, z)</code> place l’œil ; <code>world.camera.lookAt(x, y, z)</code> le tourne vers un point.',
      "Un <em>contrôleur</em> transforme la souris, les doigts et le clavier en mouvements de caméra. Choisissez-le en créant le monde : <code>createWorld('view', { controls: 'orbit' })</code>.",
      "<code>'orbit'</code> tourne autour d’un point : glissez pour tourner, glissez avec le bouton droit pour décaler, la molette pour zoomer. <code>world.controls.target</code> est ce point.",
      "Il y en a d’autres : <code>'fly'</code> (touches W A S D, voir <a href=\"#/fr/examples/fly-over-a-model-town\">Survoler une ville miniature</a>), <code>'firstPerson'</code> (marcher, voir <a href=\"#/fr/examples/walk-through-a-temple\">Marcher dans un temple</a>), <code>'trackball'</code>, <code>'panZoom'</code> pour une carte à plat, et <code>'none'</code> quand votre code bouge la caméra lui-même.",
      "Changez à tout moment : <code>world.controls.kind = 'fly'</code>.",
    ],
    tryIt:
      'Glissez pour tourner autour de l’horloge, et zoomez à la molette sur les dents des engrenages.',
  },
  animate: {
    title: 'Animer',
    description:
      'Pour faire bouger les choses, donnez au monde une fonction à lancer avant chaque image, avec `world.onFrame`.',
    steps: [
      'Le monde dessine une nouvelle image plusieurs fois par seconde. Chaque image est une <em>frame</em>. <code>world.onFrame(fn)</code> lance <code>fn</code> avant chacune.',
      '<code>fn</code> reçoit <code>delta</code> : les secondes écoulées depuis la dernière image. Multipliez vos vitesses par lui, et tout bouge aussi vite sur un écran rapide que sur un lent.',
      'Appelez <code>world.invalidate()</code> pour dire « redessine ». Quand personne ne demande d’image, le monde se repose : une scène immobile ne coûte rien.',
      'Pour un mouvement fait de poses, comme une marche, utilisez le mixeur d’animation. <code>animation.clip</code> liste les poses et leur moment ; <code>animation.createMixer(robot).play(clip)</code> les joue et remplit les instants entre elles. Voyez <a href="#/fr/examples/a-robot-that-walks-and-waves">Robot aux gestes mêlés</a>.',
    ],
    tryIt:
      'Changez la hauteur et la vitesse de la vague. Double-cliquez sur le sol pour lâcher une nouvelle pierre.',
  },
  'load-a-compiled-model': {
    title: 'Charger un modèle compilé',
    description:
      'Un modèle fait dans un logiciel 3D est compilé une fois, puis une ligne l’ajoute à votre monde. Le moteur ne charge ensuite que les parties que la caméra voit.',
    steps: [
      'La plupart des logiciels 3D exportent des fichiers <em>glTF</em> (<code>.gltf</code> ou <code>.glb</code>), le format courant des modèles 3D.',
      'Le compilateur coupe le modèle en petits morceaux appelés <em>clusters</em>, des bouts d’une centaine de triangles, et range chacun à plusieurs niveaux de détail. Lancez-le une fois, dans un terminal : le modèle, le dossier de sortie, <code>full</code> pour garder tout le modèle, un budget de triangles, et l’adresse web où le dossier sera servi.',
      'Placez le dossier de sortie sur votre serveur web, à cette adresse.',
      'Dans la page, <code>await world.scene.load(url)</code> ajoute le modèle. Il rend le modèle, avec sa taille dans <code>bounds</code>, pour cadrer la caméra.',
      'Le modèle n’est jamais téléchargé en entier. Le moteur va chercher les morceaux que la caméra voit, plus fins quand vous approchez. C’est le <em>streaming</em>.',
    ],
    tryIt: 'Faites tourner la lampe autour de la tête, montez-la, changez sa couleur.',
  },
  'stay-within-memory': {
    title: 'Tenir dans la mémoire',
    description:
      'Un gros modèle n’a pas besoin de tenir en mémoire. Vous donnez au moteur une quantité fixe, et il y garde ce dont la vue a le plus besoin.',
    steps: [
      'Le <em>GPU</em>, la puce qui dessine l’image, a sa propre mémoire, et une page web ne peut pas demander combien il en reste. Vous choisissez donc la quantité vous-même.',
      '<code>world.budget.geometryPool</code> est la mémoire des formes ; <code>world.budget.texturePool</code> celle des images peintes sur les surfaces, les <em>textures</em>. Les deux se comptent en octets.',
      'Quand la vue demande plus que le budget, rien ne casse : les parties lointaines et petites sont dessinées avec moins de triangles jusqu’à ce que tout tienne. L’image reste entière, juste moins détaillée.',
      'Relisez la valeur pour voir ce que le moteur garde vraiment.',
      "Voyez les morceaux avec <code>world.diagnostic.mode = 'clusters'</code> : chaque cluster a sa couleur.",
    ],
    tryIt:
      'Baissez la mémoire : les morceaux grossissent, le bâtiment reste entier. Passez la vue sur <code>clusters</code> pour les voir.',
  },
  'your-own-scene': {
    title: 'Votre propre scène',
    description:
      'Vous connaissez maintenant chaque pièce. Ce chapitre les assemble dans une petite scène que vous pouvez copier et faire vôtre.',
    steps: [
      'Commencez comme au chapitre 1 : un canvas, et <code>createWorld</code> avec le contrôleur <code>orbit</code>.',
      'Construisez avec des formes et des matériaux, comme aux chapitres 2 et 3 : une île, une maison, un arbre et un moulin.',
      'Éclairez avec un soleil qui projette des ombres (chapitre 4), et déplacez-le avec l’heure.',
      'Faites tourner les ailes dans <code>world.onFrame</code> (chapitre 6). Ce sont quatre boîtes dans un groupe : tourner le groupe les tourne toutes.',
      'Ouvrez le code complet, changez un nombre, lancez : la scène est à vous. Chargez ensuite votre propre modèle (chapitre 7).',
    ],
    tryIt: 'Changez l’heure, le vent et la couleur du toit.',
  },
};

/** French overlay for the nine course chapters. */
export const courseFr: LocaleOverlay = Object.fromEntries(
  courseEntries(TEXT, WORDS, 'fr').map(({ id, title, description, html }) => [
    id,
    { title, description, html },
  ]),
);
