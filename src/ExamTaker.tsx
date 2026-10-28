import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock } from 'lucide-react';
import { api, errMsg, fmtCountdown, LETTERS, statusOf, type ExamQuestion, type StudentSession } from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';

type TakerExam = {
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  instructions: string;
  startAt: string;
  endAt: string;
  totalMarks: number;
  questions: ExamQuestion[];
};

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Answers are also kept on the phone, so a dropped connection or a closed page loses nothing.
function localKey(examId: string, adm: string): string {
  return `holiday-portal-answers-${examId}-${adm}`;
}

function readLocalAnswers(examId: string, adm: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(localKey(examId, adm));
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalAnswers(examId: string, adm: string, answers: Record<string, string>): void {
  try {
    window.localStorage.setItem(localKey(examId, adm), JSON.stringify(answers));
  } catch {
    // storage full or unavailable
  }
}

function clearLocalAnswers(examId: string, adm: string): void {
  try {
    window.localStorage.removeItem(localKey(examId, adm));
  } catch {
    // storage unavailable
  }
}
type Done = { auto: boolean };

type Props = {
  session: StudentSession;
  examId: string;
  onExit: () => void;
  onExpired: () => void;
};

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'Answers save automatically',
  pending: 'Saving soon…',
  saving: 'Saving…',
  saved: 'All answers saved',
  error: 'No connection. Answers are kept on this phone and will be sent when you reconnect',
};

export default function ExamTaker({ session, examId, onExit, onExpired }: Props) {
  const [exam, setExam] = useState<TakerExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loadErr, setLoadErr] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [done, setDone] = useState<Done | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');

  const answersRef = useRef<Record<string, string>>({});
  const dirtyRef = useRef(false);
  const doneRef = useRef(false);
  const submittingRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.post(`/api/student/exams/${examId}/start`, { token: session.token });
        if (cancelled) return;
        const server = (r.data?.answers || {}) as Record<string, string>;
        const local = readLocalAnswers(examId, session.admissionNo);
        const saved = { ...server, ...local };
        if (Object.keys(local).some((k) => local[k] !== server[k])) dirtyRef.current = true;
        answersRef.current = saved;
        setAnswers(saved);
        if (r.data?.serverNow) setOffset(Date.parse(r.data.serverNow) - Date.now());
        setExam(r.data.exam as TakerExam);
      } catch (e) {
        if (cancelled) return;
        if (statusOf(e) === 401) {
          onExpired();
          return;
        }
        setLoadErr(errMsg(e, 'Could not open the exam. Please try again.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, session.token, onExpired]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const send = useCallback(
    async (submit: boolean, auto: boolean): Promise<boolean> => {
      if (doneRef.current) return true;
      if (!submit) setSaveState('saving');
      dirtyRef.current = false;
      try {
        const r = await api.post(`/api/student/exams/${examId}/save`, {
          token: session.token,
          answers: answersRef.current,
          submit,
          auto,
        });
        if (r.data?.status === 'submitted') {
          doneRef.current = true;
          window.clearTimeout(saveTimer.current);
          setDone({ auto: Boolean(r.data.autoSubmitted) || auto });
          clearLocalAnswers(examId, session.admissionNo);
        } else {
          setSaveState(dirtyRef.current ? 'pending' : 'saved');
        }
        return true;
      } catch (e) {
        dirtyRef.current = true;
        if (statusOf(e) === 401) {
          onExpired();
          return false;
        }
        setSaveState('error');
        return false;
      }
    },
    [examId, session.token, onExpired],
  );

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (doneRef.current || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitErr('');
      window.clearTimeout(saveTimer.current);
      let ok = await send(true, auto);
      let tries = 0;
      while (!ok && auto && tries < 5 && !doneRef.current) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 4000));
        tries += 1;
        ok = await send(true, true);
      }
      if (!ok) {
        if (auto) {
          doneRef.current = true;
          setDone({ auto: true });
          setSubmitErr(
            'We could not reach the server when time ran out. Your answers saved up to that point will be submitted to your teacher automatically.',
          );
        } else {
          setSubmitErr('Could not submit. Check your connection and try again.');
        }
      }
      submittingRef.current = false;
      setSubmitting(false);
    },
    [send],
  );

  // Background save every 30 seconds if anything changed
  useEffect(() => {
    const t = window.setInterval(() => {
      if (dirtyRef.current && !doneRef.current && !submittingRef.current) send(false, false);
    }, 30000);
    return () => window.clearInterval(t);
  }, [send]);

  useEffect(() => {
    return () => window.clearTimeout(saveTimer.current);
  }, []);

  const remaining = exam ? Date.parse(exam.endAt) - (now + offset) : 1;

  // Submit automatically when the time is over
  useEffect(() => {
    if (exam && !done && remaining <= 0) doSubmit(true);
  }, [exam, done, remaining, doSubmit]);

  function setAnswer(qid: string, value: string) {
    if (doneRef.current || remaining <= 0) return;
    const next = { ...answersRef.current, [qid]: value };
    answersRef.current = next;
    writeLocalAnswers(examId, session.admissionNo, next);
    setAnswers(next);
    dirtyRef.current = true;
    setSaveState('pending');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      send(false, false);
    }, 2500);
  }

  function confirmSubmit() {
    if (!exam) return;
    const unanswered = exam.questions.filter((q) => !answersRef.current[q.id]).length;
    const message = unanswered
      ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway? You cannot change your answers after submitting.`
      : 'Submit your exam now? You cannot change your answers after submitting.';
    if (window.confirm(message)) doSubmit(false);
  }

  async function saveAndLeave() {
    window.clearTimeout(saveTimer.current);
    if (dirtyRef.current) await send(false, false);
    onExit();
  }

  if (loadErr) {
    return (
      <main className='mx-auto max-w-xl px-4 py-10'>
        <Card className='space-y-4'>
          <Alert>{loadErr}</Alert>
          <Btn variant='secondary' onClick={onExit}>
            <ArrowLeft className='h-4 w-4' />
            Back to my exams
          </Btn>
        </Card>
      </main>
    );
  }

  if (!exam) {
    return (
      <main className='mx-auto max-w-xl px-4 py-10'>
        <Spinner label='Opening your exam…' />
      </main>
    );
  }

  if (done) {
    return (
      <main className='mx-auto max-w-xl px-4 py-10'>
        <Card className='text-center'>
          <div className='mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'>
            <CheckCircle2 className='h-8 w-8' />
          </div>
          <h1 className='mt-3 text-xl font-bold text-slate-900'>Exam submitted</h1>
          <p className='mt-2 text-sm text-slate-600'>
            {done.auto
              ? 'Time ran out, so your exam was submitted automatically to your teacher.'
              : 'Your answers have been sent to your teacher.'}
          </p>
          <p className='mt-1 text-sm font-semibold text-slate-700'>{exam.title}</p>
          {submitErr && (
            <div className='mt-3 text-left'>
              <Alert kind='info'>{submitErr}</Alert>
            </div>
          )}
          <Btn className='mt-5' onClick={onExit}>
            Back to my exams
          </Btn>
        </Card>
      </main>
    );
  }

  const answeredCount = exam.questions.filter((q) => answers[q.id]).length;
  const lowTime = remaining < 5 * 60 * 1000;
  const timeUp = remaining <= 0;

  return (
    <div className='min-h-screen'>
      <div className='sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur'>
        <div className='mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3'>
          <div className='min-w-0'>
            <div className='truncate font-bold text-slate-900'>{exam.title}</div>
            <div className='truncate text-xs text-slate-500'>
              {answeredCount}/{exam.questions.length} answered · {SAVE_LABEL[saveState]}
            </div>
          </div>
          <div
            role='timer'
            aria-label='Time remaining'
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 font-mono text-lg font-bold ${
              lowTime ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            <Clock className='h-5 w-5' />
            {fmtCountdown(remaining)}
          </div>
        </div>
      </div>

      <main className='mx-auto max-w-3xl space-y-4 px-4 py-6'>
        {timeUp ? (
          <Alert kind='info'>Time is up. Submitting your exam…</Alert>
        ) : lowTime ? (
          <Alert kind='info'>Less than 5 minutes left. Your exam will submit itself when the timer reaches zero.</Alert>
        ) : null}

        <Card>
          <div className='flex flex-wrap items-start justify-between gap-2'>
            <div>
              <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
                {exam.subject}
              </span>
              <h1 className='mt-2 text-xl font-bold text-slate-900'>{exam.title}</h1>
              <p className='text-sm text-slate-600'>
                {session.name || session.admissionNo} · Adm. {session.admissionNo}
              </p>
            </div>
            <div className='text-sm text-slate-600'>{exam.totalMarks} marks</div>
          </div>
          {exam.instructions && (
            <p className='mt-3 whitespace-pre-wrap text-sm text-slate-700'>{exam.instructions}</p>
          )}
          <p className='mt-3 text-xs text-slate-500'>
            Your answers save automatically as you work. When the timer reaches zero, the exam is submitted to your
            teacher on its own.
          </p>
        </Card>

        {exam.questions.map((q, i) => (
          <Card key={q.id}>
            <div className='flex items-start justify-between gap-3'>
              <div className='text-sm font-bold text-emerald-800'>Question {i + 1}</div>
              <div className='text-xs text-slate-500'>
                {q.marks} mark{q.marks === 1 ? '' : 's'}
              </div>
            </div>
            <p className='mt-1 whitespace-pre-wrap break-words text-slate-900'>{q.text}</p>
            {q.type === 'mcq' ? (
              <div className='mt-3 space-y-2' role='radiogroup' aria-label={`Question ${i + 1} choices`}>
                {q.options.map((o, j) => {
                  const on = answers[q.id] === String(j);
                  return (
                    <button
                      key={j}
                      type='button'
                      role='radio'
                      aria-checked={on}
                      disabled={timeUp}
                      onClick={() => setAnswer(q.id, String(j))}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                        on
                          ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600'
                          : 'border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          on ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {LETTERS[j]}
                      </span>
                      <span className='break-words pt-0.5'>{o}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                rows={6}
                aria-label={`Answer to question ${i + 1}`}
                className={`${inputCls} mt-3`}
                value={answers[q.id] || ''}
                placeholder='Type your answer here'
                disabled={timeUp}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </Card>
        ))}

        {submitErr && <Alert>{submitErr}</Alert>}

        <div className='flex flex-col gap-2 sm:flex-row'>
          <Btn onClick={confirmSubmit} disabled={submitting || timeUp} className='flex-1 py-3'>
            {submitting ? 'Submitting…' : 'Submit exam'}
          </Btn>
          <Btn variant='secondary' onClick={saveAndLeave} disabled={submitting} className='py-3'>
            <ArrowLeft className='h-4 w-4' />
            Save and leave
          </Btn>
        </div>
        <p className='text-center text-xs text-slate-500'>
          If you leave, the timer keeps running. You can come back and continue until the finish time.
        </p>
      </main>
    </div>
  );
}

