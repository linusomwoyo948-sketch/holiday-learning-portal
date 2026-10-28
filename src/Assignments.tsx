import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  Download,
  Laptop,
  NotebookPen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  api,
  downloadExcel,
  errMsg,
  fmtDateTime,
  fmtSize,
  MAX_FILE_BYTES,
  safeFileTitle,
  uploadFileInParts,
  type Stream,
} from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner, StreamPicker } from './ui';
import StreamChooser from './StreamChooser';

type FileInfo = { path: string; name: string; contentType: string; size: number; url?: string };
type Mode = 'portal' | 'paper';

type AssignmentSummary = {
  id: string;
  title: string;
  subject: string;
  streamIds: string[];
  dueAt: string;
  totalMarks: number;
  createdAt: string;
  hasFile: boolean;
  submitted: number;
  marked: number;
  submissionMode: Mode;
  parentDone?: number;
  parentNotDone?: number;
};

type AssignmentDetail = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  teacherName: string;
  streamIds: string[];
  dueAt: string;
  totalMarks: number;
  createdAt: string;
  attachment: FileInfo | null;
  submissionMode?: Mode;
};

type Sub = {
  id: string;
  studentName: string;
  admissionNo: string;
  streamId: string;
  answer: string;
  attachment: FileInfo | null;
  submittedAt: string;
  late: boolean;
  marks: number | null;
  feedback: string;
};

type Missing = { name: string; admissionNo: string; streamId: string };
type ParentCheck = {
  studentId: string;
  name: string;
  admissionNo: string;
  streamId: string;
  status: 'done' | 'not_done' | 'none';
  note: string;
  checkedAt: string;
};

type Props = {
  myStreams: Stream[];
  allStreams: Stream[];
  defaultSubject: string;
};

const linkCls =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100';

function FileLink({ file }: { file: FileInfo }) {
  if (!file.url) return null;
  return (
    <a href={file.url} target='_blank' rel='noreferrer' download={file.name} className={linkCls}>
      <Paperclip className='h-4 w-4 shrink-0' />
      <span className='truncate'>{file.name}</span>
      <span className='shrink-0 font-normal text-emerald-700'>({fmtSize(file.size)})</span>
    </a>
  );
}

function dueText(dueAt: string): string {
  return dueAt ? `Due ${fmtDateTime(dueAt)}` : 'No due date';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export default function Assignments({ myStreams, allStreams, defaultSubject }: Props) {
  const [mode, setMode] = useState<'list' | 'create' | 'review' | 'edit'>('list');
  const [selectedId, setSelectedId] = useState('');
  const [items, setItems] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const streamNames: Record<string, string> = {};
  allStreams.forEach((s) => {
    streamNames[s.id] = s.name;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/teacher/assignments');
      setItems((r.data?.assignments || []) as AssignmentSummary[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load your assignments.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'list') load();
  }, [mode, load]);

  async function remove(a: AssignmentSummary) {
    const extra = a.submitted
      ? ` The work submitted by ${a.submitted} student${a.submitted === 1 ? '' : 's'} will also be deleted.`
      : '';
    if (!window.confirm(`Delete the assignment “${a.title}”?${extra}`)) return;
    setDeletingId(a.id);
    setErr('');
    try {
      await api.delete(`/api/teacher/assignments/${a.id}`);
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setErr(errMsg(e, 'Could not delete the assignment.'));
    } finally {
      setDeletingId('');
    }
  }

  if (mode === 'create') {
    return (
      <AssignmentForm
        myStreams={myStreams}
        defaultSubject={defaultSubject}
        onCancel={() => setMode('list')}
        onCreated={(title) => {
          setNotice(`“${title}” has been sent. Students in the selected classes can see it in their Assignments tab.`);
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'edit' && selectedId) {
    return (
      <AssignmentEditLoader
        assignmentId={selectedId}
        myStreams={myStreams}
        defaultSubject={defaultSubject}
        onDone={(title) => {
          setNotice(title ? `Changes to “${title}” have been saved.` : '');
          setMode('list');
        }}
      />
    );
  }

  if (mode === 'review' && selectedId) {
    return <AssignmentReview assignmentId={selectedId} streamNames={streamNames} onBack={() => setMode('list')} />;
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-bold text-slate-900'>Assignments</h2>
          <p className='text-sm text-slate-600'>
            Send work to your classes. Students can print it or download it, and hand it in through the portal or on
            paper on opening day.
          </p>
        </div>
        <div className='flex gap-2'>
          <Btn variant='ghost' onClick={load} disabled={loading}>
            <RefreshCw className='h-4 w-4' />
            Refresh
          </Btn>
          {myStreams.length > 0 && (
            <Btn
              onClick={() => {
                setNotice('');
                setMode('create');
              }}
            >
              <Plus className='h-4 w-4' />
              New assignment
            </Btn>
          )}
        </div>
      </div>
      {myStreams.length === 0 && (
        <Alert kind='info'>
          You have not been assigned any class yet. Ask the principal to assign your classes before sending assignments.
        </Alert>
      )}
      {notice && <Alert kind='success'>{notice}</Alert>}
      {err && <Alert>{err}</Alert>}
      {loading && items.length === 0 ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card className='text-sm text-slate-500'>No assignments yet. Click New assignment to send your first one.</Card>
      ) : (
        items.map((a) => {
          const paper = a.submissionMode === 'paper';
          return (
            <Card key={a.id}>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
                      {a.subject}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        paper ? 'bg-slate-100 text-slate-700' : 'bg-sky-50 text-sky-800'
                      }`}
                    >
                      {paper ? 'On paper, opening day' : 'Through the portal'}
                    </span>
                  </div>
                  <h3 className='mt-2 break-words text-lg font-bold text-slate-900'>{a.title}</h3>
                  <p className='mt-1 flex items-center gap-1 text-sm text-slate-600'>
                    {paper ? <NotebookPen className='h-4 w-4 shrink-0' /> : <CalendarClock className='h-4 w-4 shrink-0' />}
                    {paper ? 'Students hand it in on paper on opening day' : dueText(a.dueAt)}
                  </p>
                  <p className='text-xs text-slate-500'>
                    Sent {fmtDateTime(a.createdAt)} · For{' '}
                    {a.streamIds.map((id) => streamNames[id] || 'removed class').join(', ')}
                    {a.totalMarks ? ` · ${a.totalMarks} marks` : ''}
                    {a.hasFile ? ' · File attached' : ''}
                  </p>
                </div>
                <div className='text-right text-sm'>
                  {!paper && (
                    <>
                      <div className='font-semibold text-slate-800'>{a.submitted} submitted</div>
                      <div className='text-emerald-700'>{a.marked} marked</div>
                    </>
                  )}
                  <div className='text-slate-700'>
                    {a.parentDone || 0} parent{(a.parentDone || 0) === 1 ? '' : 's'} confirmed
                  </div>
                  {(a.parentNotDone || 0) > 0 && (
                    <div className='text-red-700'>{a.parentNotDone} said not done</div>
                  )}
                </div>
              </div>
              <div className='mt-4 flex flex-wrap gap-2'>
                <Btn
                  onClick={() => {
                    setSelectedId(a.id);
                    setMode('review');
                  }}
                >
                  <ClipboardList className='h-4 w-4' />
                  {paper ? 'Parent checks' : 'Submissions and parent checks'}
                </Btn>
                <Btn
                  variant='secondary'
                  onClick={() => {
                    setNotice('');
                    setSelectedId(a.id);
                    setMode('edit');
                  }}
                >
                  <Pencil className='h-4 w-4' />
                  Edit
                </Btn>
                <Btn variant='danger' disabled={deletingId === a.id} onClick={() => remove(a)}>
                  <Trash2 className='h-4 w-4' />
                  Delete
                </Btn>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

function AssignmentEditLoader({
  assignmentId,
  myStreams,
  defaultSubject,
  onDone,
}: {
  assignmentId: string;
  myStreams: Stream[];
  defaultSubject: string;
  onDone: (title: string) => void;
}) {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/teacher/assignments/${assignmentId}/submissions`)
      .then((r) => {
        if (!cancelled) setDetail(r.data.assignment as AssignmentDetail);
      })
      .catch((e) => {
        if (!cancelled) setErr(errMsg(e, 'Could not open the assignment.'));
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  if (err) {
    return (
      <div className='space-y-3'>
        <Btn variant='ghost' onClick={() => onDone('')}>
          <ArrowLeft className='h-4 w-4' />
          Back to assignments
        </Btn>
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!detail) return <Spinner label='Opening the assignment…' />;
  return (
    <AssignmentForm
      myStreams={myStreams}
      defaultSubject={defaultSubject}
      initial={detail}
      onCancel={() => onDone('')}
      onCreated={(title) => onDone(title)}
    />
  );
}

function AssignmentForm({
  myStreams,
  defaultSubject,
  onCancel,
  onCreated,
  initial,
}: {
  myStreams: Stream[];
  defaultSubject: string;
  onCancel: () => void;
  onCreated: (title: string) => void;
  initial?: AssignmentDetail;
}) {
  const due = initial && initial.dueAt ? new Date(initial.dueAt) : null;
  const [title, setTitle] = useState(initial ? initial.title : '');
  const [subject, setSubject] = useState(initial ? initial.subject : defaultSubject);
  const [streamIds, setStreamIds] = useState<string[]>(
    initial
      ? initial.streamIds.filter((id) => myStreams.some((s) => s.id === id))
      : myStreams.length === 1
        ? [myStreams[0].id]
        : [],
  );
  const [instructions, setInstructions] = useState(initial ? initial.instructions || '' : '');
  const [submissionMode, setSubmissionMode] = useState<Mode>(initial && initial.submissionMode === 'paper' ? 'paper' : 'portal');
  const [dueDate, setDueDate] = useState(
    due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` : '',
  );
  const [dueTime, setDueTime] = useState(due ? `${pad(due.getHours())}:${pad(due.getMinutes())}` : '17:00');
  const [totalMarks, setTotalMarks] = useState(initial && initial.totalMarks ? String(initial.totalMarks) : '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [uploadPct, setUploadPct] = useState(-1);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!title.trim()) {
      setErr('Give the assignment a title.');
      return;
    }
    if (!subject.trim()) {
      setErr('Enter the subject.');
      return;
    }
    if (!streamIds.length) {
      setErr('Choose at least one class / stream.');
      return;
    }
    const keepsFile = !!initial && !!initial.attachment && !removeFile;
    if (!instructions.trim() && !file && !keepsFile) {
      setErr('Write the assignment questions or attach a file.');
      return;
    }
    if (file && file.size > MAX_FILE_BYTES) {
      setErr(`This file is ${fmtSize(file.size)}. Files must be 20 MB or smaller.`);
      return;
    }
    let dueAt = '';
    if (submissionMode === 'portal' && dueDate) {
      const d = new Date(`${dueDate}T${dueTime || '23:59'}`);
      if (Number.isNaN(d.getTime())) {
        setErr('The due date is not valid.');
        return;
      }
      const unchanged = !!due && Math.abs(d.getTime() - due.getTime()) < 60000;
      if (!unchanged && d.getTime() <= Date.now()) {
        setErr('The due date has already passed. Choose a later date.');
        return;
      }
      dueAt = d.toISOString();
    }
    if (totalMarks.trim() && !(Number(totalMarks) >= 0 && Number(totalMarks) <= 1000)) {
      setErr('Total marks must be between 0 and 1000.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title,
        subject,
        instructions,
        streamIds,
        submissionMode,
        dueAt,
        removeFile,
        totalMarks: totalMarks.trim() ? Number(totalMarks) : '',
      };
      if (file) {
        payload.file = {
          contentType: file.type || 'application/octet-stream',
          ...(await uploadFileInParts(file, 'teacher', '', setUploadPct)),
        };
      }
      if (initial) await api.put(`/api/teacher/assignments/${initial.id}`, payload);
      else await api.post('/api/teacher/assignments', payload);
      onCreated(title.trim());
    } catch (ex) {
      setErr(errMsg(ex, 'Could not save the assignment. Please try again.'));
      setSaving(false);
    }
  }

  const modeOptions: Array<{ key: Mode; title: string; text: string; icon: ReactElement }> = [
    {
      key: 'portal',
      title: 'Through the portal',
      text: 'Students type their answers or upload their work here. You can set a due date and mark it online.',
      icon: <Laptop className='h-5 w-5 text-emerald-700' />,
    },
    {
      key: 'paper',
      title: 'On paper on opening day',
      text: 'Students print or download it, do it on paper and hand it in when school opens. There is no online submission.',
      icon: <NotebookPen className='h-5 w-5 text-emerald-700' />,
    },
  ];

  const busyLabel = uploadPct >= 0 ? `Uploading file ${uploadPct}%…` : 'Saving…';

  return (
    <form onSubmit={submit} noValidate className='space-y-4'>
      <Btn variant='ghost' onClick={onCancel}>
        <ArrowLeft className='h-4 w-4' />
        Back to assignments
      </Btn>
      <Card>
        <h2 className='text-lg font-bold text-slate-900'>{initial ? 'Edit assignment' : 'New assignment'}</h2>
        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
          <div className='sm:col-span-2'>
            <label htmlFor='as-title' className={labelCls}>
              Title
            </label>
            <input
              id='as-title'
              className={inputCls}
              value={title}
              placeholder='e.g. Holiday assignment 1: Fractions'
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='as-subject' className={labelCls}>
              Subject
            </label>
            <input id='as-subject' className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <span className={labelCls}>Classes / streams</span>
            <StreamPicker streams={myStreams} value={streamIds} onChange={setStreamIds} />
          </div>
          <div className='sm:col-span-2'>
            <label htmlFor='as-instructions' className={labelCls}>
              Questions and instructions
            </label>
            <textarea
              id='as-instructions'
              rows={10}
              className={inputCls}
              value={instructions}
              placeholder='Type the assignment questions and any instructions for your students'
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='as-marks' className={labelCls}>
              Total marks (optional)
            </label>
            <input
              id='as-marks'
              type='number'
              min={0}
              max={1000}
              className={inputCls}
              value={totalMarks}
              onChange={(e) => setTotalMarks(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor='as-file' className={labelCls}>
              {initial && initial.attachment ? 'Replace the file (optional)' : 'Attach a file (optional)'}
            </label>
            {initial && initial.attachment && !file && (
              <div className='mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-700'>
                {removeFile ? (
                  <>
                    <span className='text-red-700'>The current file will be removed.</span>
                    <button
                      type='button'
                      className='font-semibold text-emerald-700 hover:underline'
                      onClick={() => setRemoveFile(false)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <>
                    <span>
                      Current file: <span className='font-semibold'>{initial.attachment.name}</span>
                    </span>
                    <button
                      type='button'
                      className='font-semibold text-red-700 hover:underline'
                      onClick={() => setRemoveFile(true)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            )}
            <input
              id='as-file'
              type='file'
              accept='.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*'
              className='block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-800'
              onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            />
            <p className='mt-1 text-xs text-slate-500'>For example a worksheet in PDF or Word, up to 20 MB.</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className='text-lg font-bold text-slate-900'>How will students hand it in?</h2>
        <div className='mt-4 grid gap-3 sm:grid-cols-2' role='radiogroup' aria-label='How students hand in the assignment'>
          {modeOptions.map((o) => {
            const on = submissionMode === o.key;
            return (
              <button
                key={o.key}
                type='button'
                role='radio'
                aria-checked={on}
                onClick={() => setSubmissionMode(o.key)}
                className={`rounded-xl border p-4 text-left transition ${
                  on ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-emerald-300'
                }`}
              >
                <div className='flex items-center gap-2'>
                  {o.icon}
                  <span className='font-bold text-slate-900'>{o.title}</span>
                </div>
                <p className='mt-1 text-sm text-slate-600'>{o.text}</p>
              </button>
            );
          })}
        </div>
        {submissionMode === 'portal' ? (
          <div className='mt-4 grid gap-4 sm:grid-cols-2'>
            <div>
              <label htmlFor='as-due-date' className={labelCls}>
                Due date (optional)
              </label>
              <input
                id='as-due-date'
                type='date'
                className={inputCls}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor='as-due-time' className={labelCls}>
                Due time
              </label>
              <input
                id='as-due-time'
                type='time'
                className={inputCls}
                value={dueTime}
                disabled={!dueDate}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <p className='mt-4 text-sm text-slate-600'>
            No due time is set. Students will see that this assignment is to be handed in on paper on opening day.
          </p>
        )}
      </Card>

      {err && <Alert>{err}</Alert>}
      <Btn type='submit' disabled={saving}>
        <Send className='h-4 w-4' />
        {saving ? busyLabel : initial ? 'Save changes' : 'Send to students'}
      </Btn>
    </form>
  );
}

function AssignmentReview({
  assignmentId,
  streamNames,
  onBack,
}: {
  assignmentId: string;
  streamNames: Record<string, string>;
  onBack: () => void;
}) {
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [checks, setChecks] = useState<ParentCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState('');
  const [chosen, setChosen] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get(`/api/teacher/assignments/${assignmentId}/submissions`);
      setAssignment(r.data.assignment as AssignmentDetail);
      setSubs((r.data.submissions || []) as Sub[]);
      setMissing((r.data.notSubmitted || []) as Missing[]);
      setChecks((r.data.parentChecks || []) as ParentCheck[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load the submissions.'));
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !assignment) return <Spinner />;
  if (!assignment) {
    return (
      <div className='space-y-3'>
        <Btn variant='ghost' onClick={onBack}>
          <ArrowLeft className='h-4 w-4' />
          Back to assignments
        </Btn>
        {err && <Alert>{err}</Alert>}
      </div>
    );
  }

  const single = assignment.streamIds.length === 1;
  const paper = assignment.submissionMode === 'paper';
  const streamId = single ? assignment.streamIds[0] : chosen;
  const streamName = streamNames[streamId] || 'Removed class';
  const choices = assignment.streamIds.map((id) => ({
    id,
    name: streamNames[id] || 'Removed class',
    done: paper
      ? checks.filter((c) => c.streamId === id && c.status === 'done').length
      : subs.filter((s) => s.streamId === id).length,
    pending: paper
      ? checks.filter((c) => c.streamId === id && c.status !== 'done').length
      : missing.filter((m) => m.streamId === id).length,
  }));
  const streamSubs = subs.filter((s) => s.streamId === streamId);
  const streamMissing = missing.filter((m) => m.streamId === streamId);
  const markedCount = streamSubs.filter((s) => typeof s.marks === 'number').length;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Btn variant='ghost' onClick={onBack}>
          <ArrowLeft className='h-4 w-4' />
          Back to assignments
        </Btn>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      <Card>
        <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
          {assignment.subject}
        </span>
        <h2 className='mt-2 break-words text-xl font-bold text-slate-900'>{assignment.title}</h2>
        <p className='text-sm text-slate-600'>
          {dueText(assignment.dueAt)}
          {assignment.totalMarks ? ` · ${assignment.totalMarks} marks` : ''} · For{' '}
          {assignment.streamIds.map((id) => streamNames[id] || 'removed class').join(', ')}
        </p>
        {assignment.instructions && (
          <p className='mt-3 whitespace-pre-wrap break-words text-sm text-slate-700'>{assignment.instructions}</p>
        )}
        {assignment.attachment && (
          <div className='mt-3'>
            <FileLink file={assignment.attachment} />
          </div>
        )}
      </Card>

      {err && <Alert>{err}</Alert>}

      {!single && (
        <Card>
          <h3 className='text-lg font-bold text-slate-900'>{streamId ? 'Stream' : 'Choose a stream to start'}</h3>
          <p className='mb-3 text-sm text-slate-600'>
            {streamId
              ? 'You are viewing one stream at a time. Choose another stream to switch.'
              : 'This assignment was sent to more than one stream. Choose the stream whose work you want to mark first.'}
          </p>
          <StreamChooser
            items={choices}
            value={streamId}
            onChange={(id) => {
              setChosen(id);
              setOpenId('');
            }}
            doneLabel={paper ? 'parents confirmed' : 'submitted'}
            pendingLabel={paper ? 'not confirmed' : 'not submitted'}
          />
        </Card>
      )}

      {streamId && (
        <>
          <Card>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='text-lg font-bold text-slate-900'>{streamName}</h3>
              <div className='flex flex-wrap gap-2'>
                <Btn
                  variant='secondary'
                  onClick={() => exportAssignmentMarks(assignment, subs, missing, streamNames, streamId, checks).catch(() => undefined)}
                >
                  <Download className='h-4 w-4' />
                  Download marks (Excel)
                </Btn>
                {!single && (
                  <Btn
                    variant='ghost'
                    onClick={() => exportAssignmentMarks(assignment, subs, missing, streamNames, '', checks).catch(() => undefined)}
                  >
                    All streams
                  </Btn>
                )}
              </div>
            </div>
            {paper ? (
              <p className='mt-2 text-sm text-slate-600'>
                Students hand in this work on paper on opening day. Below you can see which parents have confirmed it
                is done at home.
              </p>
            ) : (
            <div className='mt-3 grid grid-cols-3 gap-3 text-center'>
              <div className='rounded-xl bg-slate-50 p-3'>
                <div className='text-2xl font-bold text-slate-900'>{streamSubs.length}</div>
                <div className='text-xs text-slate-500'>Submitted</div>
              </div>
              <div className='rounded-xl bg-slate-50 p-3'>
                <div className='text-2xl font-bold text-slate-900'>{markedCount}</div>
                <div className='text-xs text-slate-500'>Marked</div>
              </div>
              <div className='rounded-xl bg-slate-50 p-3'>
                <div className='text-2xl font-bold text-slate-900'>{streamMissing.length}</div>
                <div className='text-xs text-slate-500'>Not submitted</div>
              </div>
            </div>
            )}
          </Card>

          <ParentChecks checks={checks.filter((c) => c.streamId === streamId)} />

          {!paper && (
          <>
          <Card>
            <h3 className='text-lg font-bold text-slate-900'>Submitted work ({streamSubs.length})</h3>
            {streamSubs.length === 0 ? (
              <p className='mt-2 text-sm text-slate-500'>No student in {streamName} has submitted work yet.</p>
            ) : (
              <ul className='mt-3 divide-y divide-slate-100'>
                {streamSubs.map((s) => (
                  <li key={s.id} className='py-3'>
                    <div className='flex flex-wrap items-center justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='font-semibold text-slate-900'>{s.studentName || 'Unnamed student'}</div>
                        <div className='text-xs text-slate-500'>
                          Adm. {s.admissionNo} · Submitted {fmtDateTime(s.submittedAt)}
                        </div>
                      </div>
                      <div className='flex flex-wrap items-center gap-2'>
                        {s.late && (
                          <span className='rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700'>
                            Late
                          </span>
                        )}
                        {typeof s.marks === 'number' ? (
                          <span className='rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800'>
                            Marked: {s.marks}
                            {assignment.totalMarks ? `/${assignment.totalMarks}` : ''}
                          </span>
                        ) : (
                          <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
                            To mark
                          </span>
                        )}
                        <Btn variant='secondary' onClick={() => setOpenId(openId === s.id ? '' : s.id)}>
                          {openId === s.id ? 'Close' : 'Open work'}
                        </Btn>
                      </div>
                    </div>
                    {openId === s.id && (
                      <SubmissionMarker
                        sub={s}
                        totalMarks={assignment.totalMarks}
                        onSaved={(updated) => setSubs((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {streamMissing.length > 0 && (
            <Card>
              <h3 className='text-lg font-bold text-slate-900'>Not submitted yet ({streamMissing.length})</h3>
              <ul className='mt-3 divide-y divide-slate-100'>
                {streamMissing.map((m) => (
                  <li key={`${m.streamId}-${m.admissionNo}`} className='py-2 text-sm text-slate-800'>
                    <span className='font-mono font-semibold'>{m.admissionNo}</span>
                    <span className='ml-3'>{m.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          </>
          )}
        </>
      )}
    </div>
  );
}

const CHECK_LABEL: Record<ParentCheck['status'], string> = {
  done: 'Confirmed done',
  not_done: 'Said not done',
  none: 'Not checked',
};

function ParentChecks({ checks }: { checks: ParentCheck[] }) {
  const [showAll, setShowAll] = useState(false);
  if (checks.length === 0) {
    return (
      <Card>
        <h3 className='text-lg font-bold text-slate-900'>Parent check</h3>
        <p className='text-sm text-slate-600'>
          No students are on the list for this stream yet. Add them in the Students tab. Their parents can then confirm
          whether the work is done.
        </p>
      </Card>
    );
  }
  const done = checks.filter((c) => c.status === 'done');
  const notDone = checks.filter((c) => c.status === 'not_done');
  const none = checks.filter((c) => c.status === 'none');
  const withNotes = checks.filter((c) => c.status !== 'none' && (c.note || c.status === 'not_done'));
  return (
    <Card>
      <h3 className='text-lg font-bold text-slate-900'>Parent check</h3>
      <p className='text-sm text-slate-600'>
        Parents confirm from their own view whether their child has done this assignment, and can leave you a note.
      </p>
      <div className='mt-3 grid grid-cols-3 gap-3 text-center'>
        <div className='rounded-xl bg-emerald-50 p-3'>
          <div className='text-2xl font-bold text-emerald-800'>{done.length}</div>
          <div className='text-xs text-emerald-800'>Confirmed done</div>
        </div>
        <div className='rounded-xl bg-red-50 p-3'>
          <div className='text-2xl font-bold text-red-700'>{notDone.length}</div>
          <div className='text-xs text-red-700'>Said not done</div>
        </div>
        <div className='rounded-xl bg-slate-50 p-3'>
          <div className='text-2xl font-bold text-slate-900'>{none.length}</div>
          <div className='text-xs text-slate-500'>Not checked yet</div>
        </div>
      </div>
      {withNotes.length > 0 && (
        <div className='mt-4'>
          <div className='text-sm font-semibold text-slate-700'>Parents’ notes</div>
          <ul className='mt-2 space-y-2'>
            {withNotes.map((c) => (
              <li key={c.studentId} className='rounded-lg border border-slate-200 p-3 text-sm'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-semibold text-slate-900'>{c.name || c.admissionNo}</span>
                  <span className='text-xs text-slate-500'>Adm. {c.admissionNo}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      c.status === 'done' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {CHECK_LABEL[c.status]}
                  </span>
                  <span className='text-xs text-slate-400'>{fmtDateTime(c.checkedAt)}</span>
                </div>
                {c.note && <p className='mt-1 whitespace-pre-wrap break-words text-slate-700'>{c.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type='button'
        className='mt-4 text-sm font-semibold text-emerald-700 hover:underline'
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll ? 'Hide the full list' : 'Show every student’s parent check'}
      </button>
      {showAll && (
        <ul className='mt-2 divide-y divide-slate-100'>
          {checks.map((c) => (
            <li key={c.studentId} className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'>
              <span>
                <span className='font-mono font-semibold'>{c.admissionNo}</span>
                <span className='ml-3'>{c.name}</span>
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  c.status === 'done'
                    ? 'bg-emerald-100 text-emerald-800'
                    : c.status === 'not_done'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {CHECK_LABEL[c.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function exportAssignmentMarks(
  a: AssignmentDetail,
  subs: Sub[],
  missing: Missing[],
  names: Record<string, string>,
  only: string,
  checks: ParentCheck[] = [],
): Promise<void> {
  const byStudent = new Map(checks.map((c) => [`${c.streamId}|${c.admissionNo}`, c]));
  const checkCells = (streamId: string, adm: string): string[] => {
    const c = byStudent.get(`${streamId}|${adm}`);
    return c ? [CHECK_LABEL[c.status], c.note || ''] : ['Not checked', ''];
  };
  const ids = only ? [only] : a.streamIds;
  const sheets = ids.map((sid) => {
    const rows: Array<Array<string | number>> = [
      [
        'Admission no.',
        'Name',
        'Status',
        a.totalMarks ? `Marks (out of ${a.totalMarks})` : 'Marks',
        'Submitted at',
        'Late',
        'Feedback',
        'Parent check',
        'Parent note',
      ],
    ];
    subs
      .filter((s) => s.streamId === sid)
      .forEach((s) =>
        rows.push([
          s.admissionNo,
          s.studentName,
          typeof s.marks === 'number' ? 'Marked' : 'Submitted, not marked yet',
          typeof s.marks === 'number' ? s.marks : '',
          fmtDateTime(s.submittedAt),
          s.late ? 'Yes' : 'No',
          s.feedback || '',
          ...checkCells(s.streamId, s.admissionNo),
        ]),
      );
    missing
      .filter((m) => m.streamId === sid)
      .forEach((m) => rows.push([
          m.admissionNo,
          m.name,
          a.submissionMode === 'paper' ? 'On paper, opening day' : 'Not submitted',
          '',
          '',
          '',
          '',
          ...checkCells(m.streamId, m.admissionNo),
        ]),
      );
    return { name: names[sid] || 'Stream', rows };
  });
  await downloadExcel(`${safeFileTitle(a.title)} marks.xlsx`, sheets);
}

function SubmissionMarker({
  sub,
  totalMarks,
  onSaved,
}: {
  sub: Sub;
  totalMarks: number;
  onSaved: (s: Sub) => void;
}) {
  const [marks, setMarks] = useState(typeof sub.marks === 'number' ? String(sub.marks) : '');
  const [feedback, setFeedback] = useState(sub.feedback || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.post(`/api/teacher/assignment-submissions/${encodeURIComponent(sub.id)}/mark`, {
        marks: marks.trim() === '' ? null : Number(marks),
        feedback,
      });
      const saved = r.data?.marks;
      onSaved({
        ...sub,
        marks: typeof saved === 'number' ? saved : null,
        feedback: typeof r.data?.feedback === 'string' ? r.data.feedback : feedback,
      });
      setMsg('Saved. The student can now see your marks and feedback.');
    } catch (e) {
      setErr(errMsg(e, 'Could not save the marks.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4'>
      <div>
        <div className='text-sm font-semibold text-slate-700'>Student’s answer</div>
        <div className='mt-1 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800'>
          {sub.answer ? sub.answer : <span className='italic text-slate-400'>No typed answer</span>}
        </div>
      </div>
      {sub.attachment && (
        <div>
          <div className='mb-1 text-sm font-semibold text-slate-700'>Attached work</div>
          <FileLink file={sub.attachment} />
        </div>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        <label htmlFor={`am-${sub.id}`} className='text-sm font-medium text-slate-700'>
          Marks
        </label>
        <input
          id={`am-${sub.id}`}
          type='number'
          min={0}
          max={totalMarks || 1000}
          step='0.5'
          className={`${inputCls} w-28`}
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
        />
        {totalMarks > 0 && <span className='text-sm text-slate-500'>out of {totalMarks}</span>}
      </div>
      <div>
        <label htmlFor={`af-${sub.id}`} className={labelCls}>
          Feedback to the student
        </label>
        <textarea
          id={`af-${sub.id}`}
          rows={3}
          className={inputCls}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
      {err && <Alert>{err}</Alert>}
      {msg && <Alert kind='success'>{msg}</Alert>}
      <Btn onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save marks and feedback'}
      </Btn>
    </div>
  );
}

