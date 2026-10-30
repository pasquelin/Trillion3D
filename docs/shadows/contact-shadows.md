# Contact shadows

Beside the receiver's screen ray, the lit passes cast a **contact shadow** per light, in the light's term
(`lighting/contactShadow/contactShadowWgsl.ts`): eight steps through the scene's depth from the pixel
toward the light. Its length is the light's `contactShadowLength` (a share of the screen's height, or
metres with `contactShadowLengthInWorldSpace`; 0 casts none), and only a light that casts a shadow
casts it, while the shadow quality is above 0. It multiplies the light's surface and transmission terms
by `1 − intensity`: the light's casting intensity where the ray meets a surface that casts contact
shadows, its non-casting intensity where it meets an eye or a pixel of an object that sets
`castContactShadow = false` (the per-object bit, on by default).

- The eye model casts half a centimetre toward any light; the hair model a fifth of the half height of
  the screen under a light with no shadow, whatever the switch says.
- The view's `contactShadows` takes the lights' rays away; the four `contactShadowOverride…` settings
  replace the lights' own ([SDK.md](../sdk/lights/contact-shadows.md#contact-shadows)).
- A see-through surface whose material sets `contactShadows` and is lit with
  `translucencyLighting: 'forward'` (or is transmissive) is shaded by a ray of a fifth of the half height
  of the screen, toward every light, through the opaque depth (level 0 of the depth pyramid), whatever
  the light and the view's switch say.

```js
const lamp = light.spot({ position: [0, 3, 0], castShadow: true, contactShadowLength: 0.03 })
const world = createWorld('viewer', { contactShadowOverrideCastingIntensity: 0.5 })
statue.castContactShadow = false // its pixels stop no ray
const pane = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'forward',
  contactShadows: true,
})
```
