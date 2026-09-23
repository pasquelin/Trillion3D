import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useWords } from '../i18n.ts';
import { search } from '../portal/search.ts';
import { searchIndex } from '../portal/searchIndex.ts';
import { Badge } from '../ui/Badge.tsx';
import { SearchInput } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Note } from '../ui/Text.tsx';
import { usePortal } from './PortalContext.ts';

const LIMIT = 50;

/** The search box and its results; mounted at each opening, so it opens empty. */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const { route, entries } = usePortal();
  const { locale } = route;
  const t = useWords(locale);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useId();
  const index = useMemo(() => searchIndex(entries, locale), [entries, locale]);
  const results = useMemo(() => search(index, query).slice(0, LIMIT), [index, query]);
  const keydown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setActive((value) => Math.min(Math.max(value + step, 0), results.length - 1));
    } else if (event.key === 'Escape') {
      // A search field eats the first Escape to clear itself; here it closes the search.
      onClose();
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      location.hash = results[active].href;
      onClose();
    }
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <SearchInput
        size="lg"
        data-autofocus
        value={query}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        role="combobox"
        aria-expanded
        aria-controls={list}
        aria-activedescendant={results[active] ? `${list}-${active}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={keydown}
        hint="↵"
      />
      <ul id={list} role="listbox" className="menu w-full flex-nowrap overflow-y-auto p-0">
        {results.map((item, position) => (
          <li
            key={item.key}
            id={`${list}-${position}`}
            role="option"
            aria-selected={position === active}
          >
            <a
              className={position === active ? 'menu-active' : ''}
              href={item.href}
              onClick={onClose}
              onMouseEnter={() => setActive(position)}
            >
              <span className="min-w-0 flex-1 break-words">{item.title}</span>
              <Badge size="sm" soft tone={item.tone} className="w-24 shrink-0">
                {item.kind}
              </Badge>
            </a>
          </li>
        ))}
      </ul>
      {results.length === 0 && <Note role="status">{t('sidebar.noResults')}</Note>}
    </div>
  );
}

/** The site search: every guide, API entry, example and lesson in the page's language, found as
 * the reader types, walked with the arrow keys and opened with Enter. */
export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { route } = usePortal();
  const t = useWords(route.locale);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title={t('search.label')}
      closeLabel={t('actions.close')}
    >
      <SearchPanel onClose={onClose} />
    </Modal>
  );
}
