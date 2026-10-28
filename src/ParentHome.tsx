import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, LogOut, Paperclip, XCircle } from 'lucide-react';
import { api, errMsg, fmtDateTime, statusOf, type StudentSession } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner, TopBar } from './ui';
import ReportCard from './ReportCard';
import StudentNotices from './StudentNotices';
import { useSiteName } from './site';

type Tab = 'report' | 'assignments' | 'exams' | 'notices';
type Check = 'done' | 'not_done' | 'none';
type FileInfo = { path: string; name: string; size: number; url?: string };

type AssignmentItem = {
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  dueAt: string;
  totalMarks: number;
  submissionMode: 'portal' | 'paper';
  status: 'not_submitted' | 'submitted' | 'marked';
  marks: number | null;
  late: boolean;
  parentCheck: Check;
  parentNote: string;
  parentCheckedAt: string;
};

type AssignmentDetail = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  teacherName: string;
  dueAt: string;
  totalMarks: number;
  attachment: FileInfo | null;
  submissionMode: 'portal' | 'paper';
};

type ChildSub = {
  answer: string;
  attachment: FileInfo | null;
  submittedAt: string;
  late: boolean;
  marks: number | null;
  feedback: string;
};

type ExamItem = {
  id: string;
  title: string;
  subject: string;
  startAt: string;
  endAt: string;
  totalMarks: number;
  result: { score: number; totalMarks: number; pending: number } | null;
  submission: { status: string } | null;
};

function badge(text: string, cls: string) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>;
}

function FileLink({ file, label }: { file: FileInfo; label: string }) {
  if (!file.url) return null;
  return (
    <a
      href={file.url}
      target='_blank'
      rel='noreferrer'
      className='inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100'
    >
      <Paperclip className='h-4 w-4 shrink-0' />
      <span className='truncate'>
        {label}: {file.name}
      </span>
    </a>
  );
}

function workBadge(a: AssignmentItem) {
  if (a.submissionMode === 'paper') return badge('Handed in on paper', 'bg-slate-100 text-slate-700');
  if (a.status === 'marked') {
    return badge(`Marked: ${a.marks}${a.totalMarks ? `/${a.totalMarks}` : ''}`, 'bg-emerald-100 text-emerald-800');
  }
  if (a.status === 'submitted') return badge(a.late ? 'Handed in late' : 'Handed in', 'bg-sky-50 text-sky-800');
  if (a.dueAt && Date.parse(a.dueAt) < Date.now()) return badge('Overdue', 'bg-red-50 text-red-700');
  return badge('Not handed in yet', 'bg-amber-100 text-amber-900');
}

function checkBadge(c: Check) {
  if (c === 'done') return badge('You confirmed: done', 'bg-emerald-100 text-emerald-800');
  if (c === 'not_done') return badge('You said: not done yet', 'bg-red-50 text-red-700');
  return badge('Waiting for your check', 'bg-amber-100 text-amber-900');
}

function AssignmentCheck({
  session,
  item,
  onBack,
  onSaved,
  onExpired,
}: {
  session: StudentSession;
  item: AssignmentItem;
  onBack: () => void;
  onSaved: (patch: Partial<AssignmentItem>) => void;
  onExpired: () => void;
}) {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [sub, setSub] = useState<ChildSub | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState(item.parentNote || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .post(`/api/student/assignments/${encodeURIComponent(item.id)}`, { token: session.token })
      .then((r) => {
        if (cancelled) return;
        setDetail(r.data.assignment as AssignmentDetail);
        setSub((r.data.submission || null) as ChildSub | null);
      })
      .catch((e) => {
        if (statusOf(e) === 401) onExpired();
        else if (!cancelled) setErr(errMsg(e, 'Could not open this assignment.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, session.token, onExpired]);

  async function save(done: boolean) {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.post(`/api/parent/assignments/${encodeURIComponent(item.id)}/check`, {
        token: session.token,
        done,
        note: note.trim(),
      });
      onSaved({
        parentCheck: r.data.parentCheck as Check,
        parentNote: String(r.data.parentNote || ''),
        parentCheckedAt: String(r.data.parentCheckedAt || ''),
      });
      setMsg(
        done
          ? 'Thank you. The teacher can now see that you confirmed this work is done.'
          : 'Saved. The teacher can see that the work is not done yet. You can change this once your child finishes.',
      );
    } catch (e) {
      if (statusOf(e) === 401) onExpired();
      else setErr(errMsg(e, 'Could not save your check.'));
    } finally {
      setBusy(false);
    }
  }

  const paper = item.submissionMode === 'paper';

  return (
    <div className='space-y-4'>
      <Btn variant='ghost' onClick={onBack}>
        <ArrowLeft className='h-4 w-4' />
        Back to assignments
      </Btn>
      {loading ? (
        <Spinner />
      ) : (
        <>
          {detail && (
            <Card>
              <div className='flex flex-wrap items-center gap-2'>
                {badge(detail.subject, 'bg-amber-100 text-amber-900')}
                {workBadge(item)}
              </div>
              <h2 className='mt-2 break-words text-xl font-bold text-slate-900'>{detail.title}</h2>
              <p className='text-sm text-slate-600'>
                {detail.teacherName} ·{' '}
                {paper ? 'To be handed in on paper on opening day' : detail.dueAt ? `Due ${fmtDateTime(detail.dueAt)}` : 'No due date'}
              </p>
              {detail.instructions && (
                <p className='mt-3 whitespace-pre-wrap break-words text-sm text-slate-700'>{detail.instructions}</p>
              )}
              {detail.attachment && (
                <div className='mt-3'>
                  <FileLink file={detail.attachment} label='Assignment file' />
                </div>
              )}
            </Card>
          )}

          {!paper && (
            <Card>
              <h3 className='font-bold text-slate-900'>What your child handed in</h3>
              {sub ? (
                <div className='mt-2 space-y-3'>
                  <p className='text-xs text-slate-500'>
                    Handed in {fmtDateTime(sub.submittedAt)}
                    {sub.late ? ' (late)' : ''}
                  </p>
                  <div className='whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'>
                    {sub.answer || <span className='italic text-slate-400'>No typed answer</span>}
                  </div>
                  {sub.attachment && <FileLink file={sub.attachment} label='Attached work' />}
                  {typeof sub.marks === 'number' && (
                    <p className='text-sm text-slate-700'>
                      <span className='font-semibold'>Marks:</span> {sub.marks}
                      {item.totalMarks ? ` / ${item.totalMarks}` : ''}
                      {sub.feedback ? ` · Teacher’s feedback: ${sub.feedback}` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p className='mt-2 text-sm text-slate-500'>Your child has not handed in this assignment on the portal yet.</p>
              )}
            </Card>
          )}

          <Card>
            <h3 className='font-bold text-slate-900'>Your check</h3>
            <p className='mt-1 text-sm text-slate-600'>
              {paper
                ? 'This work is done on paper at home. Look through your child’s exercise book and confirm whether it is complete.'
                : 'Look at what your child handed in above and confirm whether the assignment is done.'}
            </p>
            <div className='mt-2'>{checkBadge(item.parentCheck)}</div>
            <div className='mt-3'>
              <label htmlFor='parent-note' className={labelCls}>
                Note to the teacher (optional)
              </label>
              <textarea
                id='parent-note'
                rows={3}
                maxLength={1000}
                className={inputCls}
                placeholder='For example, the reason it is late, or where your child needed help'
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {err && (
              <div className='mt-3'>
                <Alert>{err}</Alert>
              </div>
            )}
            {msg && (
              <div className='mt-3'>
                <Alert kind='success'>{msg}</Alert>
              </div>
            )}
            <div className='mt-3 flex flex-wrap gap-2'>
              <Btn onClick={() => save(true)} disabled={busy}>
                <CheckCircle2 className='h-4 w-4' />
                Yes, my child has done it
              </Btn>
              <Btn variant='secondary' onClick={() => save(false)} disabled={busy}>
                <XCircle className='h-4 w-4' />
                Not done yet
              </Btn>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ParentAssignments({ session, onExpired }: { session: StudentSession; onExpired: () => void }) {
  const [items, setItems] = useState<AssignmentItem[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api.post('/api/student/assignments', { token: session.token });
      setItems((r.data?.assignments || []) as AssignmentItem[]);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load the assignments.'));
      setItems([]);
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  if (items === null) return <Spinner />;

  const open = items.find((a) => a.id === openId);
  if (open) {
    return (
      <AssignmentCheck
        session={session}
        item={open}
        onBack={() => setOpenId('')}
        onExpired={onExpired}
        onSaved={(patch) => setItems((prev) => (prev || []).map((a) => (a.id === open.id ? { ...a, ...patch } : a)))}
      />
    );
  }

  const waiting = items.filter((a) => a.parentCheck !== 'done');

  return (
    <div className='space-y-3'>
      {err && <Alert>{err}</Alert>}
      {items.length > 0 && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            waiting.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
          }`}
        >
          {waiting.length
            ? `${waiting.length} assignment${waiting.length === 1 ? ' needs' : 's need'} your check. Open each one, look at your child’s work, and confirm whether it is done. The teacher sees your answer.`
            : 'You have confirmed every assignment. Thank you for following your child’s work.'}
        </div>
      )}
      {items.length === 0 ? (
        <Card className='text-sm text-slate-500'>No assignments yet.</Card>
      ) : (
        items.map((a) => (
          <Card key={a.id}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='font-bold text-slate-900'>{a.title}</div>
                <div className='text-xs text-slate-500'>
                  {a.subject} · {a.teacherName} ·{' '}
                  {a.submissionMode === 'paper'
                    ? 'Handed in on paper on opening day'
                    : a.dueAt
                      ? `Due ${fmtDateTime(a.dueAt)}`
                      : 'No due date'}
                </div>
                <div className='mt-2 flex flex-wrap gap-2'>
                  {workBadge(a)}
                  {checkBadge(a.parentCheck)}
                </div>
              </div>
              <Btn variant={a.parentCheck === 'done' ? 'secondary' : 'primary'} onClick={() => setOpenId(a.id)}>
                {a.parentCheck === 'none' ? 'Check this work' : 'Open'}
              </Btn>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function ParentExams({ session, onExpired }: { session: StudentSession; onExpired: () => void }) {
  const [items, setItems] = useState<ExamItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api
      .post('/api/student/exams', { token: session.token })
      .then((r) => {
        if (!cancelled) setItems((r.data?.exams || []) as ExamItem[]);
      })
      .catch((e) => {
        if (statusOf(e) === 401) onExpired();
        else if (!cancelled) {
          setErr(errMsg(e, 'Could not load the exams.'));
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.token, onExpired]);

  if (items === null) return <Spinner />;
  const now = Date.now();
  return (
    <div className='space-y-3'>
      {err && <Alert>{err}</Alert>}
      {items.length === 0 ? (
        <Card className='text-sm text-slate-500'>No exams yet.</Card>
      ) : (
        items.map((e) => {
          let status;
          if (e.result) {
            status = badge(
              `Score ${e.result.score}/${e.result.totalMarks}${e.result.pending ? ' (still being marked)' : ''}`,
              'bg-emerald-100 text-emerald-800',
            );
          } else if (Date.parse(e.startAt) > now) status = badge('Coming up', 'bg-sky-50 text-sky-800');
          else if (Date.parse(e.endAt) > now) status = badge(e.submission ? 'Writing now' : 'Open now', 'bg-amber-100 text-amber-900');
          else if (e.submission) status = badge('Sat, score coming soon', 'bg-sky-50 text-sky-800');
          else status = badge('Did not sit', 'bg-red-50 text-red-700');
          return (
            <Card key={e.id}>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='font-bold text-slate-900'>{e.title}</div>
                  <div className='text-xs text-slate-500'>
                    {e.subject} · {fmtDateTime(e.startAt)}
                  </div>
                </div>
                {status}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

export default function ParentHome({ session, onSignOut }: { session: StudentSession; onSignOut: () => void }) {
  const siteName = useSiteName();
  const [tab, setTab] = useState<Tab>('assignments');

  function signOut() {
    api.post('/api/student/logout', { token: session.token }).catch(() => undefined);
    onSignOut();
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'assignments', label: 'Assignments' },
    { key: 'report', label: 'Report card' },
    { key: 'exams', label: 'Exams' },
    { key: 'notices', label: 'Notices' },
  ];

  return (
    <div className='min-h-screen'>
      <TopBar
        title={session.schoolName || siteName}
        subtitle={`Parent view · ${session.name || session.admissionNo} · ${session.streamName}`}
        right={
          <Btn variant='secondary' onClick={signOut}>
            <LogOut className='h-4 w-4' />
            Sign out
          </Btn>
        }
      />
      <main className='mx-auto max-w-5xl px-4 py-6'>
        <div className='flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900'>
          <Eye className='mt-0.5 h-4 w-4 shrink-0' />
          You are following {session.name || 'your child'}’s work. Please check each assignment and confirm whether it
          is done. You cannot submit work or change marks.
        </div>
        <nav className='mb-6 mt-4 flex gap-1 overflow-x-auto border-b border-slate-200'>
          {tabs.map((t) => (
            <button
              key={t.key}
              type='button'
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
                tab === t.key ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'report' && <ReportCard session={session} onExpired={onSignOut} />}
        {tab === 'assignments' && <ParentAssignments session={session} onExpired={onSignOut} />}
        {tab === 'exams' && <ParentExams session={session} onExpired={onSignOut} />}
        {tab === 'notices' && <StudentNotices session={session} onExpired={onSignOut} />}
      </main>
    </div>
  );
}

