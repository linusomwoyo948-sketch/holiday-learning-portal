import { useEffect, useState } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { api, errMsg, fmtDateTime, LETTERS, statusOf, type ExamQuestion, type StudentSession } from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type ResultData = {
  exam: {
    id: string;
    title: string;
    subject: string;
    teacherName: string;
    startAt: string;
    endAt: string;
    totalMarks: number;
    questions: ExamQuestion[];
  };
  answers: Record<string, string>;
  marks: Record<string, number>;
  submittedAt: string;
  autoSubmitted: boolean;
  score: number;
  totalMarks: number;
  pending: number;
  comment: string;
};

type Props = {
  session: StudentSession;
  examId: string;
  onBack: () => void;
  onExpired: () => void;
};

export default function StudentResult({ session, examId, onBack, onExpired }: Props) {
  const [data, setData] = useState<ResultData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.post(`/api/student/exams/${examId}/result`, { token: session.token });
        if (!cancelled) setData(r.data as ResultData);
      } catch (e) {
        if (cancelled) return;
        if (statusOf(e) === 401) {
          onExpired();
          return;
        }
        setErr(errMsg(e, 'Could not load your results. Please try again.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, session.token, onExpired]);

  const back = (
    <Btn variant='ghost' onClick={onBack}>
      <ArrowLeft className='h-4 w-4' />
      Back to my exams
    </Btn>
  );

  if (err) {
    return (
      <div className='space-y-3'>
        {back}
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!data) return <Spinner label='Loading your results…' />;

  const { exam } = data;
  const percent = data.totalMarks > 0 ? Math.round((data.score / data.totalMarks) * 100) : 0;

  return (
    <div className='space-y-4'>
      {back}
      <Card>
        <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>{exam.subject}</span>
        <h2 className='mt-2 break-words text-xl font-bold text-slate-900'>{exam.title}</h2>
        <p className='text-sm text-slate-600'>
          Set by {exam.teacherName} · {fmtDateTime(exam.startAt)}
        </p>
        <div className='mt-4 flex flex-wrap items-center gap-4 rounded-xl bg-emerald-50 p-4'>
          <div>
            <div className='text-sm font-medium text-emerald-800'>Your score</div>
            <div className='text-3xl font-bold text-emerald-900'>
              {data.score}
              <span className='text-lg font-medium text-emerald-700'> / {data.totalMarks}</span>
            </div>
          </div>
          <div className='text-2xl font-bold text-emerald-800'>{percent}%</div>
        </div>
        {data.pending > 0 && (
          <div className='mt-3'>
            <Alert kind='info'>
              Your teacher is still marking {data.pending} written answer{data.pending === 1 ? '' : 's'}. Your score
              may go up once marking is finished.
            </Alert>
          </div>
        )}
        {data.comment && (
          <div className='mt-3 rounded-lg border border-slate-200 p-3 text-sm'>
            <div className='font-semibold text-slate-700'>Teacher&apos;s comment</div>
            <p className='mt-1 whitespace-pre-wrap text-slate-700'>{data.comment}</p>
          </div>
        )}
      </Card>

      {exam.questions.map((q, i) => {
        const ans = data.answers[q.id];
        if (q.type === 'mcq') {
          const chosen = ans !== undefined && ans !== '' ? Number(ans) : -1;
          const right = chosen === q.correct;
          return (
            <Card key={q.id}>
              <div className='flex items-start justify-between gap-3'>
                <div className='text-sm font-bold text-slate-800'>Question {i + 1}</div>
                <div className={`text-sm font-semibold ${right ? 'text-emerald-700' : 'text-red-700'}`}>
                  {right ? q.marks : 0} / {q.marks}
                </div>
              </div>
              <p className='mt-1 whitespace-pre-wrap break-words text-slate-900'>{q.text}</p>
              <ul className='mt-3 space-y-1'>
                {q.options.map((o, j) => (
                  <li
                    key={j}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      j === q.correct
                        ? 'border-emerald-300 bg-emerald-50'
                        : j === chosen
                          ? 'border-red-300 bg-red-50'
                          : 'border-slate-200'
                    }`}
                  >
                    <span className='font-semibold'>{LETTERS[j]}.</span>
                    <span className='flex-1 break-words'>{o}</span>
                    {j === chosen && <span className='text-xs font-semibold text-slate-600'>Your answer</span>}
                    {j === q.correct && <Check className='h-4 w-4 text-emerald-700' />}
                    {j === chosen && j !== q.correct && <X className='h-4 w-4 text-red-700' />}
                  </li>
                ))}
              </ul>
              {chosen < 0 && <p className='mt-2 text-sm text-red-700'>You did not answer this question.</p>}
            </Card>
          );
        }
        const m = data.marks[q.id];
        return (
          <Card key={q.id}>
            <div className='flex items-start justify-between gap-3'>
              <div className='text-sm font-bold text-slate-800'>Question {i + 1}</div>
              <div className='text-sm font-semibold text-slate-700'>
                {typeof m === 'number' ? `${m} / ${q.marks}` : `Being marked · ${q.marks} marks`}
              </div>
            </div>
            <p className='mt-1 whitespace-pre-wrap break-words text-slate-900'>{q.text}</p>
            <div className='mt-3 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'>
              {ans ? ans : <span className='italic text-slate-400'>You did not answer this question.</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

