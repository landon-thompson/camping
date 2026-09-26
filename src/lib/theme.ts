import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

function read(): ThemePref {
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const set = (p: ThemePref) => {
    try {
      if (p === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', p);
    } catch {
      /* ignore */
    }
    setPref(p);
  };
  return [pref, set];
}
