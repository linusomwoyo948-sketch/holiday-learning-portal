import { useCallback, useState, type FormEvent } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { api, errMsg, fmtDateTime, statusOf, type StudentSession } from './lib';
import { Alert, Btn, inputCls, Spinner } from './ui';

type Question = { id: string; text: string; answer: string; createdAt: string; answeredAt: string };

type Props = {
  session: StudentSession;
  itemType: 'material' | 'assignment';
  itemId: string;
  onExpired: () => void;
};

export default function QuestionBox({ session, itemType, itemId, onExpired }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Question[] | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api.post('/api/student/questions/list', { token: session.token, itemId });
      setItems((r.data?.questions || []) as Question[]);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load your questions.'));
      setItems([]);
    }
  }, [session.token, itemId, onExpired]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!text.trim()) {
      setErr('Type your question.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/student/questions', { token: session.token, itemType, itemId, text });
      setText('');
      await load();
    } catch (ex) {
      if (statusOf(ex) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(ex, 'Could not send your question. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='mt-4 border-t border-slate-100 pt-3'>
      <button
        type='button'
        onClick={toggle}
        aria-expanded={open}
        className='inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline'
      >
        <MessageCircleQuestion className='h-4 w-4' />
        {open ? 'Hide questions' : 'Ask your teacher a question'}
      </button>
      {open && (
        <div className='mt-3 space-y-3'>
          {items === null ? (
            <Spinner label='Loading…' />
          ) : (
            items.length > 0 && (
              <ul className='space-y-2'>
                {items.map((q) => (
                  <li key={q.id} className='rounded-lg border border-slate-200 p-3 text-sm'>
                    <div className='text-xs text-slate-500'>You asked on {fmtDateTime(q.createdAt)}</div>
                    <p className='mt-1 whitespace-pre-wrap break-words text-slate-800'>{q.text}</p>
                    {q.answer ? (
                      <div className='mt-2 rounded-lg bg-emerald-50 p-2'>
                        <div className='text-xs font-semibold text-emerald-800'>Teacher’s answer</div>
                        <p className='mt-1 whitespace-pre-wrap break-words text-emerald-900'>{q.answer}</p>
                      </div>
                    ) : (
                      <p className='mt-2 text-xs italic text-slate-500'>Waiting for your teacher’s answer.</p>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
          <form onSubmit={send} noValidate className='space-y-2'>
            <textarea
              aria-label='Your question'
              rows={3}
              className={inputCls}
              value={text}
              placeholder='Type your question about this work'
              onChange={(e) => setText(e.target.value)}
            />
            {err && <Alert>{err}</Alert>}
            <Btn type='submit' disabled={busy}>
              {busy ? 'Sending…' : 'Send question'}
            </Btn>
          </form>
        </div>
      )}
    </div>
  );
}

