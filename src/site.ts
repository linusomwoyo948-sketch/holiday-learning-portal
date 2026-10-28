import { useEffect, useState } from 'react';
import { api } from './lib';

export const DEFAULT_SITE_NAME = 'Holiday Learning Portal';
const CACHE_KEY = 'holiday-portal-site-name';

function readCache(): string {
  try {
    return window.localStorage.getItem(CACHE_KEY) || '';
  } catch {
    return '';
  }
}

let current = readCache();
let requested = false;
const listeners = new Set<(name: string) => void>();

function display(): string {
  return current || DEFAULT_SITE_NAME;
}

function emit(): void {
  if (typeof document !== 'undefined') document.title = display();
  listeners.forEach((l) => l(display()));
}

export function setSiteName(name: string): void {
  current = name;
  try {
    window.localStorage.setItem(CACHE_KEY, name);
  } catch {
    // storage unavailable
  }
  emit();
}

async function fetchSiteName(): Promise<void> {
  try {
    const r = await api.get('/api/site');
    setSiteName(String(r.data?.siteName || ''));
  } catch {
    emit();
  }
}

export function useSiteName(): string {
  const [name, setName] = useState(display());
  useEffect(() => {
    const listener = (n: string) => setName(n);
    listeners.add(listener);
    if (typeof document !== 'undefined') document.title = display();
    if (!requested) {
      requested = true;
      fetchSiteName();
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return name;
}

