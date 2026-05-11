'use client';

import { useEffect } from 'react';

export function PhosphorIcons() {
  useEffect(() => {
    // Load Phosphor Icons script
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@phosphor-icons/web';
    script.async = true;
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, []);

  return null;
}
