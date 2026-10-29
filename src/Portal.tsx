import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { auth } from './platform/client';
import { BookOpenCheck, School, ShieldCheck } from 'lucide-react';
import {
  api,
  errMsg,
  loadStudentSession,
  saveStudentSession,
  statusOf,
  type Stream,
  type StudentSession,
} from './lib';
import { Alert, Btn, Card, inputCls, labelCls, TopBar } from './ui';
import { useSiteName } from './site';
import StaffSignIn from './StaffSignIn';

const StudentHome = lazy(() => import('./StudentHome'));
const StaffArea = lazy(() => import('./StaffArea'));
const ParentHome = lazy(() => import('./ParentHome'));

function PageLoading() {
  return <div className='flex min-h-screen items-center justify-center text-sm text-slate-500'>Loading…</div>;
}

const LAST_SCHOOL_KEY = 'holiday-portal-last-school';

function readLastSchool(): string {
  try {
    return window.localStorage.getItem(LAST_SCHOOL_KEY) || '';
  } catch {
    return '';
  }
}

function writeLastSchool(name: string): void {
  try {
    window.localStorage.setItem(LAST_SCHOOL_KEY, name);
  } catch {
    // storage unavailable
  }
}

type FoundSchool = { id: string; name: string };

export default function Portal() {
  const siteName = useSiteName();
  const [session, setSession] = useState<StudentSession | null>(() => loadStudentSession());
  const [staffMode, setStaffMode] = useState<boolean>(() => auth.isSignedIn());
  const [schoolInput, setSchoolInput] = useState(() => readLastSchool());
  const [school, setSchool] = useState<FoundSchool | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [adm, setAdm] = useState('');
  const [streamId, setStreamId] = useState('');
  const [parentMode, setParentMode] = useState(false);
  const [pin, setPin] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  // Finish a sign-in coming back from Google or from a link in the email.
  useEffect(() => {
    let cancelled = false;
    auth
      .ready()
      .then(() => {
        if (!cancelled && auth.isSignedIn()) setStaffMode(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setAuthError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
      });
    const off = auth.onChange(() => {
      if (auth.isSignedIn()) setStaffMode(true);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const studentSignOut = useCallback(() => {
    saveStudentSession(null);
    setSession(null);
  }, []);

  const staffSignOut = useCallback(() => {
    setStaffMode(false);
  }, []);

  async function findSchool(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    const name = schoolInput.trim();
    if (!name) {
      setFormError('Enter your school name.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.get(`/api/schools/find?name=${encodeURIComponent(name)}`);
      const found = r.data.school as FoundSchool;
      setSchool(found);
      setStreams((r.data.streams || []) as Stream[]);
      setStreamId('');
      setSchoolInput(found.name);
      writeLastSchool(found.name);
    } catch (err) {
      const st = statusOf(err);
      setFormError(
        st >= 400 && st < 500 ? errMsg(err, 'School not found.') : 'Could not look up the school. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function studentSignIn(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!school) return;
    if (!adm.trim()) {
      setFormError('Enter your admission number.');
      return;
    }
    if (!streamId) {
      setFormError('Select your class / stream.');
      return;
    }
    if (parentMode && !/^[0-9]{4,8}$/.test(pin.trim())) {
      setFormError('Enter the parent PIN (4 to 8 digits) your child set up.');
      return;
    }
    setBusy(true);
    try {
      const r = parentMode
        ? await api.post('/api/parent/login', { schoolId: school.id, admissionNo: adm, streamId, pin: pin.trim() })
        : await api.post('/api/student/login', { schoolId: school.id, admissionNo: adm, streamId });
      setPin('');
      const s: StudentSession = { token: r.data.token, ...r.data.student };
      saveStudentSession(s);
      setSession(s);
      setAdm('');
    } catch (err) {
      setFormError(errMsg(err, 'Could not sign you in. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <Suspense fallback={<PageLoading />}>
        {session.role === 'parent' ? (
          <ParentHome session={session} onSignOut={studentSignOut} />
        ) : (
          <StudentHome session={session} schoolName={session.schoolName || ''} onSignOut={studentSignOut} />
        )}
      </Suspense>
    );
  }

  if (staffMode) {
    return (
      <Suspense fallback={<PageLoading />}>
        <StaffArea onSignOut={staffSignOut} />
      </Suspense>
    );
  }

  return (
    <div className='min-h-screen'>
      <TopBar title={siteName} subtitle='Keep learning through the holidays' />
      <main className='mx-auto max-w-5xl px-4 py-8'>
        <div className='mb-8 max-w-2xl'>
          <h1 className='text-2xl font-bold text-slate-900 sm:text-3xl'>Holiday learning from your own teachers</h1>
          <p className='mt-2 text-slate-600'>
            Schools use this portal to share notes, revision work and timed exams with their students during the
            holidays.
          </p>
        </div>
        <div className='grid gap-6 md:grid-cols-2'>
          {/* Shown second: teachers and principals come first on the page. */}
          <Card className='order-2'>
            <div className='flex items-center gap-2'>
              <BookOpenCheck className='h-5 w-5 text-emerald-700' />
              <h2 className='text-lg font-bold text-slate-900'>{parentMode ? 'Parents' : 'Students'}</h2>
            </div>
            {!school ? (
              <form onSubmit={findSchool} noValidate className='mt-3 space-y-4'>
                <p className='text-sm text-slate-600'>
                  {parentMode
                    ? 'Follow your child’s marks, assignments and notices. Start with the name of their school.'
                    : 'Start by entering the name of your school.'}
                </p>
                <div>
                  <label htmlFor='school' className={labelCls}>
                    School name
                  </label>
                  <input
                    id='school'
                    className={inputCls}
                    placeholder='Type your school name'
                    value={schoolInput}
                    autoComplete='organization'
                    onChange={(e) => setSchoolInput(e.target.value)}
                  />
                </div>
                {formError && <Alert>{formError}</Alert>}
                <Btn type='submit' disabled={busy} className='w-full'>
                  {busy ? 'Searching…' : 'Find my school'}
                </Btn>
              </form>
            ) : (
              <form onSubmit={studentSignIn} noValidate className='mt-3 space-y-4'>
                <div className='flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <School className='h-4 w-4 shrink-0 text-emerald-700' />
                    <span className='truncate text-sm font-semibold text-emerald-900'>{school.name}</span>
                  </div>
                  <button
                    type='button'
                    className='shrink-0 text-sm font-semibold text-emerald-700 hover:underline'
                    onClick={() => {
                      setSchool(null);
                      setFormError('');
                    }}
                  >
                    Change school
                  </button>
                </div>
                <div>
                  <label htmlFor='adm' className={labelCls}>
                    Admission number
                  </label>
                  <input
                    id='adm'
                    className={inputCls}
                    placeholder='Admission number'
                    value={adm}
                    autoComplete='off'
                    onChange={(e) => setAdm(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor='stream' className={labelCls}>
                    Class / stream
                  </label>
                  <select id='stream' className={inputCls} value={streamId} onChange={(e) => setStreamId(e.target.value)}>
                    <option value=''>{streams.length ? 'Select your class / stream' : 'No classes set up yet'}</option>
                    {streams.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                {parentMode && (
                  <div>
                    <label htmlFor='parent-pin' className={labelCls}>
                      Parent PIN
                    </label>
                    <input
                      id='parent-pin'
                      type='password'
                      inputMode='numeric'
                      className={inputCls}
                      placeholder='The PIN your child set up'
                      value={pin}
                      autoComplete='off'
                      onChange={(e) => setPin(e.target.value)}
                    />
                    <p className='mt-1 text-xs text-slate-500'>
                      Your child sets this PIN in their Report card tab, then shares it with you.
                    </p>
                  </div>
                )}
                {formError && <Alert>{formError}</Alert>}
                <Btn type='submit' disabled={busy} className='w-full'>
                  {busy ? 'Opening…' : parentMode ? 'View my child’s progress' : 'Open my materials'}
                </Btn>
              </form>
            )}
            <button
              type='button'
              className='mt-4 text-sm font-semibold text-emerald-700 hover:underline'
              onClick={() => {
                setParentMode((v) => !v);
                setFormError('');
                setPin('');
              }}
            >
              {parentMode ? 'I am a student' : 'I am a parent: view my child’s progress'}
            </button>
          </Card>
          <Card className='order-1 flex flex-col'>
            <div className='flex items-center gap-2'>
              <ShieldCheck className='h-5 w-5 text-emerald-700' />
              <h2 className='text-lg font-bold text-slate-900'>Teachers & principals</h2>
            </div>
            <p className='mt-3 text-sm text-slate-600'>
              Sign in with your email address. Teachers join a school that is already on the portal. Principals can
              register a new school, which the site owner approves.
            </p>
            <ol className='mt-4 space-y-2 text-sm text-slate-700'>
              <li>1. Principals register the school, set up classes and approve teachers.</li>
              <li>2. Teachers find their school by name and ask to join.</li>
              <li>3. Approved teachers add students, post materials and set exams.</li>
            </ol>
            <div className='mt-auto pt-6'>
              <StaffSignIn initialError={authError} onSignedIn={() => setStaffMode(true)} />
            </div>
          </Card>
        </div>
        <footer className='mt-10 flex flex-wrap gap-4 text-xs text-slate-500'>
          <a href='/privacy.html' className='hover:underline'>
            Privacy policy
          </a>
          <a href='/terms.html' className='hover:underline'>
            Terms of use
          </a>
        </footer>
      </main>
    </div>
  );
}

