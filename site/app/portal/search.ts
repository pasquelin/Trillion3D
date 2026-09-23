import type { BadgeTone } from '../ui/Badge.tsx';

/** One thing the site search can find: what it is called, the text it is found by, where it is. */
export interface SearchItem {
  key: string;
  title: string;
  text: string;
  /** What the item is, as its badge says it, and the badge's colour. */
  kind: string;
  tone: BadgeTone;
  href: string;
}

const normalized = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The items that contain every word of `query`, accents and case ignored, titles that start
 * with a word first, then titles that contain one, then the rest in their own order. */
export function search<T extends Pick<SearchItem, 'title' | 'text'>>(items: T[], query: string) {
  const words = normalized(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items
    .map((item, order) => {
      const title = normalized(item.title);
      const document = `${title} ${normalized(item.text)}`;
      if (!words.every((word) => document.includes(word))) return null;
      const score = words.reduce(
        (total, word) => total + (title.startsWith(word) ? 3 : title.includes(word) ? 2 : 1),
        0,
      );
      return { item, order, score };
    })
    .filter((match) => match !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item }) => item);
}
