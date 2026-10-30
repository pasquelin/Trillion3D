import { OBJECT_SHADOW_BORDER } from './translucentShadowRules.ts'

/**
 * THE ATLASES OF THE TRANSLUCENT SHADOWS: the rectangles of a frame's translucent object shadows, the largest first, packed into
 * square atlases of the translucent side, a new atlas where one is full. Each atlas holds `TRANSLUCENT_SHADOW_TARGETS` targets of
 * four float16 channels (the Fourier coefficients of the opacity, which range wide and go negative), added into by the shadows
 * that share it.
 */

/** A shadow to place: its rectangle without the border. */
interface TranslucentShadowRect {
  readonly resolutionX: number
  readonly resolutionY: number
}

/** Where a shadow was placed: the atlas, and the corner of its rectangle with the border. */
export interface TranslucentShadowSlot {
  readonly atlas: number
  readonly x: number
  readonly y: number
}

interface Node {
  childA: number
  childB: number
  x: number
  y: number
  w: number
  h: number
  used: boolean
}

/** A tree of free rectangles that cuts a leaf along the axis it has the most room on, placing elements one by one. */
class Layout {
  private readonly nodes: Node[]
  private sizeX = 1
  private sizeY = 1

  constructor(maxX: number, maxY: number) {
    this.nodes = [{ childA: -1, childB: -1, x: 0, y: 0, w: maxX, h: maxY, used: false }]
  }

  /** The corner of a free rectangle of `w` x `h` now taken, or `null` where none is free. */
  add(w: number, h: number): [number, number] | null {
    if (w === 0 || h === 0) return [0, 0]
    // First the places that leave the atlas's used size as it is, then the ones that grow it.
    const at = this.place(0, w, h, false) ?? this.place(0, w, h, true)
    if (at === null) return null
    const node = this.nodes[at]!
    node.used = true
    this.sizeX = Math.max(this.sizeX, node.x + w)
    this.sizeY = Math.max(this.sizeY, node.y + h)
    return [node.x, node.y]
  }

  private place(index: number, w: number, h: number, grow: boolean): number | null {
    const node = this.nodes[index]!
    if (node.childA !== -1) {
      return this.place(node.childA, w, h, grow) ?? this.place(node.childB, w, h, grow)
    }
    if (node.used || node.w < w || node.h < h) return null
    if (!grow && (node.x + w > this.sizeX || node.y + h > this.sizeY)) return null
    if (node.w === w && node.h === h) return index
    const excessW = node.w - w
    const excessH = node.h - h
    node.childA = this.nodes.length
    if (excessW > excessH) {
      this.nodes.push({ childA: -1, childB: -1, x: node.x, y: node.y, w, h: node.h, used: false })
      node.childB = this.nodes.length
      this.nodes.push({
        childA: -1,
        childB: -1,
        x: node.x + w,
        y: node.y,
        w: node.w - w,
        h: node.h,
        used: false,
      })
    } else {
      this.nodes.push({ childA: -1, childB: -1, x: node.x, y: node.y, w: node.w, h, used: false })
      node.childB = this.nodes.length
      this.nodes.push({
        childA: -1,
        childB: -1,
        x: node.x,
        y: node.y + h,
        w: node.w,
        h: node.h - h,
        used: false,
      })
    }
    return this.place(node.childA, w, h, grow)
  }
}

/** The order the shadows are placed in: the larger area first. Sorts `shadows` in place and returns it. */
export const sortByArea = <T extends TranslucentShadowRect>(shadows: T[]) =>
  shadows.sort((a, b) => b.resolutionX * b.resolutionY - a.resolutionX * a.resolutionY)

/**
 * The slot of each shadow, in the order given (largest first, `sortByArea`), and the count of atlases used. A shadow that does not fit
 * the atlas in hand opens a new one; one that does not fit an empty atlas gets no slot (`null`).
 */
export function packTranslucentShadows(shadows: readonly TranslucentShadowRect[], side: number) {
  const slots: (TranslucentShadowSlot | null)[] = []
  let atlases = 0
  let layout: Layout | null = null
  for (const s of shadows) {
    const w = s.resolutionX + OBJECT_SHADOW_BORDER * 2
    const h = s.resolutionY + OBJECT_SHADOW_BORDER * 2
    let at = layout?.add(w, h) ?? null
    if (!at) {
      layout = new Layout(side, side)
      atlases++
      at = layout.add(w, h)
    }
    slots.push(at ? { atlas: atlases - 1, x: at[0], y: at[1] } : null)
  }
  return { slots, atlases }
}

/**
 * The mapping of a shadow's rectangle in its atlas of `side` texels, as the lights' reads take it: at `tileAt` the half size of the rectangle and
 * its centre (the clip space's x and y into texture coordinates), at `interiorAt` the corners of the interior the reads stay inside, from the
 * border's inside to one border past the rectangle's far side (the reference's shadow map min and max, with `X + 2 * border + resolution` for the far corner).
 */
export function writeShadowTile(
  out: { [index: number]: number },
  tileAt: number,
  interiorAt: number,
  p: { readonly resolutionX: number; readonly resolutionY: number; readonly border: number },
  slot: { readonly x: number; readonly y: number },
  side: number,
) {
  const fx = (0.5 * p.resolutionX) / side
  const fy = (0.5 * p.resolutionY) / side
  const left = (slot.x + p.border) / side
  const top = (slot.y + p.border) / side
  out[tileAt] = fx
  out[tileAt + 1] = fy
  out[tileAt + 2] = left + fx
  out[tileAt + 3] = top + fy
  out[interiorAt] = left
  out[interiorAt + 1] = top
  out[interiorAt + 2] = (slot.x + 2 * p.border + p.resolutionX) / side
  out[interiorAt + 3] = (slot.y + 2 * p.border + p.resolutionY) / side
}
