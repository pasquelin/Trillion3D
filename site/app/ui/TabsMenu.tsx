import { useRef } from 'react';
interface TabsMenuOption {
  value: string;
  label: string;
}

interface TabItemProps {
  option: TabsMenuOption;
  active: boolean;
  onSelect: (value: string) => void;
  className?: string;
}

function Tab({ option, active, onSelect, className = '' }: TabItemProps) {
  return (
    <button
      type="button"
      role="tab"
      className={`tab whitespace-nowrap ${active ? 'tab-active' : ''} ${className}`}
      aria-selected={active}
      aria-pressed={active}
      onClick={() => onSelect(option.value)}
    >
      {option.label}
    </button>
  );
}

interface TabsMenuProps {
  value: string;
  options: TabsMenuOption[];
  primary?: string[];
  allLabel: string;
  moreLabel: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

export function TabsMenu({
  value,
  options,
  primary = [],
  allLabel,
  moreLabel,
  ariaLabel,
  onChange,
}: TabsMenuProps) {
  const menu = useRef<HTMLDetailsElement | null>(null),
    choose = (next: string) => {
      onChange(next);
      if (menu.current) menu.current.open = false;
    };
  return (
    <div
      className="tabs tabs-box bg-base-200 flex flex-wrap w-fit max-w-full"
      role="tablist"
      aria-label={ariaLabel}
    >
      <Tab option={{ value: 'all', label: allLabel }} active={value === 'all'} onSelect={choose} />
      {options
        .filter(({ value: id }) => primary.includes(id))
        .map((option) => (
          <Tab
            key={option.value}
            option={option}
            active={value === option.value}
            onSelect={choose}
            className="hidden sm:inline-flex"
          />
        ))}
      <details ref={menu} className="dropdown dropdown-end">
        <summary
          className="tab inline-flex h-10 items-center px-4 list-none [&::-webkit-details-marker]:hidden"
          style={{ listStyle: 'none' }}
          aria-label={
            value === 'all'
              ? moreLabel
              : `${moreLabel}: ${options.find(({ value: id }) => id === value)?.label}`
          }
        >
          {moreLabel}
          <span className="ml-1 text-xs opacity-60" aria-hidden="true">
            ⌄
          </span>
        </summary>
        <ul className="menu dropdown-content z-20 mt-2 w-64 max-w-[80vw] rounded-box bg-base-200 border border-base-300 shadow-lg">
          {options.map((option) => (
            <li key={option.value} className={primary.includes(option.value) ? 'sm:hidden' : ''}>
              <button
                type="button"
                aria-pressed={value === option.value}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
