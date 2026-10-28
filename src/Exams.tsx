import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, ClipboardList, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  api,
  errMsg,
  fmtDateTime,
  fmtTime,
  type ExamDetail,
  type ExamPhase,
  type Stream,
  type TeacherExamSummary,
} from './lib';
import { Alert, Btn, Card, Spinner } from './ui';
import ExamBuilder from './ExamBuilder';
import ExamResults from './ExamResults';

type Props = {
  myStreams: Stream[];
  allStreams: Stream[];
  defaultSubject: string;
};

const PHASE: Record<ExamPhase, { label: string; cls: string }> = {
  upcoming: { label: 'Scheduled', cls: 'bg-sky-50 text-sky-800' },
  open: { label: 'Open now', cls: 'bg-emerald-100 text-emerald-800' },
  closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-600' },
};

export default function Exams({ myStreams, allStreams, defaultSubject }: Props) {
  const [mode, setMode] = useState<'list' | 'create' | 'results' | 'edit'>('list');
  const [selectedId, setSelectedId] = useState('');
  const [exams, setExams] = useState<TeacherExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const streamNames: Record<string, string> = {};
  allStreams.forEach((s) => {
    streamNames[s.id] = s.name;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/teacher/exams');
      setExams((r.data?.exams || []) as TeacherExamSummary[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load your exams.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'list') load();
  }, [mode, load]);

  async function remove(e: TeacherExamSummary) {
    const extra = e.submitted ? ` The work of ${e.submitted} student${e.submitted === 1 ? '' : 's'} will also be deleted.` : '';
    if (!window.confirm(`Delete the exam “${e.title}”?${extra}`)) return;
    setDeletingId(e.id);
    setErr('');
    try {
      await api.delete(`/api/teacher/exams/${e.id}`);
      setExams((prev) => prev.filter((x) => x.id !== e.id));
    } catch (ex) {
      setErr(errMsg(ex, 'Could not delete the exam.'));
    } finally {
      setDeletingId('');
    }
  }

  if (mode === 'create') {
    return (
      <ExamBuilder
        myStreams={myStreams}
        defaultSubject={defaultSubject}
        onCancel={() => setMode('list')}
        onCreated={(title) => {
          setNotice(`“${title}” has been scheduled. Students in the selected classes can see it in their Exams tab.`);
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'edit' && selectedId) {
    return (
      <ExamEditLoader
        examId={selectedId}
        myStreams={myStreams}
        defaultSubject={defaultSubject}
        onDone={(title) => {
          setNotice(title ? `Changes to “${title}” have been saved.` : '');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'results' && selectedId) {
    return <ExamResults examId={selectedId} streamNames={streamNames} onBack={() => setMode('list')} />;
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-slate-900'>Online exams</h2>
          <p className='text-sm text-slate-600'>
            Set an exam with a date, start time and finish time. It opens and closes on its own.
          </p>
        </div>
        <div className='flex gap-2'>
          <Btn variant='ghost' onClick={load} disabled={loading}>
            <RefreshCw className='h-4 w-4' />
            Refresh
          </Btn>
          {myStreams.length > 0 && (
            <Btn
              onClick={() => {
                setNotice('');
                setMode('create');
              }}
            >
              <Plus className='h-4 w-4' />
              Create exam
            </Btn>
          )}
        </div>
      </div>
      {myStreams.length === 0 && (
        <Alert kind='info'>
          You have not been assigned any class yet. Ask the principal to assign your classes before creating an exam.
        </Alert>
      )}
      {notice && <Alert kind='success'>{notice}</Alert>}
      {err && <Alert>{err}</Alert>}
      {loading && exams.length === 0 ? (
        <Spinner />
      ) : exams.length === 0 ? (
        <Card className='text-sm text-slate-500'>No exams yet. Click Create exam to set your first one.</Card>
      ) : (
        exams.map((e) => (
          <Card key={e.id}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
                    {e.subject}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PHASE[e.phase].cls}`}>
                    {PHASE[e.phase].label}
                  </span>
                </div>
                <h3 className='mt-2 break-words text-lg font-bold text-slate-900'>{e.title}</h3>
                <p className='mt-1 flex items-center gap-1 text-sm text-slate-600'>
                  <CalendarClock className='h-4 w-4 shrink-0' />
                  {fmtDateTime(e.startAt)} to {fmtTime(e.endAt)}
                </p>
                <p className='text-xs text-slate-500'>
                  {e.questionCount} question{e.questionCount === 1 ? '' : 's'} · {e.totalMarks} marks · For{' '}
                  {e.streamIds.map((id) => streamNames[id] || 'removed class').join(', ')}
                </p>
              </div>
              <div className='text-right text-sm'>
                <div className='font-semibold text-slate-800'>{e.submitted} submitted</div>
                {e.writing > 0 && <div className='text-emerald-700'>{e.writing} writing now</div>}
              </div>
            </div>
            <div className='mt-4 flex flex-wrap gap-2'>
              <Btn
                onClick={() => {
                  setSelectedId(e.id);
                  setMode('results');
                }}
              >
                <ClipboardList className='h-4 w-4' />
                View students' work
              </Btn>
              <Btn
                variant='secondary'
                onClick={() => {
                  setNotice('');
                  setSelectedId(e.id);
                  setMode('edit');
                }}
              >
                <Pencil className='h-4 w-4' />
                Edit
              </Btn>
              <Btn variant='danger' disabled={deletingId === e.id} onClick={() => remove(e)}>
                <Trash2 className='h-4 w-4' />
                Delete
              </Btn>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function ExamEditLoader({
  examId,
  myStreams,
  defaultSubject,
  onDone,
}: {
  examId: string;
  myStreams: Stream[];
  defaultSubject: string;
  onDone: (title: string) => void;
}) {
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [phase, setPhase] = useState<ExamPhase>('upcoming');
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/teacher/exams/${examId}`)
      .then((r) => {
        if (cancelled) return;
        setPhase((r.data?.phase || 'upcoming') as ExamPhase);
        setExam(r.data.exam as ExamDetail);
      })
      .catch((e) => {
        if (!cancelled) setErr(errMsg(e, 'Could not open the exam.'));
      });
    return () => {
      cancelled = true;
    };
  }, [examId]);

  if (err) {
    return (
      <div className='space-y-3'>
        <Btn variant='ghost' onClick={() => onDone('')}>
          <ArrowLeft className='h-4 w-4' />
          Back to exams
        </Btn>
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!exam) return <Spinner label='Opening the exam…' />;
  return (
    <ExamBuilder
      myStreams={myStreams}
      defaultSubject={defaultSubject}
      initial={exam}
      phase={phase}
      onCancel={() => onDone('')}
      onCreated={(title) => onDone(title)}
    />
  );
}

