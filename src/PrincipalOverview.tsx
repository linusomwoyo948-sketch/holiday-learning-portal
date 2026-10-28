import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, errMsg, fmtDate } from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type TeacherRow = {
  id: string;
  name: string;
  subjects: string;
  classes: number;
  materials: number;
  assignments: number;
  exams: number;
  openQuestions: number;
  lastActive: string;
};

type StreamRow = {
  id: string;
  name: string;
  students: number;
  assignments: number;
  exams: number;
  handInRate: number | null;
  examRate: number | null;
  averageScore: number | null;
};

const QUIET_DAYS = 14;

function pctCell(v: number | null) {
  if (v === null) return <span className='text-slate-400'>—</span>;
  const cls = v >= 70 ? 'text-emerald-700' : v >= 50 ? 'text-amber-700' : 'text-red-700';
  return <span className={`font-semibold ${cls}`}>{v}%</span>;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className='text-center'>
      <div className='text-2xl font-bold text-slate-900'>{value}</div>
      <div className='text-xs text-slate-500'>{label}</div>
    </Card>
  );
}

export default function PrincipalOverview() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/admin/overview');
      setTeachers((r.data?.teachers || []) as TeacherRow[]);
      setStreams((r.data?.streams || []) as StreamRow[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the school overview.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const quietSince = Date.now() - QUIET_DAYS * 24 * 60 * 60 * 1000;
  const totalStudents = streams.reduce((s, x) => s + x.students, 0);
  const quiet = teachers.filter((t) => !t.lastActive || Date.parse(t.lastActive) < quietSince).length;

  if (loading && !teachers.length && !streams.length) return <Spinner label='Putting the overview together…' />;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-slate-900'>School overview</h2>
          <p className='text-sm text-slate-600'>How teachers and classes are using the portal.</p>
        </div>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      {err && <Alert>{err}</Alert>}

      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Stat label='Approved teachers' value={teachers.length} />
        <Stat label='Classes / streams' value={streams.length} />
        <Stat label='Students' value={totalStudents} />
        <Stat label={`Teachers quiet for ${QUIET_DAYS}+ days`} value={quiet} />
      </div>

      <Card className='p-0'>
        <div className='px-5 pt-5'>
          <h3 className='text-lg font-bold text-slate-900'>Teachers</h3>
          <p className='text-sm text-slate-600'>
            What each teacher has posted. Rows in amber have posted nothing in the last {QUIET_DAYS} days.
          </p>
        </div>
        {teachers.length === 0 ? (
          <p className='px-5 pb-5 pt-3 text-sm text-slate-500'>No approved teachers yet.</p>
        ) : (
          <div className='mt-3 overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead>
                <tr className='border-y border-slate-200 bg-slate-50 text-left text-slate-700'>
                  <th className='px-4 py-2 font-semibold'>Teacher</th>
                  <th className='px-3 py-2 font-semibold'>Classes</th>
                  <th className='px-3 py-2 font-semibold'>Materials</th>
                  <th className='px-3 py-2 font-semibold'>Assignments</th>
                  <th className='px-3 py-2 font-semibold'>Exams</th>
                  <th className='px-3 py-2 font-semibold'>Unanswered questions</th>
                  <th className='px-3 py-2 font-semibold'>Last posted</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => {
                  const isQuiet = !t.lastActive || Date.parse(t.lastActive) < quietSince;
                  return (
                    <tr key={t.id} className={`border-b border-slate-100 ${isQuiet ? 'bg-amber-50' : ''}`}>
                      <td className='px-4 py-2'>
                        <div className='font-medium text-slate-900'>{t.name}</div>
                        <div className='text-xs text-slate-500'>{t.subjects}</div>
                      </td>
                      <td className='px-3 py-2'>{t.classes}</td>
                      <td className='px-3 py-2'>{t.materials}</td>
                      <td className='px-3 py-2'>{t.assignments}</td>
                      <td className='px-3 py-2'>{t.exams}</td>
                      <td className={`px-3 py-2 ${t.openQuestions ? 'font-semibold text-amber-800' : ''}`}>{t.openQuestions}</td>
                      <td className='whitespace-nowrap px-3 py-2'>{t.lastActive ? fmtDate(t.lastActive) : 'Nothing yet'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className='p-0'>
        <div className='px-5 pt-5'>
          <h3 className='text-lg font-bold text-slate-900'>Classes</h3>
          <p className='text-sm text-slate-600'>
            Hand-in rate counts portal assignments only. Exam figures use the last 10 closed exams of each class.
          </p>
        </div>
        {streams.length === 0 ? (
          <p className='px-5 pb-5 pt-3 text-sm text-slate-500'>No classes yet. Add them under School setup.</p>
        ) : (
          <div className='mt-3 overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead>
                <tr className='border-y border-slate-200 bg-slate-50 text-left text-slate-700'>
                  <th className='px-4 py-2 font-semibold'>Class / stream</th>
                  <th className='px-3 py-2 font-semibold'>Students</th>
                  <th className='px-3 py-2 font-semibold'>Assignments handed in</th>
                  <th className='px-3 py-2 font-semibold'>Students who sat exams</th>
                  <th className='px-3 py-2 font-semibold'>Average exam score</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((s) => (
                  <tr key={s.id} className='border-b border-slate-100'>
                    <td className='px-4 py-2 font-medium text-slate-900'>{s.name}</td>
                    <td className='px-3 py-2'>{s.students}</td>
                    <td className='px-3 py-2'>
                      {pctCell(s.handInRate)}
                      <span className='ml-1 text-xs text-slate-500'>({s.assignments} assignments)</span>
                    </td>
                    <td className='px-3 py-2'>
                      {pctCell(s.examRate)}
                      <span className='ml-1 text-xs text-slate-500'>({s.exams} exams)</span>
                    </td>
                    <td className='px-3 py-2'>{pctCell(s.averageScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

