import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { api, errMsg, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, labelCls } from './ui';

type Props = {
  schoolName: string;
  streams: Stream[];
  onSchoolNameChange: (name: string) => void;
  onChanged: () => void;
};

type StreamSummary = {
  id: string;
  name: string;
  students: number;
  teachers: string[];
};

export default function SchoolSetup({ schoolName, streams, onSchoolNameChange, onChanged }: Props) {
  const [list, setList] = useState<Stream[]>(streams);
  const [summary, setSummary] = useState<Record<string, StreamSummary>>({});
  const [total, setTotal] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryErr, setSummaryErr] = useState('');
  const [nameInput, setNameInput] = useState(schoolName);
  const [nameMsg, setNameMsg] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [streamName, setStreamName] = useState('');
  const [streamErr, setStreamErr] = useState('');
  const [streamMsg, setStreamMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setList(streams);
  }, [streams]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryErr('');
    try {
      const r = await api.get('/api/admin/stream-summary');
      const rows = (r.data?.summary || []) as StreamSummary[];
      const map: Record<string, StreamSummary> = {};
      rows.forEach((row) => {
        map[row.id] = row;
      });
      setSummary(map);
      setTotal(Number(r.data?.totalStudents || 0));
    } catch (ex) {
      setSummaryErr(errMsg(ex, 'Could not load student numbers.'));
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameErr('');
    setNameMsg('');
    setSavingName(true);
    try {
      const r = await api.post('/api/admin/settings', { schoolName: nameInput });
      onSchoolNameChange(r.data?.schoolName || '');
      setNameMsg('School name saved.');
    } catch (ex) {
      setNameErr(errMsg(ex, 'Could not save the school name.'));
    } finally {
      setSavingName(false);
    }
  }

  async function addStream(e: FormEvent) {
    e.preventDefault();
    setStreamErr('');
    setStreamMsg('');
    const name = streamName.trim();
    if (!name) {
      setStreamErr('Enter a class / stream name.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/api/admin/streams', { name });
      if (Array.isArray(r.data?.streams)) setList(r.data.streams as Stream[]);
      setStreamName('');
      setStreamMsg(`${name} added. Students can now choose it when they sign in.`);
      onChanged();
      loadSummary();
    } catch (ex) {
      setStreamErr(errMsg(ex, 'Could not add the class. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeStream(s: Stream) {
    const count = summary[s.id]?.students || 0;
    const warning = count
      ? ` It has ${count} student${count === 1 ? '' : 's'} who will not be able to sign in until they are added to another class.`
      : '';
    if (!window.confirm(`Delete ${s.name}?${warning}`)) return;
    setStreamErr('');
    setStreamMsg('');
    setBusy(true);
    try {
      const r = await api.delete(`/api/admin/streams/${s.id}`);
      if (Array.isArray(r.data?.streams)) setList(r.data.streams as Stream[]);
      else setList((prev) => prev.filter((x) => x.id !== s.id));
      setStreamMsg(`${s.name} deleted.`);
      onChanged();
      loadSummary();
    } catch (ex) {
      setStreamErr(errMsg(ex, 'Could not delete the class.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-6'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <Card className='flex items-center gap-4'>
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700'>
            <Users className='h-6 w-6' />
          </div>
          <div>
            <div className='text-sm text-slate-500'>Students registered</div>
            <div className='text-2xl font-bold text-slate-900'>{summaryLoading ? '…' : total}</div>
          </div>
        </Card>
        <Card className='flex items-center gap-4'>
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700'>
            <Users className='h-6 w-6' />
          </div>
          <div>
            <div className='text-sm text-slate-500'>Classes / streams</div>
            <div className='text-2xl font-bold text-slate-900'>{list.length}</div>
          </div>
        </Card>
      </div>

      <div className='grid gap-6 lg:grid-cols-5'>
        <Card className='lg:col-span-3'>
          <div className='flex flex-wrap items-start justify-between gap-2'>
            <div>
              <h2 className='text-lg font-bold text-slate-900'>Classes / streams</h2>
              <p className='mt-1 text-sm text-slate-600'>
                Number of students each teacher has added, and the teachers assigned to each class.
              </p>
            </div>
            <Btn variant='ghost' onClick={loadSummary} disabled={summaryLoading}>
              <RefreshCw className={`h-4 w-4 ${summaryLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Btn>
          </div>
          <form onSubmit={addStream} noValidate className='mt-4 flex gap-2'>
            <input
              aria-label='New class or stream name'
              className={inputCls}
              value={streamName}
              placeholder='e.g. Grade 8 Blue or Form 3 East'
              onChange={(e) => setStreamName(e.target.value)}
            />
            <Btn type='submit' disabled={busy} className='shrink-0'>
              <Plus className='h-4 w-4' />
              {busy ? 'Saving…' : 'Add class'}
            </Btn>
          </form>
          {streamErr && (
            <div className='mt-3'>
              <Alert>{streamErr}</Alert>
            </div>
          )}
          {streamMsg && (
            <div className='mt-3'>
              <Alert kind='success'>{streamMsg}</Alert>
            </div>
          )}
          {summaryErr && (
            <div className='mt-3'>
              <Alert>{summaryErr}</Alert>
            </div>
          )}
          {list.length === 0 ? (
            <p className='mt-4 text-sm text-slate-500'>No classes yet. Add your first class above.</p>
          ) : (
            <ul className='mt-4 divide-y divide-slate-100'>
              {list.map((s) => {
                const info = summary[s.id];
                const count = info?.students ?? 0;
                return (
                  <li key={s.id} className='flex items-center justify-between gap-3 py-3'>
                    <div className='min-w-0'>
                      <div className='text-sm font-semibold text-slate-800'>{s.name}</div>
                      <div className='text-xs text-slate-500'>
                        {info && info.teachers.length
                          ? `Teacher${info.teachers.length === 1 ? '' : 's'}: ${info.teachers.join(', ')}`
                          : 'No teacher assigned yet'}
                      </div>
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span className='rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800'>
                        {summaryLoading && !info ? '…' : `${count} student${count === 1 ? '' : 's'}`}
                      </span>
                      <Btn
                        variant='ghost'
                        disabled={busy}
                        onClick={() => removeStream(s)}
                        aria-label={`Delete ${s.name}`}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Btn>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className='lg:col-span-2'>
          <h2 className='text-lg font-bold text-slate-900'>School name</h2>
          <form onSubmit={saveName} noValidate className='mt-4 space-y-3'>
            <div>
              <label htmlFor='school-name' className={labelCls}>
                School name (teachers and students type this to find your school)
              </label>
              <input
                id='school-name'
                className={inputCls}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
            </div>
            {nameErr && <Alert>{nameErr}</Alert>}
            {nameMsg && <Alert kind='success'>{nameMsg}</Alert>}
            <Btn type='submit' disabled={savingName}>
              {savingName ? 'Saving…' : 'Save name'}
            </Btn>
          </form>
        </Card>
      </div>
    </div>
  );
}

