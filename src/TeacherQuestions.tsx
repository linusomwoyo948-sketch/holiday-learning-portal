import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { api, errMsg, fmtDateTime, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';

type Question = {
  id: string;
  itemType: 'material' | 'assignment';
  itemTitle: string;
  studentName: string;
  admissionNo: string;
  streamId: string;
  text: string;
  createdAt: string;
  answer: string;
  answeredAt: string;
};

export default function TeacherQuestions({ allStreams }: { allStreams: Stream[] }) {
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const names: Record<string, string> = {};
  allStreams.forEach((s) => {
    names[s.id] = s.name;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/teacher/questions');
      setItems((r.data?.questions || []) as Question[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load questions.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = items.filter((q) => !q.answer);
  const shown = filter === 'open' ? open : items;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-slate-900'>Questions from students</h2>
          <p className='text-sm text-slate-600'>Students ask about your materials and assignments. Only the student who asked sees your answer.</p>
        </div>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      <div className='flex gap-2'>
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type='button'
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              filter === f
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-400'
            }`}
          >
            {f === 'open' ? `Waiting for an answer (${open.length})` : `All questions (${items.length})`}
          </button>
        ))}
      </div>
      {err && <Alert>{err}</Alert>}
      {loading && items.length === 0 ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Card className='text-sm text-slate-500'>
          {filter === 'open' ? 'No questions are waiting for an answer.' : 'No student has asked a question yet.'}
        </Card>
      ) : (
        shown.map((q) => (
          <QuestionItem
            key={q.id}
            q={q}
            streamName={names[q.streamId] || ''}
            onChanged={(u) => setItems((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
            onDeleted={() => setItems((prev) => prev.filter((x) => x.id !== q.id))}
          />
        ))
      )}
    </div>
  );
}

function QuestionItem({
  q,
  streamName,
  onChanged,
  onDeleted,
}: {
  q: Question;
  streamName: string;
  onChanged: (q: Question) => void;
  onDeleted: () => void;
}) {
  const [answer, setAnswer] = useState(q.answer || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function save() {
    setErr('');
    setMsg('');
    if (!answer.trim()) {
      setErr('Write your answer.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/api/teacher/questions/${q.id}/answer`, { answer });
      onChanged({ ...q, answer: String(r.data?.answer || answer), answeredAt: String(r.data?.answeredAt || '') });
      setMsg('Answer sent. The student will see it under the work.');
    } catch (e) {
      setErr(errMsg(e, 'Could not save the answer.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this question?')) return;
    setBusy(true);
    try {
      await api.delete(`/api/teacher/questions/${q.id}`);
      onDeleted();
    } catch (e) {
      setErr(errMsg(e, 'Could not delete the question.'));
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='font-semibold text-slate-900'>
            {q.studentName || 'Student'} <span className='font-normal text-slate-500'>· Adm. {q.admissionNo}</span>
          </div>
          <div className='text-xs text-slate-500'>
            {streamName ? `${streamName} · ` : ''}About the {q.itemType === 'assignment' ? 'assignment' : 'material'} “{q.itemTitle}” · {fmtDateTime(q.createdAt)}
          </div>
        </div>
        {q.answer ? (
          <span className='rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800'>Answered</span>
        ) : (
          <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>Waiting</span>
        )}
      </div>
      <p className='mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-800'>{q.text}</p>
      <textarea
        aria-label='Your answer'
        rows={3}
        className={`${inputCls} mt-3`}
        value={answer}
        placeholder='Type your answer'
        onChange={(e) => setAnswer(e.target.value)}
      />
      {err && (
        <div className='mt-2'>
          <Alert>{err}</Alert>
        </div>
      )}
      {msg && (
        <div className='mt-2'>
          <Alert kind='success'>{msg}</Alert>
        </div>
      )}
      <div className='mt-3 flex flex-wrap gap-2'>
        <Btn onClick={save} disabled={busy}>
          {q.answer ? 'Update answer' : 'Send answer'}
        </Btn>
        <Btn variant='ghost' onClick={remove} disabled={busy} aria-label='Delete question'>
          <Trash2 className='h-4 w-4' />
        </Btn>
      </div>
    </Card>
  );
}

