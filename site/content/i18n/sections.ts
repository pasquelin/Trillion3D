import type { Locale } from '../locale.ts';
import { FAMILIES, SECTIONS } from '../model.ts';

/** A family section is titled by the family's own name, the word a page writes, in every language. */
const families = Object.fromEntries(FAMILIES.map((id) => [`section.${id}`, id]));

const titled = (titles: Record<string, string>) => ({
  ...families,
  ...Object.fromEntries(Object.entries(titles).map(([id, title]) => [`section.${id}`, title])),
});

export const sectionStrings: Record<Locale, Record<string, string>> = {
  en: titled(
    Object.fromEntries(
      SECTIONS.filter(({ id }) => !FAMILIES.includes(id)).map(({ id, title }) => [id, title]),
    ),
  ),
  fr: titled({
    guides: 'Guides',
    examples: 'Exemples SDK',
    demo: 'Démo interactive',
    world: 'Monde',
    constants: 'Constantes',
    'math-utilities': 'Outils mathématiques',
    node: 'Node et compilation',
    types: 'Types et erreurs',
  }),
};
