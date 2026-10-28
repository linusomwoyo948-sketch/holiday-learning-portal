import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CalendarClock, CheckCircle2, Clock, PlayCircle, RefreshCw, XCircle } from 'lucide-react';
import {
  api,
  errMsg,
  fmtCountdown,
  fmtDateTime,
  fmtTime,
  phaseAt,
  statusOf,
  type StudentExam,
  type StudentSession,
} from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type ResultSummary = { score: number; totalMarks: number; pending: number; comment: string };
type ExamItem = StudentExam & { resultsAt: string; result: ResultSummary | null };

type Props = {
  session: StudentSession;
  onStart: (examId: string) => void;
  onReview: (examId: string) => void;
  onExpired: () => void;
};

export default function StudentExams({ session, onStart, onReview, onExpired }: Props) {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const reloadedFor = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/student/exams', { token: session.token });
      setExams((r.data?.exams || []) as ExamItem[]);
      if (r.data?.serverNow) setOffset(Date.parse(r.data.serverNow) - Date.now());
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load your exams. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const serverNow = now + offset;

  // When a taken exam's results become available, fetch them once
  useEffect(() => {
    const due = exams.find(
      (e) => e.submission && !e.result && serverNow >= Date.parse(e.resultsAt) + 2000 && !reloadedFor.current.has(e.id),
    );
    if (due && !loading) {
      reloadedFor.current.add(due.id);
      load();
    }
  }, [exams, serverNow, loading, load]);

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      {err && <Alert>{err}</Alert>}
      {loading && exams.length === 0 ? (
        <Spinner label='Loading your exams…' />
      ) : exams.length === 0 ? (
        <Card className='text-center'>
          <CalendarClock className='mx-auto h-8 w-8 text-slate-400' />
          <p className='mt-2 font-semibold text-slate-700'>No exams yet</p>
          <p className='text-sm text-slate-500'>When your teachers set an exam for your class, it will appear here.</p>
        </Card>
      ) : (
        exams.map((e) => {
          const phase = phaseAt(e, serverNow);
          const done = e.submission?.status === 'submitted';
          const started = e.submission?.status === 'in_progress';
          const resultsIn = Date.parse(e.resultsAt) - serverNow;
          return (
            <Card key={e.id}>
              <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
                {e.subject}
              </span>
              <h3 className='mt-2 break-words text-lg font-bold text-slate-900'>{e.title}</h3>
              <p className='text-xs text-slate-500'>
                Set by {e.teacherName} · {e.questionCount} question{e.questionCount === 1 ? '' : 's'} ·{' '}
                {e.totalMarks} marks
              </p>
              <p className='mt-1 flex items-center gap-1 text-sm text-slate-600'>
                <CalendarClock className='h-4 w-4 shrink-0' />
                {fmtDateTime(e.startAt)} to {fmtTime(e.endAt)}
              </p>
              {e.instructions && phase !== 'closed' && !done && (
                <p className='mt-2 whitespace-pre-wrap text-sm text-slate-700'>{e.instructions}</p>
              )}
              <div className='mt-4 space-y-2'>
                {e.result ? (
                  <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3'>
                    <div className='flex items-center gap-3'>
                      <Award className='h-7 w-7 shrink-0 text-emerald-700' />
                      <div>
                        <div className='text-xs font-medium text-emerald-800'>Your score</div>
                        <div className='text-2xl font-bold text-emerald-900'>
                          {e.result.score}
                          <span className='text-base font-medium text-emerald-700'> / {e.result.totalMarks}</span>
                        </div>
                        {e.result.pending > 0 && (
                          <div className='text-xs text-amber-800'>
                            {e.result.pending} written answer{e.result.pending === 1 ? '' : 's'} still being marked
                          </div>
                        )}
                      </div>
                    </div>
                    <Btn variant='secondary' onClick={() => onReview(e.id)}>
                      View my answers
                    </Btn>
                  </div>
                ) : done || (started && phase === 'closed') ? (
                  <>
                    <div className='flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800'>
                      <CheckCircle2 className='h-5 w-5 shrink-0' />
                      {e.submission?.autoSubmitted || !done
                        ? 'Submitted automatically when time ran out'
                        : `Submitted${e.submission?.submittedAt ? ` at ${fmtTime(e.submission.submittedAt)}` : ''}`}
                    </div>
                    <div className='flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800'>
                      <Clock className='h-4 w-4 shrink-0' />
                      {resultsIn > 0
                        ? `Your score will show here in ${fmtCountdown(resultsIn)}, after the exam closes.`
                        : 'Getting your score…'}
                    </div>
                  </>
                ) : phase === 'upcoming' ? (
                  <div className='flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800'>
                    <Clock className='h-5 w-5 shrink-0' />
                    Opens in {fmtCountdown(Date.parse(e.startAt) - serverNow)}
                  </div>
                ) : phase === 'open' ? (
                  <div className='flex flex-wrap items-center gap-3'>
                    <Btn onClick={() => onStart(e.id)}>
                      <PlayCircle className='h-4 w-4' />
                      {started ? 'Continue exam' : 'Start exam'}
                    </Btn>
                    <span className='text-sm font-semibold text-red-700'>
                      Closes in {fmtCountdown(Date.parse(e.endAt) - serverNow)}
                    </span>
                  </div>
                ) : (
                  <div className='flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600'>
                    <XCircle className='h-5 w-5 shrink-0' />
                    Missed. This exam has closed.
                  </div>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

