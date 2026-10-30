import { foldWindow, type KeepingWindow } from './idleKeep.ts'
import { retire } from './frameRetire.ts'

/** What a call asks of a view's layered textures: the layers, and whether the extra textures beside them (`also`, a set's optional part) are wanted. */
interface LayerAsk {
  count: number
  also: boolean
}
const NO_ASK: LayerAsk = { count: 0, also: false }
const mostAsked = (a: LayerAsk, b: LayerAsk): LayerAsk => ({
  count: Math.max(a.count, b.count),
  also: a.also || b.also,
})

/** What a view's layered textures remember beside the textures: their device and size, the layers they have room for, and the most asked since the window of keeping began. */
export interface LayerRoom {
  device: GPUDevice
  size: string
  capacity: number
  asked: KeepingWindow<LayerAsk>
  /** Whether the window before the current one asked for the extra part: it stays while the current window asks it or that one did, so a window's start does not remake the set. */
  alsoBefore: boolean
  /** The last image whose ask the window folded (`layers`, or `keep` for an image that asked nothing). */
  foldedAt: number
}

/**
 * THE LAYERED TEXTURES OF A VIEW, one set a view, made for the most layers asked in the window of `IDLE_KEEP_IMAGES` images that ends at `frame`
 * (so that runs of different counts do not remake them by turns): grown at once when more are asked, kept while the window asks fewer, made again at the most
 * asked when a window ends below what they hold. The extra part (`also`) is kept the same way: once asked it stays while the window asks it, and goes when a window ends without it.
 * A view that asks nothing in an image is folded by `keep` (called once an image of the view), so the window ends whether or not `layers` is called. `make` builds the textures for a room and whether the extra part is wanted; `lacks` says a kept set does not match the extra part wanted. `destroy` frees a set.
 */
export function perViewLayers<H extends LayerRoom>(destroy: (held: H) => void) {
  const held = new WeakMap<object, H>()
  /** The view's set let go (retired with the frame; at once when its device was `replaced`). */
  function release(key: object, replaced = false) {
    const old = held.get(key)
    if (!old) return
    held.delete(key)
    retire(old.device, { destroy: () => destroy(old) }, replaced)
  }
  /** Image `frame` is over and the view asked for no layers in it (nothing is done where `layers` folded it): the window folds the empty ask, so that a run of images without an ask ends the window too; a set bigger than the window asked is let go. */
  function keep(key: object, frame: number) {
    const have = held.get(key)
    if (!have || have.foldedAt === frame) return
    have.foldedAt = frame
    const ended = foldWindow<LayerAsk>(have.asked, frame, undefined, mostAsked, NO_ASK)
    if (ended) have.alsoBefore = ended.also
    if (ended && ended.count < have.capacity) release(key)
  }
  function layers(
    key: object,
    device: GPUDevice,
    size: string,
    count: number,
    frame: number,
    make: (room: number, also: boolean) => Omit<H, keyof LayerRoom>,
    lacks?: (have: H, also: boolean) => boolean,
    also = false,
  ): H {
    const have = held.get(key)
    const same = have?.size === size && have.device === device
    const ask = { count, also }
    let room = count
    let wanted = also
    let asked: KeepingWindow<LayerAsk> = { most: ask, since: frame }
    let alsoBefore = false
    if (same) {
      // The window is over: the room is what it asked at most, and the next window starts from this image's ask.
      const ended = foldWindow(have.asked, frame, ask, mostAsked, ask)
      room = ended ? ended.count : Math.max(count, have.capacity)
      wanted = ended ? ended.also : have.asked.most.also || have.alsoBefore
      alsoBefore = ended ? ended.also : have.alsoBefore
      have.alsoBefore = alsoBefore
      asked = have.asked
      have.foldedAt = frame
      if (have.capacity === room && !lacks?.(have, wanted)) return have
    }
    release(key, !!have && have.device !== device)
    const made = {
      device,
      size,
      capacity: room,
      asked,
      alsoBefore,
      foldedAt: frame,
      ...make(room, wanted),
    } as H
    held.set(key, made)
    return made
  }
  return { layers, release, keep }
}
