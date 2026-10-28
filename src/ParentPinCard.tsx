import { useEffect, useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { api, errMsg, statusOf, type StudentSession } from './lib';
import { Alert, Btn, Card, inputCls } from './ui';

export default function ParentPinCard({ session, onExpired }: { session: StudentSession; onExpired: () => void }) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .post('/api/student/parent-pin/status', { token: session.token })
      .then((r) => {
        if (!cancelled) setHasPin(Boolean(r.data?.hasPin));
      })
      .catch((e) => {
        if (statusOf(e) === 401) onExpired();
        else if (!cancelled) setHasPin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.token, onExpired]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (!/^[0-9]{4,8}$/.test(pin)) {
      setErr('Use 4 to 8 digits for the PIN.');
      return;
    }
    if (pin !== again) {
      setErr('The two PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/student/parent-pin', { token: session.token, pin });
      setHasPin(true);
      setOpen(false);
      setPin('');
      setAgain('');
      setMsg('Parent PIN saved. Share it only with your parent or guardian.');
    } catch (ex) {
      setErr(errMsg(ex, 'Could not save the PIN.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Users className='mt-0.5 h-5 w-5 shrink-0 text-emerald-700' />
          <div>
            <h3 className='font-bold text-slate-900'>Parent access</h3>
            <p className='text-sm text-slate-600'>
              {hasPin
                ? 'Your parent or guardian can follow your progress with the PIN you set.'
                : 'Set a PIN so your parent or guardian can see your marks, assignments and notices. They cannot change anything.'}
            </p>
          </div>
        </div>
        {hasPin !== null && (
          <Btn variant='secondary' onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : hasPin ? 'Change PIN' : 'Set a parent PIN'}
          </Btn>
        )}
      </div>
      {msg && (
        <div className='mt-3'>
          <Alert kind='success'>{msg}</Alert>
        </div>
      )}
      {open && (
        <form onSubmit={save} noValidate className='mt-4 space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <input
              aria-label='New parent PIN'
              className={inputCls}
              inputMode='numeric'
              type='password'
              placeholder='PIN (4 to 8 digits)'
              value={pin}
              onChange={(e) => setPin(e.target.value.trim())}
            />
            <input
              aria-label='Type the PIN again'
              className={inputCls}
              inputMode='numeric'
              type='password'
              placeholder='Type the PIN again'
              value={again}
              onChange={(e) => setAgain(e.target.value.trim())}
            />
          </div>
          <p className='text-xs text-slate-500'>
            Your parent signs in on the home page with “I am a parent”, using your school, class, admission number and
            this PIN.
          </p>
          {err && <Alert>{err}</Alert>}
          <Btn type='submit' disabled={busy}>
            {busy ? 'Saving…' : 'Save PIN'}
          </Btn>
        </form>
      )}
    </Card>
  );
}

