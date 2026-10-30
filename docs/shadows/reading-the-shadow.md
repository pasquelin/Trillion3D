# Reading the shadow

One estimator shades every surface: the receiver's trace (`trace/receiverTraceWgsl.ts`) — the normal
bias, a screen ray for the contact, then rays across the light's disk or sphere marched through the
stored depths. Opaque surfaces read it from the mask, where the projection pass traced it 64 pixels
a workgroup, its 32-pixel halves voting their ray count. A blended surface reads its own fragment on
the same view and maps, as two project switches say (`shadowTranslucentQuality`,
`shadowTranslucentLocalLights`, read once when the session opens, `frame/prepare/setup.ts`): by
default one sample of the sun's map (`lighting/direct/shadowTraceWgsl.ts:vsmSampleFactor`, the local
lights lit whole), at quality 1 the trace itself on the same view, noise, maps and depth pyramid
(`vsmTraceFactor`), lone: no vote, so a fragment stops early only on its own narrow contact and
never traces fewer rays than a voting pixel. A material asks more of its own:
`translucentDirectionalLightShadowQuality` above 0 takes the trace for the sun on its surfaces
whatever the project switch says, `translucentLocalLightShadow` shadows the local lights on them,
and `translucentLocalLightShadowQuality` above 0 takes the trace for those lights; the marks ride
the item's flags (`materials/surface/surfaceModelWord.ts:TRANSLUCENT_SHADOW_MARK`,
`lighting/direct/shadowWgsl.ts:translucentMarksFrom`), and the programs of a scene whose surfaces
ask nothing hold none of that code. A rectangle light lights a translucent surface as a point light
at its centre unless the project switch `translucentRectLights` is on
(`blend/shader.ts:translucentLitKey`), and the translucent programs then hold none of the rectangle
shading. The receiver's normal is the surface's shading normal — the G-buffer's for an opaque pixel,
the fragment's for a blended one —: nothing is stored per pixel for the shadow. Every pass reads the
pool through the same buffers, one a slice, bound whole (`vsm/resources.ts`): 128 MiB at 2048 pages,
256 MiB at 4096, 512 MiB at 8192. The device's binding is WebGPU's limit on that size (§ 3.6.2,
`maxStorageBufferBindingSize`, `maxBufferSize`), the session asks the adapter's
(`session/engine/common.ts`), and a device that holds less than the level asks draws the largest
pool that fits (`vsm/layoutBytes.ts:vsmPoolPagesBound`). A page not drawn hands its point to the
next coarser level mapped; where none holds it, it is lit.
