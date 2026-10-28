import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api, downloadExcel, errMsg, fmtDate, safeFileTitle, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner } from './ui';

type Column = { id: string; kind: 'exam' | 'assignment'; title: string; subject: string; totalMarks: number; date: string };
type Cell = { score: number | null; pending: number; status: string };
type Data = {
  students: Array<{ id: string; name: string; admissionNo: string }>;
  columns: Column[];
  marks: Record<string, Record<string, Cell>>;
};

function cellText(c: Cell | undefined): string {
  if (!c) return '—';
  if (c.status === 'absent') return 'Absent';
  if (c.status === 'not_yet') return '';
  if (c.status === 'writing') return 'Writing';
  if (c.status === 'tomark') return 'To mark';
  if (c.score === null) return '—';
  return c.pending ? `${c.score}*` : String(c.score);
}

function average(cols: Column[], row: Record<string, Cell> | undefined): number | null {
  if (!row) return null;
  let got = 0;
  let out = 0;
  cols.forEach((c) => {
    const cell = row[c.id];
    if (cell && cell.score !== null && c.totalMarks > 0) {
      got += cell.score;
      out += c.totalMarks;
    }
  });
  return out > 0 ? Math.round((got / out) * 1000) / 10 : null;
}

export default function MarkSheet({ streams }: { streams: Stream[] }) {
  const [streamId, setStreamId] = useState(streams[0]?.id || '');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true);
    setErr('');
    try {
      const r = await api.get(`/api/teacher/marksheet?streamId=${encodeURIComponent(sid)}`);
      setData(r.data as Data);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the mark sheet.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(streamId);
  }, [streamId, load]);

  const streamName = streams.find((s) => s.id === streamId)?.name || 'Class';

  async function download() {
    if (!data) return;
    setBusy(true);
    try {
      const header = [
        'Admission no.',
        'Name',
        ...data.columns.map(
          (c) => `${c.title} (${c.kind === 'exam' ? 'Exam' : 'Assignment'}${c.totalMarks ? `, out of ${c.totalMarks}` : ''})`,
        ),
        'Average %',
      ];
      const rows: Array<Array<string | number>> = [header];
      data.students.forEach((s) => {
        const row = data.marks[s.id];
        const avg = average(data.columns, row);
        rows.push([
          s.admissionNo,
          s.name,
          ...data.columns.map((c) => {
            const cell = row ? row[c.id] : undefined;
            return cell && cell.score !== null ? cell.score : cellText(cell);
          }),
          avg === null ? '' : avg,
        ]);
      });
      await downloadExcel(`${safeFileTitle(streamName)} mark sheet.xlsx`, [{ name: streamName, rows }]);
    } catch (e) {
      setErr(errMsg(e, 'Could not create the Excel file.'));
    } finally {
      setBusy(false);
    }
  }

  if (!streams.length) {
    return <Alert kind='info'>You have not been assigned any class yet.</Alert>;
  }

  return (
    <div className='space-y-4'>
      <Card>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div className='min-w-[220px]'>
            <label htmlFor='ms-stream' className={labelCls}>
              Class / stream
            </label>
            <select id='ms-stream' className={inputCls} value={streamId} onChange={(e) => setStreamId(e.target.value)}>
              {streams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Btn variant='ghost' onClick={() => load(streamId)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Btn>
            <Btn onClick={download} disabled={!data || busy || !data.students.length}>
              <Download className='h-4 w-4' />
              {busy ? 'Preparing…' : 'Download Excel'}
            </Btn>
          </div>
        </div>
        <p className='mt-3 text-sm text-slate-600'>
          Marks from your exams and portal assignments for this class, one row per student. Paper assignments are not
          included because they are marked outside the portal.
        </p>
      </Card>
      {err && <Alert>{err}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : !data ? null : data.students.length === 0 ? (
        <Card className='text-sm text-slate-500'>No students have been added to {streamName} yet.</Card>
      ) : data.columns.length === 0 ? (
        <Card className='text-sm text-slate-500'>You have not set any exams or portal assignments for {streamName} yet.</Card>
      ) : (
        <Card className='p-0'>
          <div className='overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead>
                <tr className='border-b border-slate-200 bg-slate-50 text-left'>
                  <th className='sticky left-0 bg-slate-50 px-3 py-2 font-semibold text-slate-700'>Student</th>
                  {data.columns.map((c) => (
                    <th key={c.id} className='px-3 py-2 align-bottom font-semibold text-slate-700'>
                      <div className='max-w-[140px] truncate' title={c.title}>
                        {c.title}
                      </div>
                      <div className='text-xs font-normal text-slate-500'>
                        {c.kind === 'exam' ? 'Exam' : 'Assignment'} · {fmtDate(c.date)}
                        {c.totalMarks ? ` · /${c.totalMarks}` : ''}
                      </div>
                    </th>
                  ))}
                  <th className='px-3 py-2 font-semibold text-slate-700'>Average</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => {
                  const row = data.marks[s.id];
                  const avg = average(data.columns, row);
                  return (
                    <tr key={s.id} className='border-b border-slate-100'>
                      <td className='sticky left-0 whitespace-nowrap bg-white px-3 py-2'>
                        <div className='font-medium text-slate-900'>{s.name || 'Unnamed'}</div>
                        <div className='font-mono text-xs text-slate-500'>{s.admissionNo}</div>
                      </td>
                      {data.columns.map((c) => {
                        const cell = row ? row[c.id] : undefined;
                        const muted = !cell || cell.score === null;
                        return (
                          <td key={c.id} className={`px-3 py-2 ${muted ? 'text-slate-400' : 'font-semibold text-slate-800'}`}>
                            {cellText(cell)}
                          </td>
                        );
                      })}
                      <td className='px-3 py-2 font-bold text-slate-900'>{avg === null ? '—' : `${avg}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className='px-3 py-2 text-xs text-slate-500'>* Written answers still to be marked.</p>
        </Card>
      )}
    </div>
  );
}

