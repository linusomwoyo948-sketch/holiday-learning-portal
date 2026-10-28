import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { api, errMsg, fmtDate } from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type Usage = { logins: number; posts: number; submissions: number; questions: number };
type Row = { id: string; name: string; thisWeek: Usage; lastWeek: Usage };

function weekStartDate(key: string): string {
  if (key.length !== 8) return '';
  return fmtDate(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T12:00:00Z`);
}

function Change({ now, before }: { now: number; before: number }) {
  if (now === before) return null;
  const up = now > before;
  return <span className={`ml-1 text-xs ${up ? 'text-emerald-700' : 'text-red-700'}`}>{up ? '▲' : '▼'}{Math.abs(now - before)}</span>;
}

export default function UsageSummary() {
  const [rows, setRows] = useState<Row[]>([]);
  const [weekStart, setWeekStart] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/owner/usage');
      setRows((r.data?.rows || []) as Row[]);
      setWeekStart(String(r.data?.weekStart || ''));
    } catch (e) {
      setErr(errMsg(e, 'Could not load the usage summary.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = rows.reduce(
    (t, r) => ({
      logins: t.logins + r.thisWeek.logins,
      posts: t.posts + r.thisWeek.posts,
      submissions: t.submissions + r.thisWeek.submissions,
      questions: t.questions + r.thisWeek.questions,
    }),
    { logins: 0, posts: 0, submissions: 0, questions: 0 },
  );

  return (
    <Card>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <Activity className='h-5 w-5 text-emerald-700' />
          <h2 className='text-lg font-bold text-slate-900'>Weekly usage</h2>
        </div>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      <p className='mt-1 text-sm text-slate-600'>
        This week{weekStart ? ` (from ${weekStartDate(weekStart)})` : ''} for each school, with the change from last week.
        Counting started when this summary was added.
      </p>
      {err && (
        <div className='mt-3'>
          <Alert>{err}</Alert>
        </div>
      )}
      <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
        {[
          ['Sign-ins', totals.logins],
          ['Teacher posts', totals.posts],
          ['Work handed in', totals.submissions],
          ['Student questions', totals.questions],
        ].map(([label, value]) => (
          <div key={String(label)} className='rounded-xl bg-slate-50 p-3 text-center'>
            <div className='text-2xl font-bold text-slate-900'>{value}</div>
            <div className='text-xs text-slate-500'>{label}</div>
          </div>
        ))}
      </div>
      {loading && rows.length === 0 ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className='mt-4 text-sm text-slate-500'>No active schools yet.</p>
      ) : (
        <div className='mt-4 overflow-x-auto'>
          <table className='min-w-full text-sm'>
            <thead>
              <tr className='border-y border-slate-200 bg-slate-50 text-left text-slate-700'>
                <th className='px-3 py-2 font-semibold'>School</th>
                <th className='px-3 py-2 font-semibold'>Sign-ins</th>
                <th className='px-3 py-2 font-semibold'>Teacher posts</th>
                <th className='px-3 py-2 font-semibold'>Work handed in</th>
                <th className='px-3 py-2 font-semibold'>Questions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className='border-b border-slate-100'>
                  <td className='px-3 py-2 font-medium text-slate-900'>{r.name}</td>
                  <td className='px-3 py-2'>
                    {r.thisWeek.logins}
                    <Change now={r.thisWeek.logins} before={r.lastWeek.logins} />
                  </td>
                  <td className='px-3 py-2'>
                    {r.thisWeek.posts}
                    <Change now={r.thisWeek.posts} before={r.lastWeek.posts} />
                  </td>
                  <td className='px-3 py-2'>
                    {r.thisWeek.submissions}
                    <Change now={r.thisWeek.submissions} before={r.lastWeek.submissions} />
                  </td>
                  <td className='px-3 py-2'>
                    {r.thisWeek.questions}
                    <Change now={r.thisWeek.questions} before={r.lastWeek.questions} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

