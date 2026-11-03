import { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { canPromptInstall, isAndroid, isInstalled, isIos, onInstallChange, promptInstall } from './install';
import { Btn } from './ui';

const HIDE_KEY = 'holiday-portal-install-hidden';

function hiddenByUser(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

// Invites people to put the portal on their home screen. Hidden once installed or closed.
export default function InstallCard() {
  const [, setTick] = useState(0);
  const [hidden, setHidden] = useState(() => hiddenByUser());
  const [msg, setMsg] = useState('');

  useEffect(() => onInstallChange(() => setTick((n) => n + 1)), []);

  if (hidden || isInstalled()) return null;

  const promptable = canPromptInstall();
  const ios = isIos();
  const android = isAndroid();
  if (!promptable && !ios && !android) return null;

  function close() {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY, '1');
    } catch {
      // storage unavailable
    }
  }

  async function install() {
    const r = await promptInstall();
    if (r === 'accepted') setMsg('Installed. Open it from your home screen next time.');
  }

  return (
    <div className='mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4'>
      <Smartphone className='mt-0.5 h-5 w-5 shrink-0 text-emerald-700' />
      <div className='min-w-0 flex-1'>
        <div className='font-semibold text-emerald-900'>Put the portal on your home screen</div>
        {msg ? (
          <p className='mt-1 text-sm text-emerald-900'>{msg}</p>
        ) : promptable ? (
          <>
            <p className='mt-1 text-sm text-emerald-900'>
              Open it with one tap like an app, full screen, even when the internet is slow.
            </p>
            <Btn className='mt-3' onClick={install}>
              <Download className='h-4 w-4' />
              Install app
            </Btn>
          </>
        ) : ios ? (
          <p className='mt-1 text-sm text-emerald-900'>
            In Safari, tap the Share button <Share className='inline h-4 w-4 align-text-bottom' /> at the bottom of the
            screen, then choose <span className='font-semibold'>Add to Home Screen</span>.
          </p>
        ) : (
          <p className='mt-1 text-sm text-emerald-900'>
            Open your browser menu (<span className='font-semibold'>⋮</span> at the top right) and choose{' '}
            <span className='font-semibold'>Install app</span> or <span className='font-semibold'>Add to Home screen</span>.
          </p>
        )}
      </div>
      <button type='button' onClick={close} aria-label='Close' className='shrink-0 text-emerald-700 hover:text-emerald-900'>
        <X className='h-4 w-4' />
      </button>
    </div>
  );
}
