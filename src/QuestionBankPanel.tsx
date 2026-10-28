import { useCallback, useState } from 'react';
import { Archive, Search, Trash2 } from 'lucide-react';
import { api, errMsg, LETTERS } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner } from './ui';

export type PlainQuestion = {
  type: 'mcq' | 'written';
  text: string;
  options: string[];
  correct: number;
  marks: number;
};

type BankItem = PlainQuestion & { id: string; subject: string; topic: string; createdAt: string };

type DraftLike = { type: 'mcq' | 'written'; text: string; options: string[]; correct: number; marks: string };

type Props = {
  subject: string;
  drafts: DraftLike[];
  onAdd: (questions: PlainQuestion[]) => void;
};

function isComplete(d: DraftLike): boolean {
  if (!d.text.trim()) return false;
  const m = Number(d.marks);
  if (!(m > 0 && m <= 100)) return false;
  if (d.type === 'mcq') return d.options.length >= 2 && d.options.every((o) => o.trim()) && d.correct >= 0;
  return true;
}

export default function QuestionBankPanel({ subject, drafts, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [allSubjects, setAllSubjects] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api.get('/api/teacher/bank');
      setItems((r.data?.questions || []) as BankItem[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load your question bank.'));
      setItems([]);
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  }

  const complete = drafts.filter(isComplete);

  async function saveDrafts() {
    setErr('');
    setMsg('');
    if (!subject.trim()) {
      setErr('Enter the exam subject first, so the questions are filed under it.');
      return;
    }
    if (!complete.length) {
      setErr('Finish at least one question (text, marks and, for multiple choice, the correct answer) before saving.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/api/teacher/bank', {
        subject,
        topic,
        questions: complete.map((d) => ({
          type: d.type,
          text: d.text,
          options: d.options,
          correct: d.correct,
          marks: Number(d.marks),
        })),
      });
      const saved = Number(r.data?.saved || 0);
      const dup = Number(r.data?.duplicates || 0);
      const skipped = drafts.length - complete.length;
      setMsg(
        `${saved} question${saved === 1 ? '' : 's'} saved to your bank.` +
          (dup ? ` ${dup} ${dup === 1 ? 'was' : 'were'} already there.` : '') +
          (skipped ? ` ${skipped} unfinished ${skipped === 1 ? 'question was' : 'questions were'} skipped.` : ''),
      );
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not save to your question bank.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: BankItem) {
    if (!window.confirm('Remove this question from your bank? Exams that already use it are not affected.')) return;
    try {
      await api.delete(`/api/teacher/bank/${item.id}`);
      setItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      setPicked((p) => p.filter((x) => x !== item.id));
    } catch (e) {
      setErr(errMsg(e, 'Could not remove the question.'));
    }
  }

  function addPicked() {
    const chosen = (items || []).filter((q) => picked.includes(q.id));
    if (!chosen.length) return;
    onAdd(chosen.map((q) => ({ type: q.type, text: q.text, options: q.options, correct: q.correct, marks: q.marks })));
    setMsg(`${chosen.length} question${chosen.length === 1 ? '' : 's'} added to this exam.`);
    setPicked([]);
  }

  const term = search.trim().toLowerCase();
  const subj = subject.trim().toLowerCase();
  const shown = (items || []).filter((q) => {
    if (!allSubjects && subj && q.subject.toLowerCase() !== subj) return false;
    if (!term) return true;
    return q.text.toLowerCase().includes(term) || (q.topic || '').toLowerCase().includes(term);
  });

  return (
    <Card>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Archive className='h-5 w-5 text-emerald-700' />
          <h2 className='text-lg font-bold text-slate-900'>Question bank</h2>
        </div>
        <Btn variant='secondary' onClick={toggle}>
          {open ? 'Close question bank' : 'Open question bank'}
        </Btn>
      </div>
      <p className='mt-1 text-sm text-slate-600'>
        Save questions you write so you can reuse them in later exams without typing them again.
      </p>
      {open && (
        <div className='mt-4 space-y-4'>
          <div className='rounded-lg border border-slate-200 p-3'>
            <div className='text-sm font-semibold text-slate-800'>Save this exam’s questions to your bank</div>
            <div className='mt-2 flex flex-col gap-2 sm:flex-row sm:items-end'>
              <div className='flex-1'>
                <label htmlFor='qb-topic' className={labelCls}>
                  Topic (optional)
                </label>
                <input
                  id='qb-topic'
                  className={inputCls}
                  value={topic}
                  placeholder='e.g. Fractions'
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>
              <Btn onClick={saveDrafts} disabled={busy} className='shrink-0'>
                {busy ? 'Saving…' : `Save ${complete.length} question${complete.length === 1 ? '' : 's'}`}
              </Btn>
            </div>
          </div>

          <div>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <div className='relative flex-1'>
                <Search className='pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400' />
                <input
                  aria-label='Search your question bank'
                  className={`${inputCls} pl-9`}
                  value={search}
                  placeholder='Search by words in the question or topic'
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <label className='flex items-center gap-2 text-sm text-slate-700'>
                <input type='checkbox' checked={allSubjects} onChange={(e) => setAllSubjects(e.target.checked)} />
                Show all subjects
              </label>
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
            {items === null ? (
              <Spinner />
            ) : shown.length === 0 ? (
              <p className='mt-3 text-sm text-slate-500'>
                {items.length
                  ? 'No saved questions match. Try another search or tick Show all subjects.'
                  : 'Your bank is empty. Save the questions of this exam to start it.'}
              </p>
            ) : (
              <ul className='mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1'>
                {shown.map((q) => {
                  const on = picked.includes(q.id);
                  return (
                    <li
                      key={q.id}
                      className={`rounded-lg border p-3 text-sm ${on ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}
                    >
                      <div className='flex items-start gap-3'>
                        <input
                          type='checkbox'
                          className='mt-1'
                          aria-label='Choose this question'
                          checked={on}
                          onChange={() => setPicked((p) => (on ? p.filter((x) => x !== q.id) : [...p, q.id]))}
                        />
                        <div className='min-w-0 flex-1'>
                          <p className='whitespace-pre-wrap break-words text-slate-800'>{q.text}</p>
                          {q.type === 'mcq' && (
                            <p className='mt-1 text-xs text-slate-500'>
                              {q.options.map((o, j) => `${LETTERS[j]}. ${o}`).join('   ')} · Answer {LETTERS[q.correct]}
                            </p>
                          )}
                          <p className='mt-1 text-xs text-slate-500'>
                            {q.type === 'mcq' ? 'Multiple choice' : 'Written answer'} · {q.marks} mark
                            {q.marks === 1 ? '' : 's'} · {q.subject}
                            {q.topic ? ` · ${q.topic}` : ''}
                          </p>
                        </div>
                        <button
                          type='button'
                          onClick={() => remove(q)}
                          className='text-slate-400 hover:text-red-600'
                          aria-label='Remove from bank'
                        >
                          <Trash2 className='h-4 w-4' />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {picked.length > 0 && (
              <Btn onClick={addPicked} className='mt-3'>
                Add {picked.length} selected question{picked.length === 1 ? '' : 's'} to this exam
              </Btn>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

