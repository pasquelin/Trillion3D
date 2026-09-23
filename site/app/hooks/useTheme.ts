import { useEffect, useState } from 'react';

const KEY = 'trillion3d-docs-theme';

function readTheme(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === 'dark' ? 'dim' : saved;
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dim' : 'light';
}

/** The DaisyUI theme, light or dim, kept across visits; returns the switch between the two. */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* The active theme still applies. */
    }
  }, [theme]);
  return () => setTheme((value) => (value === 'dim' ? 'light' : 'dim'));
}
