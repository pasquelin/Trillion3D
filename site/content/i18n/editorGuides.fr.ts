import type { LocaleOverlay } from './entryOverlay.ts';

/** French overlay for the scene editor's guides. */
export const editorGuidesFr: LocaleOverlay = {
  'scene-editor': {
    title: 'Construire une scène avec l’éditeur',
    description:
      'Ajouter des formes et des lumières, les choisir à la souris, les déplacer avec des poignées, les recolorer, enregistrer la scène et la rouvrir — dans le portail, avec la seule API publique.',
    html: `<p>L’<a href="#/fr/examples/scene-editor">éditeur de scène</a> est une page de ce portail bâtie sur trois portes du moteur et rien d’autre. Partez d’une scène vide : <b>Ajouter → Boîte</b>, puis <b>Ajouter → Lumière directionnelle</b>. Cliquez sur la boîte : <code>world.raycast</code> la trouve sous le pointeur, et les poignées de <code>controls.transform</code> apparaissent dessus. Glissez une flèche pour la déplacer — la caméra reste immobile tant qu’une poignée est tenue — appuyez sur <kbd>E</kbd> pour la tourner, <kbd>R</kbd> pour la mettre à l’échelle. Changez sa couleur dans l’inspecteur : le moteur repeint le matériau sur place, et le coût de l’image reste affiché dans le coin des statistiques. <b>Enregistrer</b> télécharge <code>scene.toJSON</code> ; <b>Nouveau</b>, puis <b>Ouvrir</b>, reconstruit la même scène avec <code>scene.fromJSON</code>.</p>
<p>Chaque étape s’annule avec <kbd>Ctrl</kbd>+<kbd>Z</kbd>, et la scène est gardée dans le navigateur d’une visite à l’autre. La page ne dessine ni ne déplace rien elle-même : ce que vous voyez, c’est le moteur.</p>`,
  },
  'pick-with-the-pointer': {
    title: 'Choisir un objet au pointeur',
    description:
      '`world.raycast` renvoie l’objet le plus proche sous un point du canvas : le nœud que la page a ajouté, le point et la normale touchés, la distance.',
    html: `<p>Le test tourne sur le CPU, sur la géométrie même de la scène : les maillages triangle par triangle, un modèle chargé sur sa boîte, les lignes et les points jamais. Les sous-arbres cachés et les repères <code>helper</code> sont ignorés. Voyez-le dans <a href="#/fr/examples/click-to-pick">Cliquer pour choisir</a>.</p>`,
  },
  'move-with-handles': {
    title: 'Déplacer, tourner et mettre à l’échelle avec des poignées',
    description:
      '`controls.transform(world)` pose des poignées sur un objet ; un glissement écrit sa pose à travers ses parents, et la caméra reste immobile pendant ce temps.',
    html: `<p>Modes <code>translate</code>, <code>rotate</code> et <code>scale</code>, axes du monde ou de l’objet, pas facultatifs. Les événements <code>dragStart</code> et <code>dragEnd</code> encadrent un glissement — une étape d’annulation. Voyez-le dans <a href="#/fr/examples/move-rotate-scale-gizmo">Déplacer, tourner, échelle</a>.</p>`,
  },
  'save-and-open-a-scene': {
    title: 'Enregistrer et ouvrir une scène',
    description:
      '`scene.toJSON(camera)` écrit la scène en JSON simple et versionné ; `scene.fromJSON(json, camera)` la reconstruit.',
    html: `<p>Les formes sont stockées par l’appel qui les a construites, les matériaux par leurs valeurs, les modèles chargés par leur adresse — jamais recopiés — et les repères <code>helper</code> pas du tout. Une autre version du format est refusée nommément. Voyez-le dans <a href="#/fr/examples/save-the-scene">Enregistrer la scène</a>.</p>`,
  },
};
