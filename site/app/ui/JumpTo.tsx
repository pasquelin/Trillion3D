import { Select } from './Input.tsx'

interface JumpToItem {
  /** The id of the heading this option jumps to. */
  id: string
  label: string
  count: number
}

interface JumpToProps {
  'aria-label': string
  placeholder: string
  items: JumpToItem[]
}

/**
 * A select that jumps the page to one of its own sections: choosing an item brings its heading
 * to the top of the page's own scrolling container (never the window, which this shell never
 * scrolls), at once — a smooth scroll of the content area did not move it. The jump waits one
 * task, then gives the heading the focus: when its list closes, the browser gives the select its
 * focus back and scrolls the content area to show it, which undid the jump. It always shows its
 * placeholder: a jump menu, not a record of the section last read.
 */
export function JumpTo({ 'aria-label': ariaLabel, placeholder, items }: JumpToProps) {
  return (
    <div className="w-full sm:w-64">
      <Select
        aria-label={ariaLabel}
        defaultValue=""
        onChange={(event) => {
          const heading = document.getElementById(event.target.value)
          setTimeout(() => {
            if (!heading) return
            // The heading takes the focus (without scrolling): the select keeps none that the
            // browser would scroll back into view.
            heading.tabIndex = -1
            heading.focus({ preventScroll: true })
            heading.scrollIntoView({ behavior: 'instant', block: 'start' })
          })
          // Uncontrolled: reset by hand so the field always shows its placeholder, a jump menu
          // rather than a record of the section last read.
          event.target.value = ''
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
  )
}
