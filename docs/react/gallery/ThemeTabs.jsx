import { useRef } from 'react';
import { themeLabel } from './roadmapThemes.js';

const primary = ['transforms', 'camera', 'geometry', 'animation'];

function Tab({ id, active, locale, onSelect, className = '' }) {
  return (
    <button
      type="button"
      role="tab"
      className={`tab whitespace-nowrap ${active ? 'tab-active' : ''} ${className}`}
      aria-selected={active}
      aria-pressed={active}
      onClick={() => onSelect(id)}
    >
      {id === 'all' ? (locale === 'fr' ? 'Tous' : 'All') : themeLabel(id, locale)}
    </button>
  );
}

function MoreMenu({ ids, active, locale, onSelect, className }) {
  const menu = useRef(null),
    selected = ids.includes(active),
    label = locale === 'fr' ? 'Plus' : 'More';
  const choose = (id) => {
    onSelect(id);
    menu.current.open = false;
  };
  return (
    <details ref={menu} className={`dropdown ${className}`}>
      <summary
        className={`tab h-10 list-none [&::-webkit-details-marker]:hidden ${selected ? 'tab-active' : ''}`}
        style={{ listStyle: 'none' }}
        aria-label={selected ? `${label}: ${themeLabel(active, locale)}` : label}
      >
        {label}
        <span className="ml-1 text-xs opacity-60" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <ul className="menu dropdown-content left-0 z-20 mt-2 w-64 rounded-box bg-base-200 border border-base-300 shadow-lg">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" aria-pressed={active === id} onClick={() => choose(id)}>
              {themeLabel(id, locale)}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ThemeTabs({ active, available, locale, onSelect }) {
  const overflow = available.filter((id) => !primary.includes(id));
  return (
    <div
      className="tabs tabs-box bg-base-200 flex flex-wrap w-fit max-w-full"
      role="tablist"
      aria-label={locale === 'fr' ? 'Catégories d’exemples' : 'Example categories'}
    >
      <Tab id="all" active={active === 'all'} locale={locale} onSelect={onSelect} />
      {primary.map((id) =>
        available.includes(id) ? (
          <Tab
            key={id}
            id={id}
            active={active === id}
            locale={locale}
            onSelect={onSelect}
            className="hidden lg:inline-flex"
          />
        ) : null,
      )}
      <MoreMenu
        ids={available}
        active={active}
        locale={locale}
        onSelect={onSelect}
        className="lg:hidden"
      />
      <MoreMenu
        ids={overflow}
        active={active}
        locale={locale}
        onSelect={onSelect}
        className="hidden lg:block"
      />
    </div>
  );
}
