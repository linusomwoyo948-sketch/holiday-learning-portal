import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, PauseCircle, PlayCircle, RefreshCw, Trash2, X } from 'lucide-react';
import { api, errMsg, fmtDate } from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';
import { setSiteName, useSiteName } from './site';
import OwnerBackups, { SecurityLog } from './OwnerBackups';
import UsageSummary from './UsageSummary';
import MoveFiles from './MoveFiles';

type SchoolStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

type SchoolRow = {
  id: string;
  name: string;
  principalName: string;
  principalEmail: string;
  phone: string;
  status: SchoolStatus;
  createdAt: string;
  classes: number;
  teachers: number;
  students: number;
};

const GROUPS: Array<{ key: SchoolStatus; title: string; empty: string }> = [
  { key: 'pending', title: 'Requests waiting for approval', empty: 'No new school requests.' },
  { key: 'approved', title: 'Active schools', empty: 'No active schools yet.' },
  { key: 'suspended', title: 'Paused schools', empty: '' },
  { key: 'rejected', title: 'Declined requests', empty: '' },
];

const BADGE: Record<SchoolStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-emerald-100 text-emerald-800',
  suspended: 'bg-slate-200 text-slate-700',
  rejected: 'bg-red-50 text-red-700',
};

const BADGE_LABEL: Record<SchoolStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Active',
  suspended: 'Paused',
  rejected: 'Declined',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className='text-center'>
      <div className='text-2xl font-bold text-slate-900'>{value}</div>
      <div className='text-xs text-slate-500'>{label}</div>
    </Card>
  );
}

function SiteNameCard() {
  const siteName = useSiteName();
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const shown = touched ? value : siteName;

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    const name = shown.trim();
    if (!name) {
      setErr('Enter a name for the website.');
      return;
    }
    setSaving(true);
    try {
      const r = await api.post('/api/owner/site', { siteName: name });
      setSiteName(String(r.data?.siteName || name));
      setTouched(false);
      setMsg('Website name saved. It now shows on the home page, the browser tab and the sign-in screens.');
    } catch (ex) {
      setErr(errMsg(ex, 'Could not save the website name.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} noValidate className='space-y-3'>
        <div>
          <h2 className='text-lg font-bold text-slate-900'>Website name</h2>
          <p className='text-sm text-slate-600'>
            Shown on the home page, in the browser tab and to staff before they join a school. Each school’s own name
            appears only inside that school’s portal.
          </p>
        </div>
        <div className='flex flex-col gap-2 sm:flex-row'>
          <input
            aria-label='Website name'
            className={inputCls}
            value={shown}
            onChange={(e) => {
              setTouched(true);
              setValue(e.target.value);
            }}
          />
          <Btn type='submit' disabled={saving} className='shrink-0'>
            {saving ? 'Saving…' : 'Save name'}
          </Btn>
        </div>
        {err && <Alert>{err}</Alert>}
        {msg && <Alert kind='success'>{msg}</Alert>}
      </form>
    </Card>
  );
}

export default function Owner() {
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [deleting, setDeleting] = useState<{ schoolName: string; removed: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ schoolId: string; schoolName: string; removed: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/owner/schools');
      setSchools((r.data?.schools || []) as SchoolRow[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load schools.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api
      .get('/api/owner/schools/delete/status')
      .then((r) => setPendingDelete(r.data?.job || null))
      .catch(() => undefined);
  }, [load]);

  // Deletes in rounds until the server says everything is gone.
  async function runDeleteSteps(schoolName: string) {
    setDeleting({ schoolName, removed: 0 });
    let failures = 0;
    for (;;) {
      try {
        const r = await api.post('/api/owner/schools/delete/step', {});
        failures = 0;
        setDeleting({ schoolName, removed: Number(r.data?.removed) || 0 });
        if (r.data?.finished) {
          setNotice(`${schoolName} and all its data have been deleted (${Number(r.data?.removed) || 0} records). A safety backup taken just before is in Backups if you ever need it.`);
          break;
        }
      } catch (e) {
        failures += 1;
        if (failures >= 3) {
          setErr(errMsg(e, 'Deleting stopped before it finished. Click Continue deleting to carry on.'));
          break;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      }
    }
    setDeleting(null);
    setPendingDelete(null);
    await load();
    api
      .get('/api/owner/schools/delete/status')
      .then((r) => setPendingDelete(r.data?.job || null))
      .catch(() => undefined);
  }

  async function deleteSchool(s: SchoolRow) {
    const typed = window.prompt(
      `Permanently delete ${s.name}?\n\nThis removes the principal, teachers, classes, students, materials, assignments, exams, marks and files of this school. A safety backup is saved first.\n\nType the school name to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== s.name.trim().toLowerCase()) {
      setErr('The name you typed did not match, so nothing was deleted.');
      return;
    }
    setBusyId(s.id);
    setErr('');
    setNotice('');
    try {
      await api.post(`/api/owner/schools/${s.id}/delete/start`, { confirm: typed });
      await runDeleteSteps(s.name);
    } catch (e) {
      setErr(errMsg(e, 'Could not delete the school.'));
    } finally {
      setBusyId('');
    }
  }

  async function setStatus(s: SchoolRow, status: SchoolStatus, label: string) {
    if (status === 'suspended' && !window.confirm(`Pause ${s.name}? Its principal, teachers and students will not be able to use the portal until you reactivate it.`)) {
      return;
    }
    setBusyId(s.id);
    setErr('');
    setNotice('');
    try {
      await api.post(`/api/owner/schools/${s.id}`, { status });
      setNotice(`${s.name}: ${label}.`);
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not update the school.'));
    } finally {
      setBusyId('');
    }
  }

  async function remove(s: SchoolRow) {
    if (!window.confirm(`Remove the request for ${s.name}? The name will become free for others to use.`)) return;
    setBusyId(s.id);
    setErr('');
    setNotice('');
    try {
      await api.delete(`/api/owner/schools/${s.id}`);
      setNotice(`The request for ${s.name} was removed.`);
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not remove the request.'));
    } finally {
      setBusyId('');
    }
  }

  const active = schools.filter((s) => s.status === 'approved');
  const pending = schools.filter((s) => s.status === 'pending');
  const totalStudents = active.reduce((sum, s) => sum + s.students, 0);
  const totalTeachers = active.reduce((sum, s) => sum + s.teachers, 0);

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>Schools on the portal</h1>
          <p className='text-sm text-slate-600'>
            Approve new schools and pause or reactivate existing ones. To remove a school that no longer uses the
            portal, pause it first, then click Delete school.
          </p>
        </div>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>

      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Stat label='Active schools' value={active.length} />
        <Stat label='Waiting for approval' value={pending.length} />
        <Stat label='Approved teachers' value={totalTeachers} />
        <Stat label='Students' value={totalStudents} />
      </div>

      <SiteNameCard />

      <OwnerBackups />

      <MoveFiles />

      <UsageSummary />

      <SecurityLog />

      {err && <Alert>{err}</Alert>}
      {notice && <Alert kind='success'>{notice}</Alert>}
      {deleting && (
        <Alert kind='info'>
          Deleting {deleting.schoolName}… {deleting.removed} records removed so far. Please keep this page open.
        </Alert>
      )}
      {!deleting && pendingDelete && (
        <Alert kind='info'>
          Deleting {pendingDelete.schoolName} has not finished.{' '}
          <button type='button' className='font-semibold underline' onClick={() => runDeleteSteps(pendingDelete.schoolName)}>
            Continue deleting
          </button>
        </Alert>
      )}

      {loading && schools.length === 0 ? (
        <Spinner />
      ) : (
        GROUPS.map((g) => {
          const group = schools.filter((s) => s.status === g.key);
          if (!group.length && !g.empty) return null;
          return (
            <section key={g.key}>
              <h2 className='mb-3 text-lg font-bold text-slate-900'>
                {g.title} ({group.length})
              </h2>
              {group.length === 0 ? (
                <Card className='text-sm text-slate-500'>{g.empty}</Card>
              ) : (
                <div className='space-y-3'>
                  {group.map((s) => {
                    const busy = busyId === s.id;
                    return (
                      <Card key={s.id}>
                        <div className='flex flex-wrap items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <span className='break-words text-lg font-bold text-slate-900'>{s.name}</span>
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[s.status]}`}>
                                {BADGE_LABEL[s.status]}
                              </span>
                            </div>
                            <div className='mt-1 text-sm text-slate-700'>Principal: {s.principalName}</div>
                            <div className='break-all text-sm text-slate-600'>
                              {s.principalEmail}
                              {s.phone ? ` · ${s.phone}` : ''}
                            </div>
                            <div className='text-xs text-slate-500'>Requested {fmtDate(s.createdAt)}</div>
                          </div>
                          {(s.status === 'approved' || s.status === 'suspended') && (
                            <div className='flex gap-4 text-center text-sm'>
                              <div>
                                <div className='font-bold text-slate-900'>{s.classes}</div>
                                <div className='text-xs text-slate-500'>Classes</div>
                              </div>
                              <div>
                                <div className='font-bold text-slate-900'>{s.teachers}</div>
                                <div className='text-xs text-slate-500'>Teachers</div>
                              </div>
                              <div>
                                <div className='font-bold text-slate-900'>{s.students}</div>
                                <div className='text-xs text-slate-500'>Students</div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className='mt-4 flex flex-wrap gap-2'>
                          {(s.status === 'pending' || s.status === 'rejected') && (
                            <Btn disabled={busy} onClick={() => setStatus(s, 'approved', 'approved')}>
                              <Check className='h-4 w-4' />
                              Approve
                            </Btn>
                          )}
                          {s.status === 'pending' && (
                            <Btn variant='secondary' disabled={busy} onClick={() => setStatus(s, 'rejected', 'request declined')}>
                              <X className='h-4 w-4' />
                              Decline
                            </Btn>
                          )}
                          {s.status === 'approved' && (
                            <Btn variant='secondary' disabled={busy} onClick={() => setStatus(s, 'suspended', 'paused')}>
                              <PauseCircle className='h-4 w-4' />
                              Pause school
                            </Btn>
                          )}
                          {s.status === 'suspended' && (
                            <Btn disabled={busy} onClick={() => setStatus(s, 'approved', 'reactivated')}>
                              <PlayCircle className='h-4 w-4' />
                              Reactivate
                            </Btn>
                          )}
                          {s.status === 'suspended' && (
                            <Btn variant='danger' disabled={busy || !!deleting} onClick={() => deleteSchool(s)}>
                              <Trash2 className='h-4 w-4' />
                              Delete school
                            </Btn>
                          )}
                          {(s.status === 'pending' || s.status === 'rejected') && (
                            <Btn variant='danger' disabled={busy} onClick={() => remove(s)}>
                              <Trash2 className='h-4 w-4' />
                              Remove request
                            </Btn>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

