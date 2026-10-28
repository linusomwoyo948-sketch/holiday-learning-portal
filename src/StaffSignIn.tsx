import { useEffect, useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import { auth, googleSignInEnabled, isLocalMode } from './platform/client';
import { Alert, Btn, inputCls, labelCls } from './ui';

const EMAIL_KEY = 'holiday-portal-staff-email';

function readEmail(): string {
  try {
    return window.localStorage.getItem(EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

function writeEmail(v: string): void {
  try {
    window.localStorage.setItem(EMAIL_KEY, v);
  } catch {
    // storage unavailable
  }
}

function GoogleMark() {
  return (
    <svg viewBox='0 0 48 48' className='h-4 w-4' aria-hidden='true'>
      <path fill='#EA4335' d='M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z' />
      <path fill='#4285F4' d='M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z' />
      <path fill='#FBBC05' d='M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z' />
      <path fill='#34A853' d='M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z' />
    </svg>
  );
}

// Teacher and principal sign-in. An emailed code is typed in here, so it works whichever phone,
// computer or email app opens the email.
export default function StaffSignIn({ onSignedIn, initialError }: { onSignedIn: () => void; initialError?: string }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(() => readEmail());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');
  const [info, setInfo] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (initialError) setErr(initialError);
  }, [initialError]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  async function sendCode(e?: FormEvent) {
    if (e) e.preventDefault();
    setErr('');
    setInfo('');
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setErr('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      writeEmail(clean);
      const result = await auth.sendCode(clean);
      if (result === 'signed-in') {
        onSignedIn();
        return;
      }
      setStep('code');
      setCode('');
      setWait(60);
      setInfo(`We sent a sign-in code to ${clean}. It can take a minute to arrive. Check your spam or junk folder too.`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) {
      setErr('Type the code from the email (6 or more digits).');
      return;
    }
    setBusy(true);
    try {
      await auth.verifyCode(email, digits);
      onSignedIn();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setErr('');
    setBusy(true);
    try {
      await auth.signInWithGoogle();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Google sign-in failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className='space-y-3'>
      {step === 'email' ? (
        <form onSubmit={sendCode} noValidate className='space-y-3'>
          <div>
            <label htmlFor='staff-email' className={labelCls}>
              Email address
            </label>
            <input
              id='staff-email'
              type='email'
              inputMode='email'
              autoComplete='email'
              className={inputCls}
              placeholder='you@example.com'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {err && <Alert>{err}</Alert>}
          <Btn type='submit' disabled={busy} className='w-full'>
            <Mail className='h-4 w-4' />
            {busy ? 'Sending…' : isLocalMode ? 'Sign in (test mode)' : 'Email me a sign-in code'}
          </Btn>
          {googleSignInEnabled && (
            <>
              <div className='flex items-center gap-3 text-xs text-slate-400'>
                <div className='h-px flex-1 bg-slate-200' />
                or
                <div className='h-px flex-1 bg-slate-200' />
              </div>
              <Btn type='button' variant='secondary' disabled={busy} onClick={google} className='w-full'>
                <GoogleMark />
                Continue with Google
              </Btn>
            </>
          )}
        </form>
      ) : (
        <form onSubmit={verify} noValidate className='space-y-3'>
          {info && <Alert kind='info'>{info}</Alert>}
          <div>
            <label htmlFor='staff-code' className={labelCls}>
              Sign-in code
            </label>
            <input
              id='staff-code'
              inputMode='numeric'
              autoComplete='one-time-code'
              maxLength={12}
              className={`${inputCls} text-center text-lg tracking-[0.3em]`}
              placeholder='123456'
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <p className='mt-1 text-xs text-slate-500'>
              Type the code here on this device. You can open the email on any phone or computer.
            </p>
          </div>
          {err && <Alert>{err}</Alert>}
          <Btn type='submit' disabled={busy} className='w-full'>
            {busy ? 'Checking…' : 'Sign in'}
          </Btn>
          <div className='flex flex-wrap justify-between gap-2 text-sm'>
            <button
              type='button'
              className='font-semibold text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline'
              disabled={busy || wait > 0}
              onClick={() => sendCode()}
            >
              {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
            </button>
            <button
              type='button'
              className='font-semibold text-slate-600 hover:underline'
              onClick={() => {
                setStep('email');
                setErr('');
                setInfo('');
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
