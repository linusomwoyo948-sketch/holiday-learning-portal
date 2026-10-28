import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Circle, ListChecks, PenLine, Trash2, X } from 'lucide-react';
import { api, errMsg, LETTERS, type ExamDetail, type ExamPhase, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, StreamPicker } from './ui';
import QuestionBankPanel, { type PlainQuestion } from './QuestionBankPanel';

type QType = 'mcq' | 'written';

type DraftQuestion = {
  key: number;
  type: QType;
  text: string;
  marks: string;
  options: string[];
  correct: number;
};

type Props = {
  myStreams: Stream[];
  defaultSubject: string;
  onCancel: () => void;
  onCreated: (title: string) => void;
  initial?: ExamDetail;
  phase?: ExamPhase;
};

let keyCounter = 0;

function newQuestion(type: QType): DraftQuestion {
  keyCounter += 1;
  return {
    key: keyCounter,
    type,
    text: '',
    marks: type === 'mcq' ? '1' : '5',
    options: type === 'mcq' ? ['', '', '', ''] : [],
    correct: -1,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftsFrom(exam: ExamDetail): DraftQuestion[] {
  return exam.questions.map((q) => {
    keyCounter += 1;
    return {
      key: keyCounter,
      type: q.type,
      text: q.text,
      marks: String(q.marks),
      options: q.type === 'mcq' ? [...q.options] : [],
      correct: typeof q.correct === 'number' ? q.correct : -1,
    };
  });
}

export default function ExamBuilder({ myStreams, defaultSubject, onCancel, onCreated, initial, phase }: Props) {
  const editing = !!initial;
  const locked = editing && phase !== 'upcoming';
  const endEditable = !editing || phase !== 'closed';
  const startD = initial ? new Date(initial.startAt) : null;
  const endD = initial ? new Date(initial.endAt) : null;

  const [title, setTitle] = useState(initial ? initial.title : '');
  const [subject, setSubject] = useState(initial ? initial.subject : defaultSubject);
  const [streamIds, setStreamIds] = useState<string[]>(
    initial ? initial.streamIds : myStreams.length === 1 ? [myStreams[0].id] : [],
  );
  const [instructions, setInstructions] = useState(initial ? initial.instructions || '' : '');
  const [date, setDate] = useState(startD ? localDate(startD) : localDate(new Date()));
  const [start, setStart] = useState(startD ? localTime(startD) : '09:00');
  const [end, setEnd] = useState(endD ? localTime(endD) : '10:00');
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    initial ? draftsFrom(initial) : [newQuestion('mcq')],
  );
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const startDate = new Date(`${date}T${start}`);
  const endDate = new Date(`${date}T${end}`);
  const validTimes = !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());
  const minutes = validTimes ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : 0;
  const totalMarks = Math.round(questions.reduce((s, q) => s + (Number(q.marks) || 0), 0) * 10) / 10;

  function patchQ(key: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  function removeQ(key: number) {
    setQuestions((qs) => qs.filter((q) => q.key !== key));
  }

  function setOption(q: DraftQuestion, index: number, value: string) {
    patchQ(q.key, { options: q.options.map((o, j) => (j === index ? value : o)) });
  }

  function addOption(q: DraftQuestion) {
    if (q.options.length < 8) patchQ(q.key, { options: [...q.options, ''] });
  }

  function removeOption(q: DraftQuestion, index: number) {
    if (q.options.length <= 2) return;
    const options = q.options.filter((_o, j) => j !== index);
    let correct = q.correct;
    if (correct === index) correct = -1;
    else if (correct > index) correct -= 1;
    patchQ(q.key, { options, correct });
  }

  function validate(): string {
    if (!title.trim()) return 'Give the exam a title.';
    if (locked) {
      if (phase === 'open') {
        if (!validTimes) return 'Set a valid finish time.';
        if (endDate.getTime() <= Date.now()) return 'The new finish time has already passed. Choose a later time.';
      }
      return '';
    }
    if (!subject.trim()) return 'Enter the subject.';
    if (!streamIds.length) return 'Choose at least one class / stream.';
    if (!date || !start || !end || !validTimes) return 'Set the exam date, start time and finish time.';
    if (endDate.getTime() <= startDate.getTime()) return 'The finish time must be after the start time.';
    if (endDate.getTime() <= Date.now()) return 'The finish time has already passed. Choose a later date or time.';
    if (!questions.length) return 'Add at least one question.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const n = i + 1;
      if (!q.text.trim()) return `Question ${n} has no question text.`;
      const m = Number(q.marks);
      if (!(m > 0 && m <= 100)) return `Give question ${n} marks between 1 and 100.`;
      if (q.type === 'mcq') {
        if (q.options.some((o) => !o.trim())) return `Fill in every answer choice for question ${n}, or remove the empty ones.`;
        if (q.correct < 0) return `Mark the correct answer for question ${n}.`;
      }
    }
    return '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setErr(problem);
      return;
    }
    setErr('');
    setSaving(true);
    try {
      const payload = {
        title,
        subject,
        instructions,
        streamIds,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        questions: questions.map((q) => ({
          type: q.type,
          text: q.text,
          marks: Number(q.marks),
          options: q.options,
          correct: q.correct,
        })),
      };
      if (initial) await api.put(`/api/teacher/exams/${initial.id}`, payload);
      else await api.post('/api/teacher/exams', payload);
      onCreated(title.trim());
    } catch (ex) {
      setErr(errMsg(ex, 'Could not save the exam. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Btn variant='ghost' onClick={onCancel}>
          <ArrowLeft className='h-4 w-4' />
          Back to exams
        </Btn>
        <div className='text-sm text-slate-600'>
          {questions.length} question{questions.length === 1 ? '' : 's'} · {totalMarks} marks
        </div>
      </div>

      {locked && (
        <Alert kind='info'>
          {phase === 'open'
            ? 'This exam is open now, so its questions, classes and start time are locked. You can still change the title, the instructions and the finish time (for example to give more time).'
            : 'This exam has closed. You can still change its title and instructions.'}
        </Alert>
      )}

      <Card>
        <h2 className='text-lg font-bold text-slate-900'>{editing ? 'Edit exam' : 'Create an online exam'}</h2>
        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
          <div className='sm:col-span-2'>
            <label htmlFor='ex-title' className={labelCls}>
              Exam title
            </label>
            <input
              id='ex-title'
              className={inputCls}
              value={title}
              placeholder='e.g. Mid-holiday Mathematics test'
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='ex-subject' className={labelCls}>
              Subject
            </label>
            <input
              id='ex-subject'
              className={inputCls}
              value={subject}
              disabled={locked}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <span className={labelCls}>Classes / streams</span>
            {locked ? (
              <p className='text-sm text-slate-600'>
                {myStreams.filter((s) => streamIds.includes(s.id)).map((s) => s.name).join(', ') || 'Locked'}
              </p>
            ) : (
              <StreamPicker streams={myStreams} value={streamIds} onChange={setStreamIds} />
            )}
          </div>
          <div className='sm:col-span-2'>
            <label htmlFor='ex-instructions' className={labelCls}>
              Instructions to students (optional)
            </label>
            <textarea
              id='ex-instructions'
              rows={3}
              className={inputCls}
              value={instructions}
              placeholder='e.g. Answer all questions. Show your working in the written questions.'
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h2 className='text-lg font-bold text-slate-900'>Date and time</h2>
        <div className='mt-4 grid gap-4 sm:grid-cols-3'>
          <div>
            <label htmlFor='ex-date' className={labelCls}>
              Exam date
            </label>
            <input
              id='ex-date'
              type='date'
              className={inputCls}
              value={date}
              disabled={locked}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='ex-start' className={labelCls}>
              Start time
            </label>
            <input
              id='ex-start'
              type='time'
              className={inputCls}
              value={start}
              disabled={locked}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='ex-end' className={labelCls}>
              Finish time
            </label>
            <input
              id='ex-end'
              type='time'
              className={inputCls}
              value={end}
              disabled={!endEditable}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        <p className='mt-3 text-sm text-slate-600'>
          {minutes > 0
            ? `The exam lasts ${minutes} minutes. It opens at the start time, students see a countdown, and it submits itself when the finish time arrives.`
            : 'Choose a finish time that is later than the start time.'}
        </p>
      </Card>

      {questions.map((q, i) => (
        <Card key={q.key}>
          <div className='flex items-center justify-between gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-sm font-bold text-slate-800'>Question {i + 1}</span>
              <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'>
                {q.type === 'mcq' ? 'Multiple choice' : 'Written answer'}
              </span>
            </div>
            {!locked && (
              <Btn variant='ghost' onClick={() => removeQ(q.key)} aria-label={`Remove question ${i + 1}`}>
                <Trash2 className='h-4 w-4' />
              </Btn>
            )}
          </div>
          <textarea
            rows={2}
            aria-label={`Question ${i + 1} text`}
            className={`${inputCls} mt-3`}
            value={q.text}
            disabled={locked}
            placeholder='Type the question'
            onChange={(e) => patchQ(q.key, { text: e.target.value })}
          />
          {q.type === 'mcq' ? (
            <div className='mt-3 space-y-2'>
              {!locked && <p className='text-xs text-slate-500'>Tap the circle next to the correct answer.</p>}
              {q.options.map((o, j) => (
                <div key={j} className='flex items-center gap-2'>
                  <button
                    type='button'
                    disabled={locked}
                    onClick={() => patchQ(q.key, { correct: j })}
                    aria-label={`Mark choice ${LETTERS[j]} as correct`}
                    aria-pressed={q.correct === j}
                    className={q.correct === j ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'}
                  >
                    {q.correct === j ? <CheckCircle2 className='h-6 w-6' /> : <Circle className='h-6 w-6' />}
                  </button>
                  <span className='w-5 text-sm font-semibold text-slate-500'>{LETTERS[j]}</span>
                  <input
                    className={inputCls}
                    value={o}
                    disabled={locked}
                    placeholder={`Choice ${LETTERS[j]}`}
                    onChange={(e) => setOption(q, j, e.target.value)}
                  />
                  {!locked && q.options.length > 2 && (
                    <button
                      type='button'
                      onClick={() => removeOption(q, j)}
                      className='text-slate-400 hover:text-red-600'
                      aria-label={`Remove choice ${LETTERS[j]}`}
                    >
                      <X className='h-4 w-4' />
                    </button>
                  )}
                </div>
              ))}
              {!locked && q.options.length < 8 && (
                <button
                  type='button'
                  onClick={() => addOption(q)}
                  className='text-sm font-semibold text-emerald-700 hover:underline'
                >
                  + Add choice
                </button>
              )}
            </div>
          ) : (
            <p className='mt-2 text-xs text-slate-500'>Students type their answer. You will mark it after the exam.</p>
          )}
          <div className='mt-3 flex items-center gap-2'>
            <label htmlFor={`marks-${q.key}`} className='text-sm font-medium text-slate-700'>
              Marks
            </label>
            <input
              id={`marks-${q.key}`}
              type='number'
              min={1}
              max={100}
              className={`${inputCls} w-24`}
              value={q.marks}
              disabled={locked}
              onChange={(e) => patchQ(q.key, { marks: e.target.value })}
            />
          </div>
        </Card>
      ))}

      {!locked && (
        <QuestionBankPanel
          subject={subject}
          drafts={questions}
          onAdd={(added: PlainQuestion[]) =>
            setQuestions((prev) => [
              ...prev.filter((q) => q.text.trim() || q.options.some((o) => o.trim())),
              ...added.map((q) => {
                keyCounter += 1;
                return {
                  key: keyCounter,
                  type: q.type,
                  text: q.text,
                  marks: String(q.marks),
                  options: [...q.options],
                  correct: q.correct,
                };
              }),
            ])
          }
        />
      )}

      {!locked && (
        <div className='flex flex-wrap gap-2'>
          <Btn variant='secondary' onClick={() => setQuestions((qs) => [...qs, newQuestion('mcq')])}>
            <ListChecks className='h-4 w-4' />
            Add multiple-choice question
          </Btn>
          <Btn variant='secondary' onClick={() => setQuestions((qs) => [...qs, newQuestion('written')])}>
            <PenLine className='h-4 w-4' />
            Add written question
          </Btn>
        </div>
      )}

      {err && <Alert>{err}</Alert>}

      <Card className='flex flex-wrap items-center justify-between gap-3'>
        <div className='text-sm text-slate-700'>
          <span className='font-semibold'>{questions.length}</span> question{questions.length === 1 ? '' : 's'},{' '}
          <span className='font-semibold'>{totalMarks}</span> marks in total
        </div>
        <Btn type='submit' disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Save and schedule exam'}
        </Btn>
      </Card>
    </form>
  );
}

