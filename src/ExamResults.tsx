import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Check, Download, RefreshCw } from 'lucide-react';
import {
  api,
  downloadExcel,
  errMsg,
  fmtDateTime,
  fmtTime,
  LETTERS,
  phaseAt,
  safeFileTitle,
  submissionTotal,
  type ExamDetail,
  type Submission,
} from './lib';
import { Alert, Btn, Card, inputCls, Spinner } from './ui';
import StreamChooser from './StreamChooser';

type NotAttempted = { name: string; admissionNo: string; streamId: string };

type Props = {
  examId: string;
  streamNames: Record<string, string>;
  onBack: () => void;
};

function StatusBadge({ sub }: { sub: Submission }) {
  if (sub.status !== 'submitted') {
    return <span className='rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800'>Writing</span>;
  }
  if (sub.autoSubmitted) {
    return (
      <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
        Auto-submitted (time up)
      </span>
    );
  }
  return <span className='rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800'>Submitted</span>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className='rounded-xl bg-slate-50 p-3'>
      <div className='text-2xl font-bold text-slate-900'>{value}</div>
      <div className='text-xs text-slate-500'>{label}</div>
    </div>
  );
}

function questionMark(exam: ExamDetail, s: Submission, qi: number): number | string {
  const q = exam.questions[qi];
  const ans = s.answers ? s.answers[q.id] : undefined;
  if (q.type === 'mcq') return ans !== undefined && ans !== '' && Number(ans) === q.correct ? q.marks : 0;
  const m = s.marks ? s.marks[q.id] : undefined;
  return typeof m === 'number' ? m : 'Not marked';
}

function sheetRows(exam: ExamDetail, subs: Submission[], missing: NotAttempted[], sid: string) {
  const header: Array<string | number> = [
    'Admission no.',
    'Name',
    'Status',
    ...exam.questions.map((q, i) => `Q${i + 1} (${q.marks})`),
    `Total (out of ${exam.totalMarks})`,
    '%',
    'Submitted at',
  ];
  const rows: Array<Array<string | number>> = [header];
  subs
    .filter((s) => s.streamId === sid)
    .forEach((s) => {
      const t = submissionTotal(exam, s);
      const done = s.status === 'submitted';
      rows.push([
        s.admissionNo,
        s.studentName,
        done ? (s.autoSubmitted ? 'Auto-submitted' : 'Submitted') : 'Writing',
        ...exam.questions.map((_q, i) => (done ? questionMark(exam, s, i) : '')),
        done ? t.score : '',
        done && exam.totalMarks > 0 ? Math.round((t.score / exam.totalMarks) * 1000) / 10 : '',
        s.submittedAt ? fmtDateTime(s.submittedAt) : '',
      ]);
    });
  missing
    .filter((m) => m.streamId === sid)
    .forEach((m) => rows.push([m.admissionNo, m.name, 'Not attempted', ...exam.questions.map(() => ''), '', '', '']));
  return rows;
}

function QuestionAnalysis({ exam, subs }: { exam: ExamDetail; subs: Submission[] }) {
  const done = subs.filter((s) => s.status === 'submitted');
  if (!done.length) {
    return <p className='mt-2 text-sm text-slate-500'>The analysis appears once students have submitted.</p>;
  }
  return (
    <ul className='mt-3 space-y-3'>
      {exam.questions.map((q, i) => {
        let percent = 0;
        let detail = '';
        let counts: number[] = [];
        if (q.type === 'mcq') {
          counts = q.options.map(() => 0);
          let right = 0;
          done.forEach((s) => {
            const a = s.answers ? s.answers[q.id] : undefined;
            if (a !== undefined && a !== '') {
              const n = Number(a);
              if (n >= 0 && n < counts.length) counts[n] += 1;
              if (n === q.correct) right += 1;
            }
          });
          percent = Math.round((right / done.length) * 100);
          detail = `${right} of ${done.length} correct`;
        } else {
          let sum = 0;
          let marked = 0;
          done.forEach((s) => {
            const m = s.marks ? s.marks[q.id] : undefined;
            if (typeof m === 'number') {
              sum += m;
              marked += 1;
            }
          });
          percent = marked && q.marks ? Math.round((sum / (marked * q.marks)) * 100) : 0;
          detail = marked
            ? `Average ${Math.round((sum / marked) * 10) / 10} of ${q.marks}${marked < done.length ? ` · ${done.length - marked} not marked yet` : ''}`
            : 'Not marked yet';
        }
        const bar = percent >= 70 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-400' : 'bg-red-500';
        return (
          <li key={q.id} className='rounded-lg border border-slate-200 p-3'>
            <div className='flex flex-wrap items-start justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                <div className='text-sm font-bold text-slate-800'>Question {i + 1}</div>
                <p className='line-clamp-2 break-words text-sm text-slate-600'>{q.text}</p>
              </div>
              <div className='text-right text-sm'>
                <div className='font-bold text-slate-900'>{percent}%</div>
                <div className='text-xs text-slate-500'>{detail}</div>
              </div>
            </div>
            <div className='mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100'>
              <div className={`h-full ${bar}`} style={{ width: `${percent}%` }} />
            </div>
            {q.type === 'mcq' && (
              <div className='mt-2 flex flex-wrap gap-2 text-xs'>
                {q.options.map((o, j) => (
                  <span
                    key={j}
                    title={o}
                    className={`rounded-full px-2 py-0.5 ${
                      j === q.correct ? 'bg-emerald-100 font-semibold text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {LETTERS[j]}: {counts[j]}
                    {j === q.correct ? ' ✓' : ''}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ExamResults({ examId, streamNames, onBack }: Props) {
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [missing, setMissing] = useState<NotAttempted[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState('');
  const [chosen, setChosen] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get(`/api/teacher/exams/${examId}/results`);
      setExam(r.data.exam as ExamDetail);
      setSubs((r.data.submissions || []) as Submission[]);
      setMissing((r.data.notAttempted || []) as NotAttempted[]);
      if (r.data.serverNow) setOffset(Date.parse(r.data.serverNow) - Date.now());
    } catch (e) {
      setErr(errMsg(e, 'Could not load the results.'));
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  function onSaved(updated: Submission) {
    setSubs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  if (loading && !exam) return <Spinner />;
  if (!exam) {
    return (
      <div className='space-y-3'>
        <Btn variant='ghost' onClick={onBack}>
          <ArrowLeft className='h-4 w-4' />
          Back to exams
        </Btn>
        {err && <Alert>{err}</Alert>}
      </div>
    );
  }

  const examNow = exam;
  const phase = phaseAt(exam, Date.now() + offset);
  const single = exam.streamIds.length === 1;
  const streamId = single ? exam.streamIds[0] : chosen;
  const streamName = streamNames[streamId] || 'Removed class';
  const choices = exam.streamIds.map((id) => ({
    id,
    name: streamNames[id] || 'Removed class',
    done: subs.filter((s) => s.streamId === id && s.status === 'submitted').length,
    pending: missing.filter((m) => m.streamId === id).length,
  }));
  const streamSubs = subs.filter((s) => s.streamId === streamId);
  const streamMissing = missing.filter((m) => m.streamId === streamId);
  const submittedCount = streamSubs.filter((s) => s.status === 'submitted').length;
  const writingCount = streamSubs.length - submittedCount;
  const open = subs.find((s) => s.id === openId) || null;
  const anyPending = streamSubs.some((s) => s.status === 'submitted' && submissionTotal(exam, s).pending > 0);

  async function exportMarks(only: string) {
    setExporting(true);
    setErr('');
    try {
      const ids = only ? [only] : examNow.streamIds;
      await downloadExcel(
        `${safeFileTitle(examNow.title)} marks.xlsx`,
        ids.map((sid) => ({ name: streamNames[sid] || 'Stream', rows: sheetRows(examNow, subs, missing, sid) })),
      );
    } catch (e) {
      setErr(errMsg(e, 'Could not create the Excel file.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Btn variant='ghost' onClick={onBack}>
          <ArrowLeft className='h-4 w-4' />
          Back to exams
        </Btn>
        <div className='flex flex-wrap gap-2'>
          {!single && (
            <Btn variant='secondary' onClick={() => exportMarks('')} disabled={exporting}>
              <Download className='h-4 w-4' />
              All streams (Excel)
            </Btn>
          )}
          <Btn variant='ghost' onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Btn>
        </div>
      </div>

      <Card>
        <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>{exam.subject}</span>
        <h2 className='mt-2 break-words text-xl font-bold text-slate-900'>{exam.title}</h2>
        <p className='text-sm text-slate-600'>
          {fmtDateTime(exam.startAt)} to {fmtTime(exam.endAt)} · {exam.questions.length} questions ·{' '}
          {exam.totalMarks} marks
        </p>
        <p className='text-xs text-slate-500'>
          For {exam.streamIds.map((id) => streamNames[id] || 'removed class').join(', ')} ·{' '}
          {phase === 'upcoming' ? 'Not opened yet' : phase === 'open' ? 'Open now' : 'Closed'}
        </p>
      </Card>

      {err && <Alert>{err}</Alert>}

      {open ? (
        <SubmissionView key={open.id} exam={exam} sub={open} onClose={() => setOpenId('')} onSaved={onSaved} />
      ) : (
        <>
          {!single && (
            <Card>
              <h3 className='text-lg font-bold text-slate-900'>{streamId ? 'Stream' : 'Choose a stream to start'}</h3>
              <p className='mb-3 text-sm text-slate-600'>
                {streamId
                  ? 'You are viewing one stream at a time. Choose another stream to switch.'
                  : 'This exam was set for more than one stream. Choose the stream whose work you want to see first.'}
              </p>
              <StreamChooser
                items={choices}
                value={streamId}
                onChange={(id) => setChosen(id)}
                doneLabel='submitted'
                pendingLabel='not attempted'
              />
            </Card>
          )}

          {streamId && (
            <>
              <Card>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <h3 className='text-lg font-bold text-slate-900'>{streamName}</h3>
                  <div className='flex flex-wrap gap-2'>
                    <Btn variant='secondary' onClick={() => setShowAnalysis((v) => !v)}>
                      <BarChart3 className='h-4 w-4' />
                      {showAnalysis ? 'Hide question analysis' : 'Question analysis'}
                    </Btn>
                    <Btn variant='secondary' onClick={() => exportMarks(streamId)} disabled={exporting}>
                      <Download className='h-4 w-4' />
                      {exporting ? 'Preparing…' : 'Download marks (Excel)'}
                    </Btn>
                  </div>
                </div>
                <div className='mt-3 grid grid-cols-3 gap-3 text-center'>
                  <Stat label='Submitted' value={submittedCount} />
                  <Stat label='Writing now' value={phase === 'closed' ? 0 : writingCount} />
                  <Stat label='Not attempted' value={streamMissing.length} />
                </div>
              </Card>

              {showAnalysis && (
                <Card>
                  <h3 className='text-lg font-bold text-slate-900'>How {streamName} did on each question</h3>
                  <p className='text-sm text-slate-600'>
                    Questions in red were answered well by fewer than half of the students, so the topic may need going
                    over again.
                  </p>
                  <QuestionAnalysis exam={exam} subs={streamSubs} />
                </Card>
              )}

              <Card>
                <h3 className='text-lg font-bold text-slate-900'>Students who took the exam ({streamSubs.length})</h3>
                {streamSubs.length === 0 ? (
                  <p className='mt-2 text-sm text-slate-500'>No student in {streamName} has started this exam yet.</p>
                ) : (
                  <ul className='mt-3 divide-y divide-slate-100'>
                    {streamSubs.map((s) => {
                      const t = submissionTotal(exam, s);
                      return (
                        <li key={s.id} className='flex flex-wrap items-center justify-between gap-3 py-3'>
                          <div className='min-w-0'>
                            <div className='font-semibold text-slate-900'>{s.studentName || 'Unnamed student'}</div>
                            <div className='text-xs text-slate-500'>
                              Adm. {s.admissionNo}
                              {s.status === 'submitted' && s.submittedAt ? ` · Submitted ${fmtTime(s.submittedAt)}` : ''}
                            </div>
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <StatusBadge sub={s} />
                            {s.status === 'submitted' && (
                              <span className='text-sm font-bold text-slate-800'>
                                {t.score}/{exam.totalMarks}
                                {t.pending ? '*' : ''}
                              </span>
                            )}
                            <Btn variant='secondary' onClick={() => setOpenId(s.id)}>
                              View work
                            </Btn>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {anyPending && <p className='mt-2 text-xs text-slate-500'>* Written answers still to be marked.</p>}
              </Card>

              {streamMissing.length > 0 && (
                <Card>
                  <h3 className='text-lg font-bold text-slate-900'>Not attempted ({streamMissing.length})</h3>
                  <p className='text-sm text-slate-600'>Students in {streamName} who have not opened this exam.</p>
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

function SubmissionView({
  exam,
  sub,
  onClose,
  onSaved,
}: {
  exam: ExamDetail;
  sub: Submission;
  onClose: () => void;
  onSaved: (s: Submission) => void;
}) {
  const [marks, setMarks] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    Object.entries(sub.marks || {}).forEach(([k, v]) => {
      m[k] = String(v);
    });
    return m;
  });
  const [comment, setComment] = useState(sub.comment || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const canMark = sub.status === 'submitted';
  const t = submissionTotal(exam, sub);
  const hasWritten = exam.questions.some((q) => q.type === 'written');

  async function save() {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const payload: Record<string, number> = {};
      Object.entries(marks).forEach(([k, v]) => {
        if (v.trim() !== '') payload[k] = Number(v);
      });
      const r = await api.post(`/api/teacher/submissions/${encodeURIComponent(sub.id)}/mark`, {
        marks: payload,
        comment,
      });
      onSaved({
        ...sub,
        marks: (r.data?.marks || payload) as Record<string, number>,
        comment: typeof r.data?.comment === 'string' ? r.data.comment : comment,
      });
      setMsg('Marks saved.');
    } catch (e) {
      setErr(errMsg(e, 'Could not save the marks.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className='space-y-4'>
      <Btn variant='ghost' onClick={onClose}>
        <ArrowLeft className='h-4 w-4' />
        Back to the stream list
      </Btn>
      <Card>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <h3 className='text-lg font-bold text-slate-900'>{sub.studentName || 'Unnamed student'}</h3>
            <p className='text-sm text-slate-600'>Admission no. {sub.admissionNo}</p>
            <p className='text-xs text-slate-500'>
              Started {fmtDateTime(sub.startedAt)}
              {sub.submittedAt ? ` · Submitted ${fmtDateTime(sub.submittedAt)}` : ''}
            </p>
          </div>
          <div className='text-right'>
            <StatusBadge sub={sub} />
            <div className='mt-2 text-2xl font-bold text-slate-900'>
              {t.score}
              <span className='text-base font-medium text-slate-500'> / {exam.totalMarks}</span>
            </div>
            {canMark && t.pending > 0 && (
              <div className='text-xs text-amber-700'>
                {t.pending} written answer{t.pending === 1 ? '' : 's'} to mark
              </div>
            )}
          </div>
        </div>
        {!canMark && (
          <div className='mt-3'>
            <Alert kind='info'>This student is still writing. You can mark the work once it is submitted.</Alert>
          </div>
        )}
      </Card>

      {exam.questions.map((q, i) => {
        const ans = sub.answers ? sub.answers[q.id] : undefined;
        const chosen = ans !== undefined && ans !== '' ? Number(ans) : -1;
        const right = chosen === q.correct;
        return (
          <Card key={q.id}>
            <div className='flex items-start justify-between gap-3'>
              <div className='text-sm font-bold text-slate-800'>Question {i + 1}</div>
              <div className='text-xs text-slate-500'>
                {q.marks} mark{q.marks === 1 ? '' : 's'}
              </div>
            </div>
            <p className='mt-1 whitespace-pre-wrap break-words text-slate-800'>{q.text}</p>
            {q.type === 'mcq' ? (
              <ul className='mt-3 space-y-1'>
                {q.options.map((o, j) => (
                  <li
                    key={j}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      j === q.correct
                        ? 'border-emerald-300 bg-emerald-50'
                        : j === chosen
                          ? 'border-red-300 bg-red-50'
                          : 'border-slate-200'
                    }`}
                  >
                    <span className='font-semibold'>{LETTERS[j]}.</span>
                    <span className='flex-1 break-words'>{o}</span>
                    {j === chosen && <span className='text-xs font-semibold text-slate-600'>Student's answer</span>}
                    {j === q.correct && <Check className='h-4 w-4 text-emerald-700' />}
                  </li>
                ))}
                <li className={`pt-1 text-sm font-semibold ${right ? 'text-emerald-700' : 'text-red-700'}`}>
                  {chosen < 0 ? 'Not answered · 0 marks' : right ? `Correct · ${q.marks} marks` : 'Wrong · 0 marks'}
                </li>
              </ul>
            ) : (
              <div className='mt-3'>
                <div className='whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800'>
                  {ans ? ans : <span className='italic text-slate-400'>No answer written</span>}
                </div>
                {canMark && (
                  <div className='mt-3 flex items-center gap-2'>
                    <label htmlFor={`mk-${q.id}`} className='text-sm font-medium text-slate-700'>
                      Marks awarded
                    </label>
                    <input
                      id={`mk-${q.id}`}
                      type='number'
                      min={0}
                      max={q.marks}
                      step='0.5'
                      className={`${inputCls} w-24`}
                      value={marks[q.id] ?? ''}
                      onChange={(e) => setMarks((m) => ({ ...m, [q.id]: e.target.value }))}
                    />
                    <span className='text-sm text-slate-500'>out of {q.marks}</span>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {canMark && (
        <Card>
          <label htmlFor='mk-comment' className='mb-1 block text-sm font-medium text-slate-700'>
            Comment for your records (optional)
          </label>
          <textarea
            id='mk-comment'
            rows={3}
            className={inputCls}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className='mt-3 space-y-2'>
            {err && <Alert>{err}</Alert>}
            {msg && <Alert kind='success'>{msg}</Alert>}
            <Btn onClick={save} disabled={saving}>
              {saving ? 'Saving…' : hasWritten ? 'Save marks' : 'Save comment'}
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

