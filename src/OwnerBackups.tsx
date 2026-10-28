import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { DatabaseBackup, Download, History, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import { api, errMsg, fmtDateTime, fmtSize } from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';

type Kind = 'auto' | 'manual' | 'base' | 'uploaded' | 'safety';

type Backup = {
  path: string;
  createdAt: string;
  records: number;
  size: number;
  kind: Kind;
  url: string;
};

type RestoreState = { path: string; done: number; total: number } | null;

const KIND_LABEL: Record<Kind, string> = {
  auto: 'Automatic nightly backup',
  manual: 'Backup made by you',
  base: 'First full backup',
  uploaded: 'Uploaded backup file',
  safety: 'Safety copy taken before a restore',
};

const CHUNK_BYTES = 1500000;

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

function newUploadId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export default function OwnerBackups() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [pending, setPending] = useState<RestoreState>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'backup' | 'upload' | 'restore'>('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmPath, setConfirmPath] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadInfo, setUploadInfo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/owner/backups');
      setBackups((r.data?.backups || r.data?.snapshots || []) as Backup[]);
      setPending((r.data?.restore || null) as RestoreState);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the backups.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function backupNow() {
    setBusy('backup');
    setErr('');
    setMsg('');
    try {
      await api.post('/api/owner/backups', {});
      setMsg('A new backup has been saved.');
      await load();
    } catch (e) {
      setErr(errMsg(e, 'The backup could not be made. Please try again.'));
    } finally {
      setBusy('');
    }
  }

  async function runSteps() {
    let finished = false;
    let failures = 0;
    while (!finished) {
      try {
        const r = await api.post('/api/owner/backups/restore/step', {});
        setProgress({ done: Number(r.data?.done || 0), total: Number(r.data?.total || 0) });
        finished = Boolean(r.data?.finished);
        failures = 0;
      } catch (e) {
        failures += 1;
        if (failures >= 3) throw e;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      }
    }
  }

  async function startRestore() {
    if (confirmText.trim() !== 'RESTORE') {
      setErr('Type RESTORE in capital letters to confirm.');
      return;
    }
    setBusy('restore');
    setErr('');
    setMsg('');
    setProgress(null);
    try {
      const r = await api.post('/api/owner/backups/restore/start', { path: confirmPath, confirm: 'RESTORE' });
      setProgress({ done: 0, total: Number(r.data?.total || 0) });
      await runSteps();
      setConfirmPath('');
      setConfirmText('');
      setMsg('Restore finished. The data from the chosen backup is back in place.');
      await load();
    } catch (e) {
      setErr(errMsg(e, 'The restore stopped before it finished. Click Continue restore to carry on.'));
      await load();
    } finally {
      setBusy('');
    }
  }

  async function continueRestore() {
    setBusy('restore');
    setErr('');
    setMsg('');
    try {
      await runSteps();
      setMsg('Restore finished. The data from the chosen backup is back in place.');
      await load();
    } catch (e) {
      setErr(errMsg(e, 'The restore stopped before it finished. Click Continue restore to carry on.'));
    } finally {
      setBusy('');
    }
  }

  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    setErr('');
    setMsg('');
    try {
      const uploadId = newUploadId();
      const count = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
      for (let i = 0; i < count; i++) {
        setUploadInfo(`Uploading part ${i + 1} of ${count}…`);
        const part = await file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer();
        await api.post('/api/owner/backups/upload-chunk', { uploadId, index: i, data: bytesToBase64(part) });
      }
      setUploadInfo('Checking the file…');
      await api.post('/api/owner/backups/upload-finish', { uploadId, count });
      setMsg('Backup file added to the list below. You can restore from it if needed.');
      await load();
    } catch (ex) {
      setErr(errMsg(ex, 'The file could not be uploaded.'));
    } finally {
      setUploadInfo('');
      setBusy('');
    }
  }

  const percent = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <Card>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700'>
            <DatabaseBackup className='h-5 w-5' />
          </div>
          <div>
            <h2 className='text-lg font-bold text-slate-900'>Backups</h2>
            <p className='text-sm text-slate-600'>
              A full backup of every school is saved automatically every night at 2:00 am (Nairobi time), and the last
              30 are kept. Download copies now and then and keep them somewhere safe, such as your computer or Google
              Drive.
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Btn variant='ghost' onClick={load} disabled={loading || !!busy}>
            <RefreshCw className='h-4 w-4' />
            Refresh
          </Btn>
          <Btn onClick={backupNow} disabled={!!busy}>
            <DatabaseBackup className='h-4 w-4' />
            {busy === 'backup' ? 'Backing up…' : 'Back up now'}
          </Btn>
          <label
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 ${
              busy ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Upload className='h-4 w-4' />
            {busy === 'upload' ? 'Uploading…' : 'Upload backup file'}
            <input type='file' accept='.json,application/json' className='hidden' onChange={uploadFile} />
          </label>
        </div>
      </div>

      <div className='mt-4 space-y-3'>
        {uploadInfo && <Alert kind='info'>{uploadInfo}</Alert>}
        {err && <Alert>{err}</Alert>}
        {msg && <Alert kind='success'>{msg}</Alert>}
        {pending && busy !== 'restore' && (
          <Alert kind='info'>
            A restore was started but has not finished ({pending.done} of {pending.total} records).{' '}
            <button type='button' className='font-semibold underline' onClick={continueRestore}>
              Continue restore
            </button>
          </Alert>
        )}
        {busy === 'restore' && (
          <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
            <div className='text-sm font-semibold text-amber-900'>
              Restoring… please keep this page open. {progress ? `${progress.done} of ${progress.total} records` : ''}
            </div>
            <div className='mt-2 h-2 w-full overflow-hidden rounded-full bg-amber-100'>
              <div className='h-full bg-amber-500 transition-all' style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>

      {loading && backups.length === 0 ? (
        <Spinner />
      ) : backups.length === 0 ? (
        <p className='mt-4 text-sm text-slate-500'>No backups yet. Click Back up now to make the first one.</p>
      ) : (
        <ul className='mt-4 divide-y divide-slate-100'>
          {backups.map((b) => (
            <li key={b.path} className='py-3'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='font-semibold text-slate-900'>{fmtDateTime(b.createdAt)}</div>
                  <div className='text-xs text-slate-500'>
                    {KIND_LABEL[b.kind] || 'Backup'} · {b.records.toLocaleString()} records · {fmtSize(b.size)}
                  </div>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {b.url && (
                    <a
                      href={b.url}
                      target='_blank'
                      rel='noreferrer'
                      download
                      className='inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50'
                    >
                      <Download className='h-4 w-4' />
                      Download
                    </a>
                  )}
                  <Btn
                    variant='danger'
                    disabled={!!busy}
                    onClick={() => {
                      setConfirmPath(confirmPath === b.path ? '' : b.path);
                      setConfirmText('');
                      setErr('');
                    }}
                  >
                    <RotateCcw className='h-4 w-4' />
                    Restore
                  </Btn>
                </div>
              </div>
              {confirmPath === b.path && (
                <div className='mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3'>
                  <p className='text-sm text-red-800'>
                    Restoring puts every school’s records back to how they were at {fmtDateTime(b.createdAt)}. Changes
                    made since then to those records will be replaced. A safety copy of the current data is saved first,
                    so this can be undone. Type <span className='font-bold'>RESTORE</span> to continue.
                  </p>
                  <div className='flex flex-col gap-2 sm:flex-row'>
                    <input
                      aria-label='Type RESTORE to confirm'
                      className={inputCls}
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder='RESTORE'
                    />
                    <Btn variant='danger' disabled={!!busy} onClick={startRestore} className='shrink-0'>
                      Restore this backup
                    </Btn>
                    <Btn variant='ghost' onClick={() => setConfirmPath('')} className='shrink-0'>
                      Cancel
                    </Btn>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type AuditEvent = { id: string; at?: string; by?: string; action?: string; detail?: string };

export function SecurityLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/owner/audit');
      setEvents((r.data?.events || []) as AuditEvent[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the security log.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <History className='h-5 w-5 text-emerald-700' />
          <h2 className='text-lg font-bold text-slate-900'>Security log</h2>
        </div>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className='h-4 w-4' />
          Refresh
        </Btn>
      </div>
      <p className='mt-1 text-sm text-slate-600'>
        Important actions on the site: schools approved or paused, backups, restores and website name changes.
      </p>
      {err && (
        <div className='mt-3'>
          <Alert>{err}</Alert>
        </div>
      )}
      {loading && events.length === 0 ? (
        <Spinner />
      ) : events.length === 0 ? (
        <p className='mt-3 text-sm text-slate-500'>Nothing recorded yet.</p>
      ) : (
        <ul className='mt-3 divide-y divide-slate-100'>
          {events.map((ev) => (
            <li key={ev.id} className='flex flex-wrap items-start justify-between gap-2 py-2 text-sm'>
              <div className='min-w-0'>
                <span className='font-semibold text-slate-800'>{ev.action}</span>
                {ev.detail ? <span className='text-slate-600'> · {ev.detail}</span> : null}
                <div className='break-all text-xs text-slate-500'>{ev.by}</div>
              </div>
              <span className='shrink-0 text-xs text-slate-500'>{ev.at ? fmtDateTime(ev.at) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

