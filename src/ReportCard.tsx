import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { api, errMsg, fmtDate, safeFileTitle, statusOf, type StudentSession } from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type Entry = {
  kind: 'exam' | 'assignment';
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  date: string;
  score: number | null;
  total: number;
  pending: number;
  status: 'done' | 'missed' | 'not_submitted' | 'awaiting';
};

type Report = {
  student: { name: string; admissionNo: string; streamName: string; schoolName: string };
  entries: Entry[];
};

function pct(score: number, total: number): number {
  return Math.round((score / total) * 1000) / 10;
}

function resultText(e: Entry): string {
  if (e.status === 'missed') return 'Did not sit';
  if (e.status === 'not_submitted') return 'Not handed in';
  if (e.status === 'awaiting') return 'Waiting for marking';
  if (e.score === null) return '—';
  const base = e.total > 0 ? `${e.score} / ${e.total} (${pct(e.score, e.total)}%)` : String(e.score);
  return e.pending ? `${base}, still being marked` : base;
}

function summarise(entries: Entry[]): number | null {
  let got = 0;
  let out = 0;
  entries.forEach((e) => {
    if (e.score !== null && e.total > 0) {
      got += e.score;
      out += e.total;
    }
  });
  return out > 0 ? pct(got, out) : null;
}

function esc(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

function reportHtml(r: Report, groups: Array<[string, Entry[]]>, overall: number | null): string {
  const sections = groups
    .map(([subject, items]) => {
      const avg = summarise(items);
      const rows = items
        .map(
          (e) =>
            `<tr><td>${esc(e.title)}</td><td>${e.kind === 'exam' ? 'Exam' : 'Assignment'}</td><td>${esc(fmtDate(e.date))}</td><td>${esc(resultText(e))}</td></tr>`,
        )
        .join('');
      return `<h2>${esc(subject)}${avg === null ? '' : ` &nbsp;–&nbsp; average ${avg}%`}</h2><table><thead><tr><th>Work</th><th>Type</th><th>Date</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset='utf-8'><title>Report card</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:760px;margin:28px auto;padding:0 16px}h1{font-size:22px;margin:4px 0}h2{font-size:16px;margin:22px 0 6px}.school{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#444}.meta{font-size:14px;margin:6px 0 4px}.overall{font-size:15px;font-weight:bold;margin:10px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}th{background:#f1f5f9}.note{font-size:12px;color:#555;margin-top:18px}</style></head><body><div class='school'>${esc(r.student.schoolName)}</div><h1>Holiday report card</h1><div class='meta'>${esc(r.student.name)} &nbsp;|&nbsp; Admission no. ${esc(r.student.admissionNo)} &nbsp;|&nbsp; ${esc(r.student.streamName)}</div><div class='overall'>Overall average: ${overall === null ? 'no marks yet' : `${overall}%`}</div>${sections}<p class='note'>Averages count only marked work. Work not sat or not handed in is listed but not counted.</p></body></html>`;
}

export default function ReportCard({ session, onExpired }: { session: StudentSession; onExpired: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/student/report', { token: session.token });
      setReport(r.data as Report);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load your report card.'));
    } finally {
      setLoading(false);
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !report) return <Spinner label='Loading your report card…' />;
  if (!report) return err ? <Alert>{err}</Alert> : null;

  const bySubject = new Map<string, Entry[]>();
  report.entries.forEach((e) => {
    const key = e.subject || 'Other';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(e);
  });
  const groups = Array.from(bySubject.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const overall = summarise(report.entries);

  function printIt() {
    setNote('');
    const w = window.open('', '_blank');
    if (!w) {
      setNote('Your browser blocked the print window. Use Download instead, then print the file.');
      return;
    }
    w.document.open();
    w.document.write(reportHtml(report!, groups, overall));
    w.document.close();
    w.focus();
    window.setTimeout(() => {
      try {
        w.print();
      } catch {
        // the student can print from the new tab
      }
    }, 400);
  }

  function downloadIt() {
    const blob = new Blob([reportHtml(report!, groups, overall)], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileTitle(report!.student.name || 'report')} report card.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  return (
    <div className='space-y-4'>
      <Card>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-lg font-bold text-slate-900'>My report card</h2>
            <p className='text-sm text-slate-600'>All your exam and assignment marks, by subject.</p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Btn variant='ghost' onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Btn>
            <Btn variant='secondary' onClick={printIt}>
              <Printer className='h-4 w-4' />
              Print
            </Btn>
            <Btn variant='secondary' onClick={downloadIt}>
              <Download className='h-4 w-4' />
              Download
            </Btn>
          </div>
        </div>
        <div className='mt-4 rounded-xl bg-emerald-50 p-4'>
          <div className='text-sm font-medium text-emerald-800'>Overall average</div>
          <div className='text-3xl font-bold text-emerald-900'>{overall === null ? 'No marks yet' : `${overall}%`}</div>
        </div>
        {note && (
          <div className='mt-3'>
            <Alert kind='info'>{note}</Alert>
          </div>
        )}
        {err && (
          <div className='mt-3'>
            <Alert>{err}</Alert>
          </div>
        )}
      </Card>
      {groups.length === 0 ? (
        <Card className='text-sm text-slate-500'>
          No marks yet. Exam scores appear here after each exam closes, and assignment marks after your teacher marks them.
        </Card>
      ) : (
        groups.map(([subject, items]) => {
          const avg = summarise(items);
          return (
            <Card key={subject}>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <h3 className='text-lg font-bold text-slate-900'>{subject}</h3>
                <span className='rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800'>
                  {avg === null ? 'No marks yet' : `Average ${avg}%`}
                </span>
              </div>
              <ul className='mt-3 divide-y divide-slate-100'>
                {items.map((e) => (
                  <li key={`${e.kind}-${e.id}`} className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'>
                    <div className='min-w-0'>
                      <div className='font-semibold text-slate-800'>{e.title}</div>
                      <div className='text-xs text-slate-500'>
                        {e.kind === 'exam' ? 'Exam' : 'Assignment'} · {fmtDate(e.date)} · {e.teacherName}
                      </div>
                    </div>
                    <span className={e.score === null ? 'text-slate-500' : 'font-semibold text-slate-900'}>
                      {resultText(e)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
      <p className='text-xs text-slate-500'>
        Averages count only marked work. Work you did not sit or hand in is listed but not counted.
      </p>
    </div>
  );
}

