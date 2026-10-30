/**
 * THE KEY OF A VIEW'S OWN STATE. The runtime's GPU group is one object whose members are traded
 * with the view drawn (`./viewSwitch.ts`), so a state kept in a `WeakMap` keyed on the group would be
 * shared by every view. This object is a member of the group, traded with the rest: a state keyed
 * on it follows the view that made it, and is found again through the view's record
 * (`WebgpuView.gpu`) when the view leaves.
 */
export const viewKey = (gpu: { viewKey?: object }): object => (gpu.viewKey ??= {})
