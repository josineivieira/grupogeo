'use client';
import { useSyncExternalStore } from 'react';

const event = 'geo:navigation';
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(event, listener);
  };
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}
const router = {
  push(path: string) {
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin) throw new Error('Destino de navegação inválido.');
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event(event));
    window.scrollTo(0, 0);
  },
};
export function useRouter() { return router; }
