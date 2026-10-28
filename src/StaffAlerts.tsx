import { useEffect, useState } from 'react';
import { notifications } from './platform/client';
import { Bell, BellOff } from 'lucide-react';
import { Btn } from './ui';

type State = 'loading' | 'on' | 'off' | 'blocked' | 'unsupported';

const MARK = 'holiday-portal-alerts';

export default function StaffAlerts() {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notifications
      .getEnvironment()
      .then((env) => {
        if (cancelled) return;
        let marked = false;
        try {
          marked = window.localStorage.getItem(MARK) === 'on';
        } catch {
          marked = false;
        }
        if (!env.isSupported && env.platform !== 'ios') setState('unsupported');
        else if (env.permission === 'denied') setState('blocked');
        else if (env.permission === 'granted' && marked) setState('on');
        else setState('off');
      })
      .catch(() => {
        if (!cancelled) setState('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (state === 'on') {
        await notifications.unsubscribe({ showUi: false });
        try {
          window.localStorage.removeItem(MARK);
        } catch {
          // storage unavailable
        }
        setState('off');
      } else {
        await notifications.subscribe();
        try {
          window.localStorage.setItem(MARK, 'on');
        } catch {
          // storage unavailable
        }
        setState('on');
      }
    } catch {
      const env = await notifications.getEnvironment().catch(() => null);
      setState(env && env.permission === 'denied' ? 'blocked' : 'off');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'unsupported') return null;
  if (state === 'blocked') {
    return (
      <span className='hidden text-xs text-emerald-100 sm:inline' title='Allow notifications for this site in your browser settings'>
        Phone alerts blocked
      </span>
    );
  }
  return (
    <Btn variant='secondary' onClick={toggle} disabled={busy} title='Get an alert on this phone or computer for new requests and student questions'>
      {state === 'on' ? <Bell className='h-4 w-4' /> : <BellOff className='h-4 w-4' />}
      <span className='hidden sm:inline'>{state === 'on' ? 'Alerts on' : 'Turn on alerts'}</span>
    </Btn>
  );
}

