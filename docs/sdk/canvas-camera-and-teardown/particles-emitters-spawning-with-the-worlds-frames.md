# Particles: emitters spawning with the world's frames

`world.particles.add(spec)` makes an emitter over a fixed particle pool, GPU-stepped and drawn with
the translucent layers. Like an effect's emitter: spawns `rate` particles a second plus any `burst`
the page asks, each born with lifetime, speed and direction drawn from the given ranges, direction
inside a cone; the pool (`capacity`, `origin`, `blend`, `color`, `size`, `fade`, `softness`,
`acceleration`, `translucencyPass`) is fixed for its life, spawn changes any time.

```js
const fire = world.particles.add({
  capacity: 2000, // particles alive at most; a newer one replaces the oldest
  origin: [0, 0.2, 0], // the emitter's place in the world, metres
  rate: 120, // particles a second
  lifetime: [0.6, 1.2], // seconds, a number or [min, max]
  speed: [1, 2.5], // metres a second at birth
  direction: [0, 1, 0], // the cone's axis
  spread: 0.35, // the cone's half angle, radians (0 to π)
  acceleration: [0, 1.5, 0], // metres per second squared on every live particle
  blend: 'additive', // 'premultiplied' for smoke
  size: 0.15,
  color: [1, 0.55, 0.15, 1],
  seed: 3, // one seed and one clock give one effect
})
fire.update({ rate: 20, spread: 0.1 }) // from the next particle on
fire.burst(200) // now, whatever the rate says
fire.update({ active: false }) // stops the rate; a burst still spawns
fire.dispose() // its particles go with it
```

`capacity` below `rate * lifetime` makes the pool overwrite its oldest particles. A rate or spawn
the contract refuses throws `PARTICLE_RATE`, `PARTICLE_SPAWN`, `PARTICLE_DIRECTION` or
`PARTICLE_SPREAD`; a pool the device cannot hold throws `PARTICLE_CAPACITY`.
