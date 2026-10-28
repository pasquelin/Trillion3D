import { ledgerAdmitted, type HeldAllocation } from './deviceLedger.ts'

/**
 * The view a shape asks for, as every view of a shape makes it: `held` while it was made for the same shape (`same`), else
 * made, `held` given back — where the device's budget leaves room for the `bytes` it asks (`ledgerAdmitted`, the bytes
 * the held view gives back credited); none where it does not, with the reason, which names `what`. `bytes` and `make` run
 * only when the shape changed; `make` is given the bytes asked.
 */
export function shapeView<V extends HeldAllocation>(
  held: V | undefined,
  device: GPUDevice,
  {
    same,
    what,
    bytes,
    make,
  }: { same: boolean; what: string; bytes: () => number; make: (asked: number) => V },
): { view?: V; why?: string } {
  if (held && same) return { view: held }
  const asked = bytes()
  const { value, why } = ledgerAdmitted(device, { held, asked, what, make: () => make(asked) })
  return { view: value, why }
}
