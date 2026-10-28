import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, LogOut, RefreshCw } from 'lucide-react';
import { api, errMsg, statusOf, type Material, type StudentSession } from './lib';
import { Alert, Btn, Card, Spinner, TopBar } from './ui';
import MaterialCard from './MaterialCard';
import StudentExams from './StudentExams';
import StudentAssignments from './StudentAssignments';
import StudentResult from './StudentResult';
import StudentNotices from './StudentNotices';
import ReportCard from './ReportCard';
import NotificationBell from './NotificationBell';
import ParentPinCard from './ParentPinCard';
import QuestionBox from './QuestionBox';
import ExamTaker from './ExamTaker';
import { useSiteName } from './site';

type Props = {
  session: StudentSession;
  schoolName: string;
  onSignOut: () => void;
};

type Tab = 'materials' | 'assignments' | 'exams' | 'report' | 'notices';

export default function StudentHome({ session, schoolName, onSignOut }: Props) {
  const siteName = useSiteName();
  const [tab, setTab] = useState<Tab>('materials');
  const [takingId, setTakingId] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [subject, setSubject] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/student/materials', { token: session.token });
      const list = (r.data?.materials || []) as Material[];
      setMaterials(list);
      try {
        window.localStorage.setItem(`holiday-portal-materials-${session.streamId}-${session.admissionNo}`, JSON.stringify(list));
      } catch {
        // storage full or unavailable
      }
    } catch (e) {
      if (statusOf(e) === 401) {
        onSignOut();
        return;
      }
      let cached: Material[] | null = null;
      try {
        const raw = window.localStorage.getItem(`holiday-portal-materials-${session.streamId}-${session.admissionNo}`);
        cached = raw ? (JSON.parse(raw) as Material[]) : null;
      } catch {
        cached = null;
      }
      if (cached && cached.length) {
        setMaterials(cached);
        setErr('You seem to be offline. Showing the materials saved on this phone. Attached files and links need internet.');
      } else {
        setErr(errMsg(e, 'Could not load your learning materials. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  }, [session.token, onSignOut]);

  useEffect(() => {
    load();
  }, [load]);

  const subjects = useMemo(() => Array.from(new Set(materials.map((m) => m.subject))).sort(), [materials]);
  const shown = subject === 'All' ? materials : materials.filter((m) => m.subject === subject);

  function signOut() {
    api.post('/api/student/logout', { token: session.token }).catch(() => undefined);
    onSignOut();
  }

  if (takingId) {
    return (
      <ExamTaker
        session={session}
        examId={takingId}
        onExit={() => {
          setTakingId('');
          setTab('exams');
        }}
        onExpired={onSignOut}
      />
    );
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'materials', label: 'Learning materials' },
    { key: 'assignments', label: 'Assignments' },
    { key: 'exams', label: 'Exams' },
    { key: 'report', label: 'Report card' },
    { key: 'notices', label: 'Notices' },
  ];

  let body;
  if (tab === 'assignments') {
    body = <StudentAssignments session={session} schoolName={schoolName || siteName} onExpired={onSignOut} />;
  } else if (tab === 'report') {
    body = (
      <div className='space-y-4'>
        <ParentPinCard session={session} onExpired={onSignOut} />
        <ReportCard session={session} onExpired={onSignOut} />
      </div>
    );
  } else if (tab === 'notices') {
    body = <StudentNotices session={session} onExpired={onSignOut} />;
  } else if (tab === 'exams' && reviewId) {
    body = <StudentResult session={session} examId={reviewId} onBack={() => setReviewId('')} onExpired={onSignOut} />;
  } else if (tab === 'exams') {
    body = <StudentExams session={session} onStart={setTakingId} onReview={setReviewId} onExpired={onSignOut} />;
  } else {
    body = (
      <>
        <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
          <h2 className='text-lg font-bold text-slate-900'>My learning materials</h2>
          <Btn variant='ghost' onClick={load}>
            <RefreshCw className='h-4 w-4' />
            Refresh
          </Btn>
        </div>
        {subjects.length > 1 && (
          <div className='mb-4 flex flex-wrap gap-2'>
            {['All', ...subjects].map((s) => (
              <button
                key={s}
                type='button'
                onClick={() => setSubject(s)}
                className={`rounded-full border px-3 py-1 text-sm font-medium ${
                  subject === s
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-400'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {err && (
          <div className='mb-4'>
            <Alert>{err}</Alert>
          </div>
        )}
        {loading ? (
          <Spinner label='Loading your materials…' />
        ) : shown.length === 0 ? (
          <Card className='text-center'>
            <BookOpen className='mx-auto h-8 w-8 text-slate-400' />
            <p className='mt-2 font-semibold text-slate-700'>No materials yet</p>
            <p className='text-sm text-slate-500'>Your teachers have not posted anything for your class. Check back soon.</p>
          </Card>
        ) : (
          <div className='space-y-4'>
            {shown.map((m) => (
              <MaterialCard
                key={m.id}
                m={m}
                footer={<QuestionBox session={session} itemType='material' itemId={m.id} onExpired={onSignOut} />}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className='min-h-screen'>
      <TopBar
        title={schoolName || siteName}
        subtitle={`${session.name || session.admissionNo} · ${session.streamName}`}
        right={
          <div className='flex items-center gap-2'>
            <NotificationBell
              session={session}
              onExpired={onSignOut}
              onOpenTab={(t) => {
                setTab(t as Tab);
                setReviewId('');
              }}
            />
            <Btn variant='secondary' onClick={signOut}>
              <LogOut className='h-4 w-4' />
              Sign out
            </Btn>
          </div>
        }
      />
      <main className='mx-auto max-w-5xl px-4 py-6'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>Welcome, {session.name || 'student'}</h1>
          <p className='text-sm text-slate-600'>
            Admission no. {session.admissionNo} · {session.streamName}
          </p>
        </div>
        <nav className='mb-6 mt-4 flex gap-1 overflow-x-auto border-b border-slate-200'>
          {tabs.map((t) => (
            <button
              key={t.key}
              type='button'
              onClick={() => {
                setTab(t.key);
                setReviewId('');
              }}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
                tab === t.key
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {body}
      </main>
    </div>
  );
}

