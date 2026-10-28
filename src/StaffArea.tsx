import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { auth } from './platform/client';
import { Building2, Clock, LogOut, PauseCircle, RefreshCw, School, User } from 'lucide-react';
import { api, errMsg, statusOf, type Stream, type Teacher } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner, StreamPicker, TopBar } from './ui';
import Materials from './Materials';
import Students from './Students';
import Exams from './Exams';
import Assignments from './Assignments';
import Teachers from './Teachers';
import SchoolSetup from './SchoolSetup';
import Announcements from './Announcements';
import TeacherQuestions from './TeacherQuestions';
import MarkSheet from './MarkSheet';
import PrincipalOverview from './PrincipalOverview';
import PromoteStudents from './PromoteStudents';
import StaffAlerts from './StaffAlerts';
import { useSiteName } from './site';

const Owner = lazy(() => import('./Owner'));

type Role =
  | 'owner'
  | 'principal'
  | 'principal-pending'
  | 'principal-rejected'
  | 'suspended'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'unregistered';

type SchoolInfo = { id: string; name: string; status: string };
type PrincipalRequest = { schoolName: string; principalName: string; phone: string; status: string };

type Me = {
  role: Role;
  email: string;
  name: string;
  teacher: Teacher | null;
  school: SchoolInfo | null;
  streams: Stream[];
  myStreamIds: string[];
  principalRequest: PrincipalRequest | null;
};

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Site owner',
  principal: 'Principal',
  'principal-pending': 'Principal (awaiting approval)',
  'principal-rejected': 'Principal',
  suspended: 'Account paused',
  approved: 'Teacher',
  pending: 'Teacher (awaiting approval)',
  rejected: 'Teacher',
  unregistered: 'New account',
};

export default function StaffArea({ onSignOut }: { onSignOut: () => void }) {
  const siteName = useSiteName();
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('');

  const signOut = useCallback(async () => {
    try {
      await auth.signOut();
    } catch {
      // already signed out
    }
    onSignOut();
  }, [onSignOut]);

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await api.get('/api/me');
      setMe(r.data as Me);
    } catch (e) {
      if (statusOf(e) === 401) {
        await signOut();
        return;
      }
      setErr(errMsg(e, 'Could not load your account. Please try again.'));
    }
  }, [signOut]);

  useEffect(() => {
    load();
  }, [load]);

  const role = me?.role;
  const isPrincipal = role === 'principal';
  const tabs = isPrincipal
    ? ['Overview', 'Teachers', 'School setup', 'Move students up', 'Announcements']
    : ['Materials', 'Assignments', 'Exams', 'Students', 'Mark sheet', 'Announcements', 'Questions'];
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  const myStreams = me ? me.streams.filter((s) => me.myStreamIds.includes(s.id)) : [];
  const firstSubject = (me?.teacher?.subjects || '').split(',')[0].trim();

  let content: ReactNode;
  if (err) {
    content = (
      <div className='space-y-3'>
        <Alert>{err}</Alert>
        <Btn onClick={load}>Try again</Btn>
      </div>
    );
  } else if (!me) {
    content = <Spinner />;
  } else if (me.role === 'owner') {
    content = (
      <Suspense fallback={<Spinner />}>
        <Owner />
      </Suspense>
    );
  } else if (me.role === 'principal' || me.role === 'approved') {
    content = (
      <div>
        <p className='text-sm text-slate-500'>Welcome</p>
        <h1 className='text-xl font-bold text-slate-900'>{me.name}</h1>
        <nav className='mb-6 mt-4 flex gap-1 overflow-x-auto border-b border-slate-200'>
          {tabs.map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => setTab(t)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
                activeTab === t
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        {activeTab === 'Teachers' && <Teachers streams={me.streams} />}
        {activeTab === 'Overview' && <PrincipalOverview />}
        {activeTab === 'Move students up' && <PromoteStudents streams={me.streams} />}
        {activeTab === 'School setup' && (
          <SchoolSetup
            schoolName={me.school?.name || ''}
            streams={me.streams}
            onSchoolNameChange={() => load()}
            onChanged={load}
          />
        )}
        {activeTab === 'Materials' && (
          <Materials myStreams={myStreams} allStreams={me.streams} defaultSubject={firstSubject} />
        )}
        {activeTab === 'Exams' && <Exams myStreams={myStreams} allStreams={me.streams} defaultSubject={firstSubject} />}
        {activeTab === 'Students' && <Students streams={myStreams} />}
        {activeTab === 'Assignments' && (
          <Assignments myStreams={myStreams} allStreams={me.streams} defaultSubject={firstSubject} />
        )}
        {activeTab === 'Announcements' && (
          <Announcements streams={isPrincipal ? me.streams : myStreams} allStreams={me.streams} />
        )}
        {activeTab === 'Questions' && <TeacherQuestions allStreams={me.streams} />}
        {activeTab === 'Mark sheet' && <MarkSheet streams={myStreams} />}
      </div>
    );
  } else if (me.role === 'pending') {
    content = <TeacherPending me={me} onCheck={load} />;
  } else if (me.role === 'principal-pending') {
    content = <PrincipalPending me={me} onDone={load} />;
  } else if (me.role === 'suspended') {
    content = <Suspended me={me} />;
  } else {
    content = <Onboarding me={me} onDone={load} />;
  }

  const title = me && me.role !== 'owner' && me.school && me.school.status === 'approved' ? me.school.name : siteName;

  return (
    <div className='min-h-screen'>
      <TopBar
        title={title}
        subtitle={me ? `${ROLE_LABEL[me.role]} · ${me.email}` : 'Staff area'}
        right={
          <div className='flex items-center gap-2'>
            {me && <StaffAlerts />}
          <Btn variant='secondary' onClick={signOut}>
            <LogOut className='h-4 w-4' />
            Sign out
          </Btn>
          </div>
        }
      />
      <main className='mx-auto max-w-5xl px-4 py-6'>{content}</main>
    </div>
  );
}

// ---------- onboarding: choose teacher or principal ----------

function Onboarding({ me, onDone }: { me: Me; onDone: () => void }) {
  const siteName = useSiteName();
  const [mode, setMode] = useState<'choose' | 'teacher' | 'principal'>(
    me.role === 'rejected' ? 'teacher' : me.role === 'principal-rejected' ? 'principal' : 'choose',
  );
  const back = me.role === 'unregistered' ? () => setMode('choose') : undefined;

  if (mode === 'teacher') return <TeacherJoin me={me} onDone={onDone} onBack={back} />;
  if (mode === 'principal') return <PrincipalRequestForm me={me} onDone={onDone} onBack={back} />;

  return (
    <Card className='mx-auto max-w-2xl'>
      <h1 className='text-xl font-bold text-slate-900'>Welcome to {siteName}</h1>
      <p className='mt-1 text-sm text-slate-600'>Signed in as {me.email}. How will you use the portal?</p>
      <div className='mt-5 grid gap-4 sm:grid-cols-2'>
        <button
          type='button'
          onClick={() => setMode('teacher')}
          className='rounded-xl border border-slate-200 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50'
        >
          <User className='h-6 w-6 text-emerald-700' />
          <div className='mt-2 font-bold text-slate-900'>I am a teacher</div>
          <p className='mt-1 text-sm text-slate-600'>
            Find your school and ask the principal to approve you, then share materials and exams with your students.
          </p>
        </button>
        <button
          type='button'
          onClick={() => setMode('principal')}
          className='rounded-xl border border-slate-200 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50'
        >
          <Building2 className='h-6 w-6 text-emerald-700' />
          <div className='mt-2 font-bold text-slate-900'>I am a principal</div>
          <p className='mt-1 text-sm text-slate-600'>
            Register your school on the portal. The site owner reviews and approves new schools.
          </p>
        </button>
      </div>
    </Card>
  );
}

// ---------- teacher: find school, then register ----------

type FoundSchool = { id: string; name: string };

function TeacherJoin({ me, onDone, onBack }: { me: Me; onDone: () => void; onBack?: () => void }) {
  const startSchool = me.role === 'rejected' && me.school ? { id: me.school.id, name: me.school.name } : null;
  const [school, setSchool] = useState<FoundSchool | null>(startSchool);
  const [streams, setStreams] = useState<Stream[]>(startSchool ? me.streams : []);

  if (!school) {
    return (
      <FindSchool
        onBack={onBack}
        onFound={(s, st) => {
          setSchool(s);
          setStreams(st);
        }}
      />
    );
  }
  return <RegisterForm me={me} school={school} streams={streams} onChangeSchool={() => setSchool(null)} onDone={onDone} />;
}

function FindSchool({
  onFound,
  onBack,
}: {
  onFound: (school: FoundSchool, streams: Stream[]) => void;
  onBack?: () => void;
}) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) {
      setErr('Enter the name of your school.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.get(`/api/schools/find?name=${encodeURIComponent(name.trim())}`);
      setBusy(false);
      onFound(r.data.school as FoundSchool, (r.data.streams || []) as Stream[]);
    } catch (ex) {
      const st = statusOf(ex);
      setErr(st >= 400 && st < 500 ? errMsg(ex, 'School not found.') : 'Could not look up the school. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Card className='mx-auto max-w-xl'>
      <form onSubmit={submit} noValidate className='space-y-4'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>Find your school</h1>
          <p className='mt-1 text-sm text-slate-600'>
            Enter the name of the school you teach at. It must already be registered on the portal by your principal.
          </p>
        </div>
        <div>
          <label htmlFor='find-school' className={labelCls}>
            School name
          </label>
          <input
            id='find-school'
            className={inputCls}
            value={name}
            placeholder='Type the school name'
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {err && <Alert>{err}</Alert>}
        <div className='flex flex-wrap gap-2'>
          <Btn type='submit' disabled={busy}>
            {busy ? 'Searching…' : 'Find school'}
          </Btn>
          {onBack && (
            <Btn variant='ghost' onClick={onBack}>
              Back
            </Btn>
          )}
        </div>
      </form>
    </Card>
  );
}

function RegisterForm({
  me,
  school,
  streams,
  onChangeSchool,
  onDone,
}: {
  me: Me;
  school: FoundSchool;
  streams: Stream[];
  onChangeSchool: () => void;
  onDone: () => void;
}) {
  const t = me.teacher;
  const [name, setName] = useState(t?.name || (me.name && !me.name.includes('@') ? me.name : ''));
  const [phone, setPhone] = useState(t?.phone || '');
  const [subjects, setSubjects] = useState(t?.subjects || '');
  const [streamIds, setStreamIds] = useState<string[]>(
    (t?.streamIds || []).filter((id) => streams.some((s) => s.id === id)),
  );
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) {
      setErr('Enter your full name.');
      return;
    }
    if (!subjects.trim()) {
      setErr('Enter the subjects you teach.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/teacher/register', { schoolId: school.id, name, phone, subjects, streamIds });
      onDone();
    } catch (ex) {
      setErr(errMsg(ex, 'Could not submit your registration. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <Card className='mx-auto max-w-xl'>
      <form onSubmit={submit} noValidate className='space-y-4'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>Register as a teacher</h1>
          <p className='mt-1 text-sm text-slate-600'>
            Signed in as {me.email}. Your account will be active after the principal approves it.
          </p>
        </div>
        <div className='flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <School className='h-4 w-4 shrink-0 text-emerald-700' />
            <span className='truncate text-sm font-semibold text-emerald-900'>Joining {school.name}</span>
          </div>
          <button
            type='button'
            onClick={onChangeSchool}
            className='shrink-0 text-sm font-semibold text-emerald-700 hover:underline'
          >
            Change school
          </button>
        </div>
        {me.role === 'rejected' && (
          <Alert kind='info'>Your earlier request was not approved. You can update your details and send it again.</Alert>
        )}
        <div>
          <label htmlFor='t-name' className={labelCls}>
            Full name
          </label>
          <input id='t-name' className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor='t-phone' className={labelCls}>
            Phone number
          </label>
          <input
            id='t-phone'
            className={inputCls}
            value={phone}
            inputMode='tel'
            placeholder='Optional'
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor='t-subjects' className={labelCls}>
            Subjects you teach
          </label>
          <input
            id='t-subjects'
            className={inputCls}
            value={subjects}
            placeholder='e.g. Mathematics, Physics'
            onChange={(e) => setSubjects(e.target.value)}
          />
        </div>
        <div>
          <span className={labelCls}>Classes / streams you teach</span>
          <StreamPicker streams={streams} value={streamIds} onChange={setStreamIds} />
          <p className='mt-1 text-xs text-slate-500'>The principal can adjust these when approving your account.</p>
        </div>
        {err && <Alert>{err}</Alert>}
        <Btn type='submit' disabled={saving} className='w-full'>
          {saving ? 'Submitting…' : 'Submit for approval'}
        </Btn>
      </form>
    </Card>
  );
}

function TeacherPending({ me, onCheck }: { me: Me; onCheck: () => void }) {
  const requested = me.streams.filter((s) => (me.teacher?.streamIds || []).includes(s.id)).map((s) => s.name);
  return (
    <Card className='mx-auto max-w-xl text-center'>
      <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700'>
        <Clock className='h-6 w-6' />
      </div>
      <h1 className='mt-3 text-xl font-bold text-slate-900'>Waiting for approval from the principal</h1>
      <p className='mt-2 text-sm text-slate-600'>
        Thank you, {me.teacher?.name}. Your request to join {me.school?.name || 'your school'} has been sent. Once the
        principal approves your account you will be able to share holiday work with your students.
      </p>
      <dl className='mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-left text-sm'>
        <div>
          <dt className='inline font-semibold text-slate-700'>School: </dt>
          <dd className='inline text-slate-600'>{me.school?.name}</dd>
        </div>
        <div>
          <dt className='inline font-semibold text-slate-700'>Subjects: </dt>
          <dd className='inline text-slate-600'>{me.teacher?.subjects || 'Not given'}</dd>
        </div>
        <div>
          <dt className='inline font-semibold text-slate-700'>Classes requested: </dt>
          <dd className='inline text-slate-600'>{requested.length ? requested.join(', ') : 'None selected'}</dd>
        </div>
      </dl>
      <Btn variant='secondary' onClick={onCheck} className='mt-4'>
        <RefreshCw className='h-4 w-4' />
        Check again
      </Btn>
    </Card>
  );
}

// ---------- principal: register a school ----------

function PrincipalRequestForm({ me, onDone, onBack }: { me: Me; onDone: () => void; onBack?: () => void }) {
  const req = me.principalRequest;
  const [principalName, setPrincipalName] = useState(
    req?.principalName || (me.name && !me.name.includes('@') ? me.name : ''),
  );
  const [phone, setPhone] = useState(req?.phone || '');
  const [schoolName, setSchoolName] = useState(req?.schoolName || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!principalName.trim()) {
      setErr('Enter your full name.');
      return;
    }
    if (!schoolName.trim()) {
      setErr('Enter the name of your school.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/principal/request', { principalName, phone, schoolName });
      onDone();
    } catch (ex) {
      setErr(errMsg(ex, 'Could not send your request. Please try again.'));
      setSaving(false);
    }
  }

  return (
    <Card className='mx-auto max-w-xl'>
      <form onSubmit={submit} noValidate className='space-y-4'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>Register your school</h1>
          <p className='mt-1 text-sm text-slate-600'>
            Signed in as {me.email}. The site owner will review your request. Once approved, you can set up classes and
            approve your teachers.
          </p>
        </div>
        {me.role === 'principal-rejected' && (
          <Alert kind='info'>Your earlier request was not approved. You can correct the details and send it again.</Alert>
        )}
        <div>
          <label htmlFor='p-name' className={labelCls}>
            Your full name
          </label>
          <input id='p-name' className={inputCls} value={principalName} onChange={(e) => setPrincipalName(e.target.value)} />
        </div>
        <div>
          <label htmlFor='p-phone' className={labelCls}>
            Phone number
          </label>
          <input
            id='p-phone'
            className={inputCls}
            value={phone}
            inputMode='tel'
            placeholder='Optional'
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor='p-school' className={labelCls}>
            School name
          </label>
          <input
            id='p-school'
            className={inputCls}
            value={schoolName}
            placeholder='e.g. Kilimani Primary School'
            onChange={(e) => setSchoolName(e.target.value)}
          />
          <p className='mt-1 text-xs text-slate-500'>
            Teachers and students will type this name to find your school, so use the full official name. You can
            change it later.
          </p>
        </div>
        {err && <Alert>{err}</Alert>}
        <div className='flex flex-wrap gap-2'>
          <Btn type='submit' disabled={saving}>
            {saving ? 'Sending…' : 'Send request'}
          </Btn>
          {onBack && (
            <Btn variant='ghost' onClick={onBack}>
              Back
            </Btn>
          )}
        </div>
      </form>
    </Card>
  );
}

function PrincipalPending({ me, onDone }: { me: Me; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <PrincipalRequestForm me={me} onDone={() => { setEditing(false); onDone(); }} onBack={() => setEditing(false)} />;
  return (
    <Card className='mx-auto max-w-xl text-center'>
      <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700'>
        <Clock className='h-6 w-6' />
      </div>
      <h1 className='mt-3 text-xl font-bold text-slate-900'>Your school is waiting for approval</h1>
      <p className='mt-2 text-sm text-slate-600'>
        Thank you, {me.principalRequest?.principalName}. The site owner will review your request to register{' '}
        <span className='font-semibold'>{me.principalRequest?.schoolName}</span>. You will be able to set up classes and
        approve teachers once it is approved.
      </p>
      <div className='mt-4 flex flex-wrap justify-center gap-2'>
        <Btn variant='secondary' onClick={onDone}>
          <RefreshCw className='h-4 w-4' />
          Check again
        </Btn>
        <Btn variant='ghost' onClick={() => setEditing(true)}>
          Edit request
        </Btn>
      </div>
    </Card>
  );
}

function Suspended({ me }: { me: Me }) {
  return (
    <Card className='mx-auto max-w-xl text-center'>
      <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600'>
        <PauseCircle className='h-6 w-6' />
      </div>
      <h1 className='mt-3 text-xl font-bold text-slate-900'>This school’s account is paused</h1>
      <p className='mt-2 text-sm text-slate-600'>
        {me.school?.name || 'Your school'} is paused on the portal, so it cannot be used right now. Please contact the
        site owner for help.
      </p>
    </Card>
  );
}

