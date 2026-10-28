import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Megaphone, Trash2 } from 'lucide-react';
import { api, errMsg, fmtDateTime, type Stream } from './lib';
import { Alert, Btn, Card, inputCls, labelCls, Spinner, StreamPicker } from './ui';

type Announcement = {
  id: string;
  title: string;
  message: string;
  streamIds: string[];
  createdAt: string;
};

type Props = {
  streams: Stream[];
  allStreams: Stream[];
};

export default function Announcements({ streams, allStreams }: Props) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>(streams.length === 1 ? [streams[0].id] : []);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const names: Record<string, string> = {};
  allStreams.forEach((s) => {
    names[s.id] = s.name;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/staff/announcements');
      setItems((r.data?.announcements || []) as Announcement[]);
    } catch (e) {
      setErr(errMsg(e, 'Could not load your announcements.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setNotice('');
    if (!message.trim()) {
      setErr('Write the announcement.');
      return;
    }
    if (!selected.length) {
      setErr('Choose at least one class / stream.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/staff/announcements', { title, message, streamIds: selected });
      setTitle('');
      setMessage('');
      setNotice('Announcement posted. Students see it in their Notices tab.');
      await load();
    } catch (ex) {
      setErr(errMsg(ex, 'Could not post the announcement.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: Announcement) {
    if (!window.confirm('Delete this announcement? Students will no longer see it.')) return;
    setDeletingId(a.id);
    try {
      await api.delete(`/api/staff/announcements/${a.id}`);
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    } catch (ex) {
      setErr(errMsg(ex, 'Could not delete the announcement.'));
    } finally {
      setDeletingId('');
    }
  }

  return (
    <div className='grid gap-6 lg:grid-cols-5'>
      <div className='lg:col-span-2'>
        <Card>
          <h2 className='text-lg font-bold text-slate-900'>New announcement</h2>
          <p className='mt-1 text-sm text-slate-600'>
            Short notices for your students, such as a change of exam time or a reminder.
          </p>
          {streams.length === 0 ? (
            <div className='mt-3'>
              <Alert kind='info'>You have no classes yet, so there is no one to send announcements to.</Alert>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className='mt-4 space-y-4'>
              <div>
                <label htmlFor='an-title' className={labelCls}>
                  Heading (optional)
                </label>
                <input
                  id='an-title'
                  className={inputCls}
                  value={title}
                  placeholder='e.g. Exam moved'
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor='an-message' className={labelCls}>
                  Message
                </label>
                <textarea
                  id='an-message'
                  rows={5}
                  className={inputCls}
                  value={message}
                  placeholder='e.g. The Mathematics exam has moved to Thursday at 9:00 am.'
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <div>
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <span className={labelCls}>Send to</span>
                  {streams.length > 1 && (
                    <button
                      type='button'
                      className='text-sm font-semibold text-emerald-700 hover:underline'
                      onClick={() => setSelected(streams.map((s) => s.id))}
                    >
                      Select all
                    </button>
                  )}
                </div>
                <StreamPicker streams={streams} value={selected} onChange={setSelected} />
              </div>
              {err && <Alert>{err}</Alert>}
              {notice && <Alert kind='success'>{notice}</Alert>}
              <Btn type='submit' disabled={saving} className='w-full'>
                <Megaphone className='h-4 w-4' />
                {saving ? 'Posting…' : 'Post announcement'}
              </Btn>
            </form>
          )}
        </Card>
      </div>
      <div className='space-y-3 lg:col-span-3'>
        <h2 className='text-lg font-bold text-slate-900'>Your announcements ({items.length})</h2>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Card className='text-sm text-slate-500'>You have not posted any announcements yet.</Card>
        ) : (
          items.map((a) => (
            <Card key={a.id}>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0 flex-1'>
                  {a.title && <h3 className='break-words font-bold text-slate-900'>{a.title}</h3>}
                  <p className='whitespace-pre-wrap break-words text-sm text-slate-700'>{a.message}</p>
                  <p className='mt-2 text-xs text-slate-500'>
                    {fmtDateTime(a.createdAt)} · To {a.streamIds.map((id) => names[id] || 'removed class').join(', ')}
                  </p>
                </div>
                <Btn variant='danger' disabled={deletingId === a.id} onClick={() => remove(a)} aria-label='Delete announcement'>
                  <Trash2 className='h-4 w-4' />
                </Btn>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

