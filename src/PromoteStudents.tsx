import { useCallback, useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, errMsg, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';

const KEEP = '__keep__';
const REMOVE = '__remove__';

type Result = { from: string; text: string };

export default function PromoteStudents({ streams }: { streams: Stream[] }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  const names: Record<string, string> = {};
  streams.forEach((s) => {
    names[s.id] = s.name;
  });

  const loadCounts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/admin/stream-summary');
      const next: Record<string, number> = {};
      ((r.data?.summary || []) as Array<{ id: string; students: number }>).forEach((s) => {
        next[s.id] = s.students;
      });
      setCounts(next);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the number of students in each class.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  const moves = streams
    .map((s) => ({ from: s.id, to: plan[s.id] || KEEP }))
    .filter((m) => m.to !== KEEP && (counts[m.from] || 0) > 0);

  function orderMoves(): Array<{ from: string; to: string }> | null {
    const left = [...moves];
    const out: Array<{ from: string; to: string }> = [];
    while (left.length) {
      const i = left.findIndex((m) => m.to === REMOVE || !left.some((o) => o.from === m.to));
      if (i < 0) return null;
      out.push(left[i]);
      left.splice(i, 1);
    }
    return out;
  }

  async function run() {
    setErr('');
    setResults([]);
    if (!moves.length) {
      setErr('Choose where at least one class should move.');
      return;
    }
    if (confirm.trim() !== 'PROMOTE') {
      setErr('Type PROMOTE in capital letters to confirm.');
      return;
    }
    const ordered = orderMoves();
    if (!ordered) {
      setErr('These moves go round in a circle (for example A to B and B to A). Change them and try again.');
      return;
    }
    setBusy(true);
    const done: Result[] = [];
    try {
      for (const m of ordered) {
        setProgress(`Working on ${names[m.from]}…`);
        const r = await api.post(
          '/api/admin/promote-stream',
          m.to === REMOVE ? { from: m.from, remove: true } : { from: m.from, to: m.to },
        );
        const moved = Number(r.data?.moved || 0);
        const skipped = Number(r.data?.skipped || 0);
        const removed = Number(r.data?.removed || 0);
        done.push({
          from: m.from,
          text:
            m.to === REMOVE
              ? `${names[m.from]}: ${removed} student${removed === 1 ? '' : 's'} removed (finished school).`
              : `${names[m.from]} → ${names[m.to]}: ${moved} moved${
                  skipped ? `, ${skipped} skipped because the same admission number is already in ${names[m.to]}` : ''
                }.`,
        });
        setResults([...done]);
      }
      setPlan({});
      setConfirm('');
      await loadCounts();
    } catch (e) {
      setErr(errMsg(e, 'The move stopped part of the way. The results below show what was finished.'));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  if (!streams.length) {
    return <Alert kind='info'>Add your classes under School setup first.</Alert>;
  }

  return (
    <div className='space-y-4'>
      <Card>
        <h2 className='text-lg font-bold text-slate-900'>Move students up to the next class</h2>
        <p className='mt-1 text-sm text-slate-600'>
          At the end of the year, choose where each class moves, for example Form 1 East to Form 2 East. Students keep
          their admission numbers and simply sign in with their new class. Classes you leave on “Keep where they are”
          are not changed. A finishing class can be removed from the portal.
        </p>
        <Alert kind='info'>
          After moving students, check under Teachers that each teacher is assigned to the right classes for the new
          year. Past marks stay in teachers’ records, and students start the new class with a fresh report card.
        </Alert>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <Card>
          <ul className='divide-y divide-slate-100'>
            {streams.map((s) => (
              <li key={s.id} className='flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <div className='font-semibold text-slate-900'>{s.name}</div>
                  <div className='text-xs text-slate-500'>{counts[s.id] || 0} students</div>
                </div>
                <div className='flex items-center gap-2 sm:w-80'>
                  <ArrowRight className='h-4 w-4 shrink-0 text-slate-400' />
                  <select
                    aria-label={`Where ${s.name} moves`}
                    className={inputCls}
                    value={plan[s.id] || KEEP}
                    disabled={busy || !(counts[s.id] || 0)}
                    onChange={(e) => setPlan((p) => ({ ...p, [s.id]: e.target.value }))}
                  >
                    <option value={KEEP}>Keep where they are</option>
                    {streams
                      .filter((t) => t.id !== s.id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          Move to {t.name}
                        </option>
                      ))}
                    <option value={REMOVE}>Remove (finished school)</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
          <div className='mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3'>
            <p className='text-sm text-amber-900'>
              {moves.length
                ? `${moves.length} class${moves.length === 1 ? '' : 'es'} will change. Type PROMOTE to confirm.`
                : 'Choose where at least one class should move.'}
            </p>
            <div className='flex flex-col gap-2 sm:flex-row'>
              <input
                aria-label='Type PROMOTE to confirm'
                className={inputCls}
                value={confirm}
                placeholder='PROMOTE'
                disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Btn onClick={run} disabled={busy || !moves.length} className='shrink-0'>
                {busy ? progress || 'Moving…' : 'Move students'}
              </Btn>
            </div>
          </div>
          {err && (
            <div className='mt-3'>
              <Alert>{err}</Alert>
            </div>
          )}
          {results.length > 0 && (
            <div className='mt-3'>
              <Alert kind='success'>
                <ul className='space-y-1'>
                  {results.map((r) => (
                    <li key={r.from}>{r.text}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

