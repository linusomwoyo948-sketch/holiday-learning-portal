import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  NotebookPen,
  Paperclip,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  api,
  errMsg,
  uploadFileInParts,
  fmtDateTime,
  fmtSize,
  MAX_FILE_BYTES,
  statusOf,
  type StudentSession,
} from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner } from './ui';
import QuestionBox from './QuestionBox';

type FileInfo = { path: string; name: string; contentType: string; size: number; url?: string };
type Mode = 'portal' | 'paper';

type ListItem = {
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  dueAt: string;
  totalMarks: number;
  createdAt: string;
  submissionMode: Mode;
  status: 'not_submitted' | 'submitted' | 'marked';
  marks: number | null;
  late: boolean;
  parentCheck?: 'done' | 'not_done' | 'none';
};

type AssignmentInfo = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  teacherName: string;
  dueAt: string;
  totalMarks: number;
  createdAt: string;
  attachment: FileInfo | null;
  submissionMode: Mode;
};

type MySub = {
  answer: string;
  attachment: FileInfo | null;
  submittedAt: string;
  late: boolean;
  marks: number | null;
  feedback: string;
};

type Props = {
  session: StudentSession;
  schoolName: string;
  onExpired: () => void;
};

const linkCls =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100';

const PAPER_TEXT = 'Hand in on paper on opening day';

function FileLink({ file, label }: { file: FileInfo; label?: string }) {
  if (!file.url) return null;
  return (
    <a href={file.url} target='_blank' rel='noreferrer' download={file.name} className={linkCls}>
      <Paperclip className='h-4 w-4 shrink-0' />
      <span className='truncate'>{label ? `${label}: ${file.name}` : file.name}</span>
      <span className='shrink-0 font-normal text-emerald-700'>({fmtSize(file.size)})</span>
    </a>
  );
}

function esc(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

function fileSafe(s: string): string {
  const cleaned = s
    .split('')
    .filter((c) => /[A-Za-z0-9 _-]/.test(c))
    .join('')
    .trim();
  return cleaned || 'assignment';
}

function printableHtml(a: AssignmentInfo, schoolName: string, session: StudentSession): string {
  const body = esc(a.instructions || '').split('\n').join('<br>');
  const due = a.submissionMode === 'paper' ? PAPER_TEXT : a.dueAt ? `Due ${fmtDateTime(a.dueAt)}` : 'No due date';
  const marks = a.totalMarks ? ` &nbsp;|&nbsp; Marks: ${a.totalMarks}` : '';
  const fileNote = a.attachment
    ? `<p class='note'>This assignment also has an attached file (${esc(a.attachment.name)}). Download it from the portal.</p>`
    : '';
  const lines = Array(14).fill(`<div class='line'></div>`).join('');
  return `<!doctype html><html><head><meta charset='utf-8'><title>${esc(a.title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 16px;line-height:1.6}h1{font-size:22px;margin:4px 0 10px}.school{font-size:13px;color:#444;text-transform:uppercase;letter-spacing:.05em}.meta{font-size:13px;color:#333;border-top:1px solid #bbb;border-bottom:1px solid #bbb;padding:8px 0;margin:12px 0}.student{font-size:14px;margin:12px 0 18px}.note{font-style:italic;color:#444}.answers{margin-top:28px}.line{border-bottom:1px solid #999;height:30px}</style></head><body><div class='school'>${esc(schoolName)}</div><h1>${esc(a.title)}</h1><div class='meta'>Subject: ${esc(a.subject)} &nbsp;|&nbsp; Teacher: ${esc(a.teacherName)} &nbsp;|&nbsp; ${esc(due)}${marks}</div><div class='student'>Name: ${esc(session.name || '')} &nbsp;&nbsp; Admission no.: ${esc(session.admissionNo)} &nbsp;&nbsp; Class: ${esc(session.streamName)}</div><div>${body}</div>${fileNote}<div class='answers'><strong>Answers</strong>${lines}</div></body></html>`;
}

function StatusBadge({ item }: { item: ListItem }) {
  if (item.submissionMode === 'paper') {
    return (
      <span className='rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700'>On paper</span>
    );
  }
  if (item.status === 'marked') {
    return (
      <span className='rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800'>
        Marked{item.marks !== null ? `: ${item.marks}${item.totalMarks ? `/${item.totalMarks}` : ''}` : ''}
      </span>
    );
  }
  if (item.status === 'submitted') {
    return <span className='rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800'>Submitted</span>;
  }
  if (item.dueAt && Date.parse(item.dueAt) < Date.now()) {
    return <span className='rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700'>Overdue</span>;
  }
  return <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>To do</span>;
}

export default function StudentAssignments({ session, schoolName, onExpired }: Props) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/student/assignments', { token: session.token });
      setItems((r.data?.assignments || []) as ListItem[]);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load your assignments. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    if (!openId) load();
  }, [openId, load]);

  if (openId) {
    return (
      <AssignmentView
        session={session}
        schoolName={schoolName}
        assignmentId={openId}
        onBack={() => setOpenId('')}
        onExpired={onExpired}
      />
    );
  }

  return (
    <div className='space-y-4'>
      <div className='flex justify-end'>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      {err && <Alert>{err}</Alert>}
      {loading && items.length === 0 ? (
        <Spinner label='Loading your assignments…' />
      ) : items.length === 0 ? (
        <Card className='text-center'>
          <FileText className='mx-auto h-8 w-8 text-slate-400' />
          <p className='mt-2 font-semibold text-slate-700'>No assignments yet</p>
          <p className='text-sm text-slate-500'>When your teachers send an assignment to your class, it will appear here.</p>
        </Card>
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
                    <StatusBadge item={a} />
                    {a.parentCheck === 'done' && (
                      <span className='rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800'>
                        Parent confirmed
                      </span>
                    )}
                    {a.parentCheck === 'not_done' && (
                      <span className='rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700'>
                        Parent: not done yet
                      </span>
                    )}
                    {!paper && a.late && (
                      <span className='rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700'>Late</span>
                    )}
                  </div>
                  <h3 className='mt-2 break-words text-lg font-bold text-slate-900'>{a.title}</h3>
                  <p className='text-xs text-slate-500'>From {a.teacherName}</p>
                  <p className='mt-1 flex items-center gap-1 text-sm text-slate-600'>
                    {paper ? <NotebookPen className='h-4 w-4 shrink-0' /> : <CalendarClock className='h-4 w-4 shrink-0' />}
                    {paper ? PAPER_TEXT : a.dueAt ? `Due ${fmtDateTime(a.dueAt)}` : 'No due date'}
                  </p>
                </div>
                <Btn onClick={() => setOpenId(a.id)}>Open</Btn>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}

function AssignmentView({
  session,
  schoolName,
  assignmentId,
  onBack,
  onExpired,
}: {
  session: StudentSession;
  schoolName: string;
  assignmentId: string;
  onBack: () => void;
  onExpired: () => void;
}) {
  const [assignment, setAssignment] = useState<AssignmentInfo | null>(null);
  const [sub, setSub] = useState<MySub | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(-1);
  const [keepFile, setKeepFile] = useState(true);
  const [fileKey, setFileKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoadErr('');
    try {
      const r = await api.post(`/api/student/assignments/${assignmentId}`, { token: session.token });
      setAssignment(r.data.assignment as AssignmentInfo);
      const s = (r.data.submission || null) as MySub | null;
      setSub(s);
      setAnswer(s ? s.answer || '' : '');
      setKeepFile(true);
      setEditing(!s);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setLoadErr(errMsg(e, 'Could not open the assignment. Please try again.'));
    }
  }, [assignmentId, session.token, onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Btn variant='ghost' onClick={onBack}>
      <ArrowLeft className='h-4 w-4' />
      Back to assignments
    </Btn>
  );

  if (loadErr) {
    return (
      <div className='space-y-3'>
        {back}
        <Alert>{loadErr}</Alert>
      </div>
    );
  }
  if (!assignment) return <Spinner label='Opening the assignment…' />;

  const a = assignment;
  const paper = a.submissionMode === 'paper';
  const marked = !!sub && typeof sub.marks === 'number';
  const overdue = !!a.dueAt && Date.parse(a.dueAt) < Date.now();

  function printIt() {
    setNote('');
    const w = window.open('', '_blank');
    if (!w) {
      setNote('Your browser blocked the print window. Use Download instead, then print the file.');
      return;
    }
    w.document.open();
    w.document.write(printableHtml(a, schoolName, session));
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
    setNote('');
    const blob = new Blob([printableHtml(a, schoolName, session)], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileSafe(a.title)}.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    const hasOldFile = !!sub && !!sub.attachment && keepFile;
    if (!answer.trim() && !file && !hasOldFile) {
      setErr('Type your answer or attach a photo or file of your work.');
      return;
    }
    if (file && file.size > MAX_FILE_BYTES) {
      setErr(`This file is ${fmtSize(file.size)}. Files must be 20 MB or smaller.`);
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { token: session.token, answer, keepFile };
      if (file) {
        payload.file = {
          contentType: file.type || 'application/octet-stream',
          ...(await uploadFileInParts(file, 'student', session.token, setUploadPct)),
        };
      }
      const r = await api.post(`/api/student/assignments/${assignmentId}/submit`, payload);
      setFile(null);
      setFileKey((k) => k + 1);
      await load();
      setMsg(
        r.data?.late
          ? 'Your work has been sent to your teacher. It was marked as late because the due date had passed.'
          : 'Your work has been sent to your teacher.',
      );
    } catch (ex) {
      if (statusOf(ex) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(ex, 'Could not submit your work. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='space-y-4'>
      {back}
      <Card>
        <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>{a.subject}</span>
        <h2 className='mt-2 break-words text-xl font-bold text-slate-900'>{a.title}</h2>
        <p className='text-sm text-slate-600'>
          From {a.teacherName} · {paper ? PAPER_TEXT : a.dueAt ? `Due ${fmtDateTime(a.dueAt)}` : 'No due date'}
          {a.totalMarks ? ` · ${a.totalMarks} marks` : ''}
        </p>
        <div className='mt-4 flex flex-wrap gap-2'>
          <Btn variant='secondary' onClick={printIt}>
            <Printer className='h-4 w-4' />
            Print
          </Btn>
          <Btn variant='secondary' onClick={downloadIt}>
            <Download className='h-4 w-4' />
            Download
          </Btn>
          {a.attachment && <FileLink file={a.attachment} label='Teacher’s file' />}
        </div>
        <p className='mt-2 text-xs text-slate-500'>
          {paper
            ? 'Download saves the assignment as a document you can open in Word or print.'
            : 'Download saves the assignment as a document you can open in Word or print. You can also answer it below.'}
        </p>
        {note && (
          <div className='mt-3'>
            <Alert kind='info'>{note}</Alert>
          </div>
        )}
        {a.instructions && (
          <div className='mt-4 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800'>
            {a.instructions}
          </div>
        )}
      </Card>

      <Card>
        <h3 className='text-lg font-bold text-slate-900'>Questions about this assignment</h3>
        <QuestionBox session={session} itemType='assignment' itemId={a.id} onExpired={onExpired} />
      </Card>

      {paper ? (
        <Card>
          <div className='flex items-start gap-3'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700'>
              <NotebookPen className='h-5 w-5' />
            </div>
            <div>
              <h3 className='text-lg font-bold text-slate-900'>Hand this in on paper</h3>
              <p className='mt-1 text-sm text-slate-600'>
                Your teacher wants this assignment done on paper and handed in on opening day. Print or download it,
                do the work, and bring it to school when it opens.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <h3 className='text-lg font-bold text-slate-900'>Your work</h3>
          {msg && (
            <div className='mt-3'>
              <Alert kind='success'>{msg}</Alert>
            </div>
          )}

          {marked && sub && (
            <div className='mt-3 rounded-xl bg-emerald-50 p-4'>
              <div className='text-sm font-medium text-emerald-800'>Your marks</div>
              <div className='text-3xl font-bold text-emerald-900'>
                {sub.marks}
                {a.totalMarks ? <span className='text-lg font-medium text-emerald-700'> / {a.totalMarks}</span> : null}
              </div>
            </div>
          )}
          {sub && sub.feedback && (
            <div className='mt-3 rounded-lg border border-slate-200 p-3 text-sm'>
              <div className='font-semibold text-slate-700'>Teacher’s feedback</div>
              <p className='mt-1 whitespace-pre-wrap text-slate-700'>{sub.feedback}</p>
            </div>
          )}

          {sub && !editing ? (
            <div className='mt-3 space-y-3'>
              <div className='flex items-center gap-2 text-sm font-semibold text-emerald-800'>
                <CheckCircle2 className='h-5 w-5 shrink-0' />
                Submitted {fmtDateTime(sub.submittedAt)}
                {sub.late && (
                  <span className='rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700'>Late</span>
                )}
              </div>
              <div className='whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'>
                {sub.answer ? sub.answer : <span className='italic text-slate-400'>No typed answer</span>}
              </div>
              {sub.attachment && <FileLink file={sub.attachment} label='Your file' />}
              {!marked && (
                <div>
                  <Btn variant='secondary' onClick={() => setEditing(true)}>
                    Edit and resubmit
                  </Btn>
                  <p className='mt-1 text-xs text-slate-500'>You can change your work until your teacher marks it.</p>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className='mt-3 space-y-4'>
              {overdue && !sub && (
                <Alert kind='info'>The due date has passed. You can still submit, but it will be marked as late.</Alert>
              )}
              <div>
                <label htmlFor='sa-answer' className={labelCls}>
                  Type your answers
                </label>
                <textarea
                  id='sa-answer'
                  rows={10}
                  className={inputCls}
                  value={answer}
                  placeholder='Write your answers here'
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor='sa-file' className={labelCls}>
                  Or attach your work (optional)
                </label>
                {sub && sub.attachment && keepFile && !file && (
                  <div className='mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-700'>
                    <span>
                      Current file: <span className='font-semibold'>{sub.attachment.name}</span>
                    </span>
                    <button
                      type='button'
                      className='text-sm font-semibold text-red-700 hover:underline'
                      onClick={() => setKeepFile(false)}
                    >
                      Remove
                    </button>
                  </div>
                )}
                <input
                  key={fileKey}
                  id='sa-file'
                  type='file'
                  accept='image/*,.pdf,.doc,.docx,.txt'
                  className='block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-800'
                  onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                />
                <p className='mt-1 text-xs text-slate-500'>
                  A photo of your handwritten work, or a PDF or Word file, up to 20 MB.
                </p>
              </div>
              {err && <Alert>{err}</Alert>}
              <div className='flex flex-wrap gap-2'>
                <Btn type='submit' disabled={saving}>
                  {saving ? (uploadPct >= 0 ? `Uploading file ${uploadPct}%…` : 'Submitting…') : sub ? 'Resubmit work' : 'Submit to teacher'}
                </Btn>
                {sub && (
                  <Btn
                    variant='ghost'
                    onClick={() => {
                      setEditing(false);
                      setAnswer(sub.answer || '');
                      setKeepFile(true);
                      setFile(null);
                      setFileKey((k) => k + 1);
                      setErr('');
                    }}
                  >
                    Cancel
                  </Btn>
                )}
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

