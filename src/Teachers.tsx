import { useCallback, useEffect, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import {
  api,
  errMsg,
  fmtDate,
  type Stream,
  type Teacher,
  type TeacherStatus,
} from './lib';
import { Alert, Btn, Card, Spinner, StreamPicker } from './ui';

const GROUPS: Array<{ key: TeacherStatus; title: string; empty: string }> = [
  {
    key: 'pending',
    title: 'Waiting for approval',
    empty: 'No teachers are waiting for approval.',
  },
  {
    key: 'approved',
    title: 'Approved teachers',
    empty: 'No approved teachers yet.',
  },
  { key: 'rejected', title: 'Declined or suspended', empty: 'None.' },
];

export default function Teachers({ streams }: { streams: Stream[] }) {
  const [list, setList] = useState<Teacher[]>([]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.get('/api/admin/teachers');
      const teachers = (r.data?.teachers || []) as Teacher[];
      setList(teachers);
      const next: Record<string, string[]> = {};
      teachers.forEach(t => {
        next[t.userId] = t.streamIds || [];
      });
      setPicks(next);
    } catch (e) {
      setErr(errMsg(e, 'Could not load teachers.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(
    t: Teacher,
    status: TeacherStatus | null,
    label: string
  ) {
    setBusyId(t.userId);
    setErr('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = {
        streamIds: picks[t.userId] || [],
      };
      if (status) payload.status = status;
      await api.post(`/api/admin/teachers/${t.userId}`, payload);
      setNotice(`${t.name}: ${label}.`);
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not update the teacher.'));
    } finally {
      setBusyId('');
    }
  }

  async function remove(t: Teacher) {
    if (
      !window.confirm(
        `Remove ${t.name}? They will lose access and would need to register again.`
      )
    )
      return;
    setBusyId(t.userId);
    setErr('');
    try {
      await api.delete(`/api/admin/teachers/${t.userId}`);
      setNotice(`${t.name} was removed.`);
      await load();
    } catch (e) {
      setErr(errMsg(e, 'Could not remove the teacher.'));
    } finally {
      setBusyId('');
    }
  }

  if (loading && !list.length) return <Spinner />;

  return (
    <div className="space-y-6">
      {err && <Alert>{err}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <Alert kind="info">
        Approved teachers add their own students and post learning materials
        for the classes you assign to them here.
      </Alert>
      {!streams.length && (
        <Alert kind="info">
          Add your classes / streams under School setup so you can assign them
          to teachers.
        </Alert>
      )}
      {GROUPS.map(g => {
        const group = list.filter(t => t.status === g.key);
        if (g.key === 'rejected' && !group.length) return null;
        return (
          <section key={g.key}>
            <h2 className="mb-3 text-lg font-bold text-slate-900">
              {g.title} ({group.length})
            </h2>
            {group.length === 0 ? (
              <Card className="text-sm text-slate-500">{g.empty}</Card>
            ) : (
              <div className="space-y-3">
                {group.map(t => {
                  const busy = busyId === t.userId;
                  return (
                    <Card key={t.userId}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">
                            {t.name}
                          </div>
                          <div className="break-all text-sm text-slate-600">
                            {t.email}
                          </div>
                          <div className="text-sm text-slate-600">
                            {t.subjects}
                            {t.phone ? ` · ${t.phone}` : ''}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500">
                          Registered {fmtDate(t.createdAt)}
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 text-sm font-medium text-slate-700">
                          Classes / streams
                        </div>
                        <StreamPicker
                          streams={streams}
                          value={picks[t.userId] || []}
                          onChange={v =>
                            setPicks(p => ({ ...p, [t.userId]: v }))
                          }
                        />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {t.status !== 'approved' && (
                          <Btn
                            disabled={busy}
                            onClick={() => update(t, 'approved', 'approved')}
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </Btn>
                        )}
                        {t.status === 'approved' && (
                          <Btn
                            disabled={busy}
                            onClick={() => update(t, null, 'classes updated')}
                          >
                            Save classes
                          </Btn>
                        )}
                        {t.status === 'pending' && (
                          <Btn
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              update(t, 'rejected', 'request declined')
                            }
                          >
                            <X className="h-4 w-4" />
                            Decline
                          </Btn>
                        )}
                        {t.status === 'approved' && (
                          <Btn
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              update(t, 'rejected', 'access suspended')
                            }
                          >
                            Suspend
                          </Btn>
                        )}
                        <Btn
                          variant="danger"
                          disabled={busy}
                          onClick={() => remove(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </Btn>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

