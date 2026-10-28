import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { api, fmtDateTime, statusOf, type StudentSession } from './lib';

type Item = { id: string; title: string; body: string; at: string; tab: string; when?: string; whenLabel?: string };

type Props = {
  session: StudentSession;
  onOpenTab: (tab: string) => void;
  onExpired: () => void;
};

const POLL_MS = 2 * 60 * 1000;

function seenKey(s: StudentSession): string {
  return `holiday-portal-seen-${s.streamId}-${s.admissionNo}`;
}

function readSeen(s: StudentSession): string {
  try {
    return window.localStorage.getItem(seenKey(s)) || '';
  } catch {
    return '';
  }
}

function writeSeen(s: StudentSession, iso: string): void {
  try {
    window.localStorage.setItem(seenKey(s), iso);
  } catch {
    // storage unavailable
  }
}

export default function NotificationBell({ session, onOpenTab, onExpired }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [seen, setSeen] = useState(() => readSeen(session));
  const [highlightAfter, setHighlightAfter] = useState(seen);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.post('/api/student/notifications', { token: session.token });
      setItems((r.data?.items || []) as Item[]);
    } catch (e) {
      if (statusOf(e) === 401) onExpired();
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    load();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => {
      if (panel.current && !panel.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const unread = items.filter((i) => i.at > seen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setHighlightAfter(seen);
      const newest = items.length ? items[0].at : new Date().toISOString();
      if (newest > seen) {
        setSeen(newest);
        writeSeen(session, newest);
      }
    }
  }

  return (
    <div className='relative' ref={panel}>
      <button
        type='button'
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        className='relative flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-600'
      >
        <Bell className='h-5 w-5' />
        {unread > 0 && (
          <span className='absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white'>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className='absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg'>
          <div className='flex items-center justify-between border-b border-slate-100 px-4 py-2'>
            <span className='text-sm font-bold'>Notifications</span>
            <button type='button' onClick={() => setOpen(false)} aria-label='Close' className='text-slate-400 hover:text-slate-700'>
              <X className='h-4 w-4' />
            </button>
          </div>
          {items.length === 0 ? (
            <p className='px-4 py-6 text-center text-sm text-slate-500'>Nothing new in the last two weeks.</p>
          ) : (
            <ul className='max-h-[60vh] divide-y divide-slate-100 overflow-y-auto'>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type='button'
                    onClick={() => {
                      setOpen(false);
                      onOpenTab(it.tab);
                    }}
                    className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${it.at > highlightAfter ? 'bg-emerald-50' : ''}`}
                  >
                    <div className='text-sm font-semibold text-slate-900'>{it.title}</div>
                    {it.body && <div className='mt-0.5 line-clamp-2 text-xs text-slate-600'>{it.body}</div>}
                    <div className='mt-1 text-xs text-slate-400'>
                      {it.when ? `${it.whenLabel || 'Date'}: ${fmtDateTime(it.when)} · ` : ''}
                      {fmtDateTime(it.at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

