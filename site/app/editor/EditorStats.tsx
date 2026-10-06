import { useEffect, useRef } from 'react'
import { statsPanel } from '../../examples/kit/statsPanel.ts'
import type { Session } from './session.ts'

/**
 * The examples' profiler overlay (`statsPanel.ts`), over the editor's view: the frames the world
 * drew per second, where the frame's time went, the shadows and the engine's counters, read four
 * times a second. A still scene draws no frame, and the overlay then keeps its last reading.
 */
export function EditorStats({ session }: { session: Session }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const { stop } = statsPanel(session.world, host.current)
    return stop
  }, [session])
  return <div ref={host} className="pointer-events-none absolute inset-0 z-10" />
}
