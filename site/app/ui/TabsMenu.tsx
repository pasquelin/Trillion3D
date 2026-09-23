import { Dropdown } from './Dropdown.tsx';

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
  return (
    <div
      className="tabs tabs-box bg-base-200 flex flex-wrap w-fit max-w-full"
      role="tablist"
      aria-label={ariaLabel}
    >
      <Tab
        option={{ value: 'all', label: allLabel }}
        active={value === 'all'}
        onSelect={onChange}
      />
      {options
        .filter(({ value: id }) => primary.includes(id))
        .map((option) => (
          <Tab
            key={option.value}
            option={option}
            active={value === option.value}
            onSelect={onChange}
            className="hidden sm:inline-flex"
          />
        ))}
      <Dropdown
        end
        label={
          <>
            {moreLabel}
            <span className="ml-1 text-xs opacity-60" aria-hidden="true">
              ⌄
            </span>
          </>
        }
        aria-label={
          value === 'all'
            ? moreLabel
            : `${moreLabel}: ${options.find(({ value: id }) => id === value)?.label}`
        }
        triggerClassName="tab inline-flex h-10 items-center px-4"
        menuClassName="w-64"
        items={options.map((option) => ({
          key: option.value,
          label: option.label,
          pressed: value === option.value,
          className: primary.includes(option.value) ? 'sm:hidden' : '',
          onSelect: () => onChange(option.value),
        }))}
      />
    </div>
  );
}
