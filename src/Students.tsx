import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api, errMsg, type Stream, type Student } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner } from './ui';

type Entry = { admissionNo: string; name: string };

export default function Students({ streams }: { streams: Stream[] }) {
  const [streamId, setStreamId] = useState(streams[0]?.id || '');
  const [list, setList] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [adm, setAdm] = useState('');
  const [name, setName] = useState('');
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (sid: string) => {
    if (!sid) {
      setList([]);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const r = await api.get(
        `/api/teacher/students?streamId=${encodeURIComponent(sid)}`
      );
      setList((r.data?.students || []) as Student[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load students.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(streamId);
  }, [streamId, load]);

  async function save(entries: Entry[]): Promise<boolean> {
    setErr('');
    setNotice('');
    if (!entries.length) {
      setErr('Enter at least one admission number.');
      return false;
    }
    setSaving(true);
    try {
      const r = await api.post('/api/teacher/students', { streamId, entries });
      const saved = Number(r.data?.saved || 0);
      setNotice(`${saved} student${saved === 1 ? '' : 's'} saved.`);
      await load(streamId);
      return true;
    } catch (e) {
      setErr(errMsg(e, 'Could not save the students.'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addOne(e: FormEvent) {
    e.preventDefault();
    if (!adm.trim()) {
      setErr('Enter the admission number.');
      return;
    }
    if (await save([{ admissionNo: adm.trim(), name: name.trim() }])) {
      setAdm('');
      setName('');
    }
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    const entries = bulk
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(line.includes('\t') ? '\t' : ',');
        return {
          admissionNo: parts[0].trim(),
          name: parts.slice(1).join(' ').trim(),
        };
      });
    if (await save(entries)) setBulk('');
  }

  async function remove(s: Student) {
    if (
      !window.confirm(
        `Remove ${s.name || s.admissionNo} (${s.admissionNo}) from this class? They will no longer be able to sign in.`
      )
    )
      return;
    setErr('');
    try {
      await api.delete(`/api/teacher/students/${encodeURIComponent(s.id)}`);
      setList(prev => prev.filter(x => x.id !== s.id));
    } catch (e) {
      setErr(errMsg(e, 'Could not remove the student.'));
    }
  }

  if (!streams.length) {
    return (
      <Alert kind="info">
        You have not been assigned any class yet. The principal assigns classes
        when approving teacher accounts.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <label htmlFor="s-stream" className={labelCls}>
          Class / stream
        </label>
        <select
          id="s-stream"
          className={`${inputCls} max-w-sm`}
          value={streamId}
          onChange={e => setStreamId(e.target.value)}
        >
          {streams.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-slate-600">
          Only students listed here can sign in to this class with their
          admission number.
        </p>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-bold text-slate-900">Add a student</h2>
          <form onSubmit={addOne} noValidate className="mt-4 space-y-3">
            <div>
              <label htmlFor="s-adm" className={labelCls}>
                Admission number
              </label>
              <input
                id="s-adm"
                className={inputCls}
                value={adm}
                onChange={e => setAdm(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="s-name" className={labelCls}>
                Student name
              </label>
              <input
                id="s-name"
                className={inputCls}
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <Btn type="submit" disabled={saving}>
              Add student
            </Btn>
          </form>
        </Card>
        <Card>
          <h2 className="text-lg font-bold text-slate-900">Add many at once</h2>
          <form onSubmit={addBulk} noValidate className="mt-4 space-y-3">
            <label htmlFor="s-bulk" className={labelCls}>
              One student per line: admission number, name
            </label>
            <textarea
              id="s-bulk"
              rows={5}
              className={inputCls}
              value={bulk}
              placeholder={
                '4521, Achieng Otieno' +
                String.fromCharCode(10) +
                '4522, Brian Kiprono'
              }
              onChange={e => setBulk(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              You can also paste two columns copied from Excel.
            </p>
            <Btn type="submit" disabled={saving}>
              Add list
            </Btn>
          </form>
        </Card>
      </div>
      {err && <Alert>{err}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      <Card>
        <h2 className="text-lg font-bold text-slate-900">
          Students in this class ({list.length})
        </h2>
        {loading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No students added yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {list.map(s => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold text-slate-800">
                    {s.admissionNo}
                  </span>
                  <span className="ml-3 text-sm text-slate-600">{s.name}</span>
                </div>
                <Btn
                  variant="ghost"
                  onClick={() => remove(s)}
                  aria-label={`Remove ${s.admissionNo}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

