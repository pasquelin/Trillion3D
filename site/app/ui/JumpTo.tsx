import { Select } from './Input.tsx';

interface JumpToItem {
  /** The id of the heading this option jumps to. */
  id: string;
  label: string;
  count: number;
}

interface JumpToProps {
  'aria-label': string;
  placeholder: string;
  items: JumpToItem[];
}

/** Whether the reader asked the system for no motion. */
const reducesMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A select that jumps the page to one of its own sections: choosing an item scrolls its heading
 * to the top of the page's own scrolling container (never the window, which this shell never
 * scrolls) — smoothly, unless the reader has asked for no motion. It always shows its
 * placeholder: a jump menu, not a record of the section last read.
 */
export function JumpTo({ 'aria-label': ariaLabel, placeholder, items }: JumpToProps) {
  return (
    <div className="w-full sm:w-64">
      <Select
        aria-label={ariaLabel}
        defaultValue=""
        onChange={(event) => {
          const id = event.target.value;
          document.getElementById(id)?.scrollIntoView({
            behavior: reducesMotion() ? 'instant' : 'smooth',
            block: 'start',
          });
          // Uncontrolled: reset by hand so the field always shows its placeholder, a jump menu
          // rather than a record of the section last read.
          event.target.value = '';
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label} ({item.count})
          </option>
        ))}
      </Select>
    </div>
  );
}
