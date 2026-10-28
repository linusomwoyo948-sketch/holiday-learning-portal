// Website side of the platform: teacher and principal sign-in (Supabase), calls to /api, and phone alerts.
// Without VITE_SUPABASE_URL (npm run local) it uses a test sign-in where you type any email.
//
// Sign-in is built to work on any phone or computer:
//  - an emailed 6-digit code is typed into the same page, so it does not matter where the email is opened;
//  - if someone taps the link in the email instead, it signs in whichever browser opens it (implicit flow),
//    rather than failing because it was opened on a different device or app;
//  - Google sign-in returns to the same browser tab.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isLocalMode = !SUPABASE_URL || !SUPABASE_KEY;
export const googleSignInEnabled = !isLocalMode && import.meta.env.VITE_GOOGLE_SIGNIN !== 'off';

const sb: SupabaseClient | null = isLocalMode
  ? null
  : createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });

const LOCAL_KEY = 'holiday-portal-local-email';

function localEmail(): string {
  try {
    return localStorage.getItem(LOCAL_KEY) || '';
  } catch {
    return '';
  }
}

// Supabase keeps the session in local storage under sb-<project>-auth-token.
function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch {
    // storage unavailable
  }
  return false;
}

let session: Session | null = null;
let readyPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

if (sb) {
  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      setTimeout(() => listeners.forEach((fn) => fn()), 0);
    }
  });
}

async function token(): Promise<string | null> {
  if (isLocalMode) {
    const e = localEmail();
    return e ? 'local:' + encodeURIComponent(e) : null;
  }
  const { data } = await sb!.auth.getSession();
  session = data.session;
  return session?.access_token ?? null;
}

type ApiError = Error & { response?: { status: number; data: unknown } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(method: string, url: string, data?: unknown): Promise<{ data: any }> {
  const headers: Record<string, string> = {};
  const t = await token();
  if (t) headers.Authorization = 'Bearer ' + t;
  let body: string | undefined;
  if (data !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(data);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch {
    const err = new Error('No internet connection. Please check your connection and try again.') as ApiError;
    err.response = { status: 0, data: { error: err.message } };
    throw err;
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string })?.error || 'Request failed (' + res.status + ')';
    const err = new Error(msg) as ApiError;
    err.response = { status: res.status, data: typeof parsed === 'object' && parsed ? parsed : { error: msg } };
    throw err;
  }
  return { data: parsed };
}

export const api = {
  get: (url: string) => call('GET', url),
  post: (url: string, data?: unknown) => call('POST', url, data ?? {}),
  put: (url: string, data?: unknown) => call('PUT', url, data ?? {}),
  delete: (url: string, data?: unknown) => call('DELETE', url, data),
};

function homeUrl(): string {
  return window.location.origin + '/';
}

function friendlyAuthError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e || '');
  const lower = msg.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('security purposes')) {
    return new Error('Too many codes were requested. Please wait a minute and try again.');
  }
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('otp')) {
    return new Error('That code is wrong or has expired. Check the latest email, or ask for a new code.');
  }
  if (lower.includes('fetch') || lower.includes('network')) {
    return new Error('No internet connection. Please check your connection and try again.');
  }
  if (lower.includes('sending') || lower.includes('smtp') || lower.includes('email')) {
    return new Error('The sign-in email could not be sent. Please try again in a few minutes.');
  }
  return new Error(msg || 'Sign-in failed. Please try again.');
}

export const auth = {
  // Finishes a sign-in that is coming back from Google or an email link.
  ready(): Promise<void> {
    if (!readyPromise) {
      readyPromise = (async () => {
        if (!sb) return;
        const u = new URL(window.location.href);
        const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
        const err = hash.get('error_description') || u.searchParams.get('error_description');
        const { data } = await sb.auth.getSession();
        session = data.session;
        if (u.hash.includes('access_token') || err || u.searchParams.has('code')) {
          window.history.replaceState(null, '', u.pathname);
        }
        if (err && !session) {
          throw new Error(
            err.toLowerCase().includes('expired') || err.toLowerCase().includes('invalid')
              ? 'That sign-in link has expired or was already used. Ask for a new code below.'
              : err,
          );
        }
      })();
    }
    return readyPromise;
  },
  isSignedIn(): boolean {
    return isLocalMode ? !!localEmail() : !!session || hasStoredSession();
  },
  async email(): Promise<string> {
    if (isLocalMode) return localEmail();
    const { data } = await sb!.auth.getSession();
    return data.session?.user?.email || '';
  },
  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Goes to Google in the same tab (no pop-up), then comes back signed in.
  async signInWithGoogle(): Promise<void> {
    const { error } = await sb!.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: homeUrl(), queryParams: { prompt: 'select_account' } },
    });
    if (error) throw friendlyAuthError(error);
  },
  // Emails a sign-in code. Locally, signs in straight away.
  async sendCode(email: string): Promise<'sent' | 'signed-in'> {
    const clean = email.trim().toLowerCase();
    if (isLocalMode) {
      try {
        localStorage.setItem(LOCAL_KEY, clean);
      } catch {
        // storage unavailable
      }
      listeners.forEach((fn) => fn());
      return 'signed-in';
    }
    const { error } = await sb!.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true, emailRedirectTo: homeUrl() },
    });
    if (error) throw friendlyAuthError(error);
    return 'sent';
  },
  // Checks the code typed in from the email.
  async verifyCode(email: string, code: string): Promise<void> {
    const { data, error } = await sb!.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.replace(/\s/g, ''),
      type: 'email',
    });
    if (error || !data.session) throw friendlyAuthError(error || new Error('invalid code'));
    session = data.session;
  },
  async signOut(): Promise<void> {
    if (isLocalMode) {
      try {
        localStorage.removeItem(LOCAL_KEY);
      } catch {
        // storage unavailable
      }
      return;
    }
    try {
      await sb!.auth.signOut();
    } finally {
      session = null;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i) || '';
          if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
        }
      } catch {
        // storage unavailable
      }
    }
  },
};

// ---------- direct file uploads ----------

// Sends a file straight to storage using a one-time link from the server. Reports progress from 0 to 100.
export function putFile(url: string, file: Blob, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolveUpload, rejectUpload) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'true');
    if (SUPABASE_KEY) xhr.setRequestHeader('apikey', SUPABASE_KEY);
    if (file.type) xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (ev) => {
      if (onProgress && ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolveUpload() : rejectUpload(new Error('Upload failed (' + xhr.status + ')')));
    xhr.onerror = () => rejectUpload(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

// ---------- phone alerts ----------

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function platformName(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export const notifications = {
  async getEnvironment(): Promise<{ isSupported: boolean; platform: 'ios' | 'android' | 'desktop'; permission: NotificationPermission | 'default' }> {
    const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    return {
      isSupported,
      platform: platformName(),
      permission: 'Notification' in window ? Notification.permission : 'default',
    };
  },
  // Asks permission and registers this device for phone alerts.
  async subscribe(): Promise<{ ok: true }> {
    if (isLocalMode) {
      console.info('Phone alerts are printed in the server terminal when running locally.');
      return { ok: true };
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('This browser does not support alerts. On iPhone, add the site to your Home Screen first.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Alerts were not allowed. Allow notifications for this site in your browser settings.');
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { data } = await api.get('/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(data.publicKey) as BufferSource });
    }
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
    return { ok: true };
  },
  async unsubscribe(_options?: { showUi?: boolean }): Promise<void> {
    if (isLocalMode || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      try {
        await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
      } finally {
        await sub.unsubscribe();
      }
    }
  },
};
