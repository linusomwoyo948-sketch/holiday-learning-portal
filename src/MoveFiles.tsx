import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { FolderInput, FolderOutput } from 'lucide-react';
import { api, errMsg } from './lib';
import { Alert, Btn, Card } from './ui';

type Job = {
  total: number;
  next: number;
  copied: number;
  failed: string[];
  startedAt: string;
  finishedAt: string;
};

// Moves attached files (notes, assignments, students' work) from the old site to this one.
// Step 1 on the old site: download the file list. Step 2 here: upload that list and the files are copied across.
export default function MoveFiles() {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState<'' | 'export' | 'copy'>('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/owner/file-copy');
      setJob((r.data?.job || null) as Job | null);
    } catch {
      // not important
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function exportList() {
    setBusy('export');
    setErr('');
    setMsg('');
    try {
      const r = await api.get('/api/owner/export-files');
      const blob = new Blob([JSON.stringify(r.data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `holiday-portal-files-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMsg(`File list downloaded (${(r.data?.files || []).length} files). The links in it work for a few hours.`);
    } catch (e) {
      setErr(errMsg(e, 'Could not make the file list.'));
    } finally {
      setBusy('');
    }
  }

  async function runSteps() {
    let failures = 0;
    for (;;) {
      try {
        const r = await api.post('/api/owner/file-copy/step', {});
        const j = r.data.job as Job;
        setJob(j);
        failures = 0;
        if (j.finishedAt) return j;
      } catch (e) {
        failures += 1;
        if (failures >= 3) throw e;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      }
    }
  }

  function finishMessage(j: Job) {
    setMsg(
      j.failed.length
        ? `Copied ${j.copied} of ${j.total} files. ${j.failed.length} could not be copied, usually because the links expired. Download a new file list from the old site and copy again; files already copied are simply replaced.`
        : `All ${j.copied} files were copied.`,
    );
  }

  async function uploadList(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy('copy');
    setErr('');
    setMsg('');
    try {
      const parsed = JSON.parse(await file.text()) as { kind?: string; files?: unknown[] };
      if (parsed.kind !== 'holiday-portal-files' || !Array.isArray(parsed.files)) {
        throw new Error('This is not a file list from the old site. Use the file named holiday-portal-files-….json.');
      }
      const r = await api.post('/api/owner/file-copy/start', { files: parsed.files });
      setJob(r.data.job as Job);
      finishMessage(await runSteps());
    } catch (ex) {
      setErr(ex instanceof SyntaxError ? 'That file could not be read.' : errMsg(ex, ex instanceof Error ? ex.message : 'The copy stopped.'));
      await load();
    } finally {
      setBusy('');
    }
  }

  async function continueCopy() {
    setBusy('copy');
    setErr('');
    setMsg('');
    try {
      finishMessage(await runSteps());
    } catch (ex) {
      setErr(errMsg(ex, 'The copy stopped. Click Continue to carry on.'));
    } finally {
      setBusy('');
    }
  }

  const running = job && !job.finishedAt;
  const percent = job && job.total ? Math.round((job.next / job.total) * 100) : 0;

  return (
    <Card>
      <h2 className='text-lg font-bold text-slate-900'>Move files between sites</h2>
      <p className='mt-1 text-sm text-slate-600'>
        Backups hold every record but not the attached files (notes, assignments and students’ work). To move the
        files: on the old site click <span className='font-semibold'>Download file list</span>, then on the new site
        click <span className='font-semibold'>Copy files from a list</span> and choose that file. Do this after
        restoring the backup.
      </p>
      <div className='mt-3 flex flex-wrap gap-2'>
        <Btn variant='secondary' onClick={exportList} disabled={!!busy}>
          <FolderOutput className='h-4 w-4' />
          {busy === 'export' ? 'Preparing…' : 'Download file list'}
        </Btn>
        <label
          className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 ${
            busy ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          <FolderInput className='h-4 w-4' />
          {busy === 'copy' ? 'Copying…' : 'Copy files from a list'}
          <input type='file' accept='.json,application/json' className='hidden' onChange={uploadList} />
        </label>
      </div>
      <div className='mt-3 space-y-3'>
        {err && <Alert>{err}</Alert>}
        {msg && <Alert kind='success'>{msg}</Alert>}
        {running && (
          <div className='rounded-lg border border-amber-200 bg-amber-50 p-3'>
            <div className='text-sm font-semibold text-amber-900'>
              {busy === 'copy' ? 'Copying files… please keep this page open.' : 'A file copy has not finished.'} {job.next} of{' '}
              {job.total}
              {busy !== 'copy' && (
                <button type='button' className='ml-2 font-semibold underline' onClick={continueCopy}>
                  Continue
                </button>
              )}
            </div>
            <div className='mt-2 h-2 w-full overflow-hidden rounded-full bg-amber-100'>
              <div className='h-full bg-amber-500 transition-all' style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
