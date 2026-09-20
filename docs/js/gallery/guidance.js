const guidance = {
  'compose-transform': [
    'Rotate past 90°, then double the scale.',
    'Every corner follows one matrix; translation does not rotate.',
    'Dépassez 90°, puis doublez l’échelle.',
    'Chaque sommet suit une matrice ; la translation ne tourne pas.',
  ],
  'matrix-chain': [
    'Keep the offset fixed and rotate only the parent.',
    'The child traces a circle because its local offset is transformed.',
    'Gardez le décalage et tournez seulement le parent.',
    'L’enfant trace un cercle car son décalage local est transformé.',
  ],
  perspective: [
    'Keep FOV fixed and push the point away.',
    'Projected size shrinks with depth and with a wider FOV.',
    'Gardez le champ fixe et éloignez le point.',
    'La taille projetée diminue avec la profondeur et un champ plus large.',
  ],
  frustum: [
    'Narrow the FOV, then slide the box sideways.',
    'The result moves from inside through crossing to outside.',
    'Resserrez le champ, puis déplacez la boîte.',
    'Le résultat passe de dedans à intersecté, puis dehors.',
  ],
  'dot-product': [
    'Set the arrows 0°, 90° and 180° apart.',
    'The value moves from +1 through 0 to −1.',
    'Placez les flèches à 0°, 90° puis 180°.',
    'La valeur passe de +1 à 0 puis −1.',
  ],
  'cross-product': [
    'Swap which arrow comes first.',
    'The sign flips, encoding turn orientation.',
    'Inversez l’ordre des deux flèches.',
    'Le signe s’inverse et code le sens de rotation.',
  ],
  normalize: [
    'Change length without changing direction; also try zero.',
    'The unit arrow stays fixed while source length changes.',
    'Changez la longueur sans changer la direction ; essayez zéro.',
    'La flèche unité reste fixe tandis que la source change.',
  ],
  'box-grow': [
    'Add points one at a time.',
    'Only a point beyond an edge expands that edge.',
    'Ajoutez les points un par un.',
    'Seul un point au-delà d’un bord agrandit ce bord.',
  ],
  'sphere-from-box': [
    'Make the box tall and narrow.',
    'The sphere stays conservative and gains empty space.',
    'Rendez la boîte haute et étroite.',
    'La sphère reste conservatrice et gagne de l’espace vide.',
  ],
  hierarchy: [
    'Rotate the parent with a fixed child offset.',
    'Local coordinates stay fixed; world coordinates orbit.',
    'Tournez le parent avec un décalage enfant fixe.',
    'Les coordonnées locales restent fixes ; celles du monde orbitent.',
  ],
  'color-space': [
    'Compare black + white with two nearby greys.',
    'A light-space midpoint is brighter because sRGB is nonlinear.',
    'Comparez noir + blanc à deux gris proches.',
    'La moyenne en lumière est plus claire car sRGB est non linéaire.',
  ],
  'lod-budget': [
    'Push frame time above the budget.',
    'Allowed screen error grows, requesting less geometry.',
    'Dépassez le budget avec le temps de trame.',
    'L’erreur écran admise augmente et demande moins de géométrie.',
  ],
};

export function guidanceFor(id, locale) {
  const item = guidance[id],
    french = String(locale).toLowerCase().startsWith('fr');
  return { try: item[french ? 2 : 0], changes: item[french ? 3 : 1] };
}
