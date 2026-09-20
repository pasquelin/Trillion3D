import { useCallback, useEffect, useRef, useState } from 'react';

export function usePlaygroundMotion(scenario, setValues, { autoPlay = false } = {}) {
  const [playing, setPlaying] = useState(false),
    frame = useRef(0),
    preset = useRef(0),
    motion = useRef(null);
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPlaying(false);
  }, []);
  useEffect(() => {
    motion.current = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pause = () => (document.hidden || motion.current.matches) && stop();
    document.addEventListener('visibilitychange', pause);
    motion.current.addEventListener('change', pause);
    preset.current = 0;
    stop();
    return () => {
      document.removeEventListener('visibilitychange', pause);
      motion.current?.removeEventListener('change', pause);
      stop();
    };
  }, [scenario, stop]);
  const start = useCallback(() => {
    if (motion.current?.matches || document.hidden) return;
    const [name, min, max] = scenario.controls[0];
    const animate = (time) => {
      setValues((values) => ({
        ...values,
        [name]: min + (max - min) * (0.5 + 0.5 * Math.sin(time / 900)),
      }));
      frame.current = requestAnimationFrame(animate);
    };
    setPlaying(true);
    frame.current = requestAnimationFrame(animate);
  }, [scenario, setValues]);
  useEffect(() => {
    if (autoPlay) start();
    return stop;
  }, [autoPlay, start, stop]);
  const toggle = () => (playing ? stop() : start());
  const applyPreset = () => {
    stop();
    preset.current = (preset.current + 1) % scenario.presets.length;
    setValues(
      Object.fromEntries(
        scenario.controls.map(([name], index) => [name, scenario.presets[preset.current][index]]),
      ),
    );
  };
  return { applyPreset, playing, stop, toggle };
}
