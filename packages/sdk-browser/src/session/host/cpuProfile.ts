/**
 * Bounds a host records itself — outside the frame they would have lengthened — and deposits on
 * the engine (`Engine.cpuStep`). They are named, never numbered: the engine slots them
 * where it wants in its own bound table.
 */
export type HostCpuStep = 'arrivalsMs' | 'pendingMs' | 'retainMs' | 'submitMs' | 'physicsMs'
