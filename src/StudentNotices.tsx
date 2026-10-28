import { useCallback, useEffect, useState } from 'react';
import { Megaphone, RefreshCw } from 'lucide-react';
import { api, errMsg, fmtDateTime, statusOf, type StudentSession } from './lib';
import { Alert, Btn, Card, Spinner } from './ui';

type Announcement = {
  id: string;
  title: string;
  message: string;
  authorName: string;
  authorRole: 'teacher' | 'principal';
  createdAt: string;
};

export default function StudentNotices({ session, onExpired }: { session: StudentSession; onExpired: () => void }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.post('/api/student/announcements', { token: session.token });
      setItems((r.data?.announcements || []) as Announcement[]);
    } catch (e) {
      if (statusOf(e) === 401) {
        onExpired();
        return;
      }
      setErr(errMsg(e, 'Could not load the notices.'));
    } finally {
      setLoading(false);
    }
  }, [session.token, onExpired]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-lg font-bold text-slate-900'>Notices from your school</h2>
        <Btn variant='ghost' onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Btn>
      </div>
      {err && <Alert>{err}</Alert>}
      {loading && items.length === 0 ? (
        <Spinner label='Loading notices…' />
      ) : items.length === 0 ? (
        <Card className='text-center'>
          <Megaphone className='mx-auto h-8 w-8 text-slate-400' />
          <p className='mt-2 font-semibold text-slate-700'>No notices yet</p>
          <p className='text-sm text-slate-500'>Announcements from your teachers and principal will appear here.</p>
        </Card>
      ) : (
        items.map((a) => (
          <Card key={a.id}>
            {a.title && <h3 className='break-words text-lg font-bold text-slate-900'>{a.title}</h3>}
            <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700'>{a.message}</p>
            <p className='mt-2 text-xs text-slate-500'>
              {a.authorRole === 'principal' ? 'Principal' : 'Teacher'} {a.authorName} · {fmtDateTime(a.createdAt)}
            </p>
          </Card>
        ))
      )}
    </div>
  );
}

