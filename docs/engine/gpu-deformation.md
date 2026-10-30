# GPU deformation

The page's side is [SDK.md](../sdk/gpu-deformation.md#gpu-deformation). One control record per deformed placement
(`deformation/session.ts`), and one per track of the animation banks, whose palettes the GPU poses
(`deformation/bankTracks.ts`); one compute pass before the cut writes deformed positions and
normals that every later pass reads (`deformation/compute.ts`). A skinned, morphed, wave-carried or
soft placement always deforms, whatever its size on screen; only an instanced skinned object rests
([Animation banks](animation-banks.md#animation-banks)).
