import type { ReactNode } from 'react';
import { ExternalLink, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { fmtDate, fmtSize, type Material } from './lib';
import { Btn, Card } from './ui';

type Props = {
  m: Material & { updatedAt?: string };
  streamNames?: Record<string, string>;
  onDelete?: () => void;
  onEdit?: () => void;
  deleting?: boolean;
  footer?: ReactNode;
};

const linkCls =
  'inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100';

export default function MaterialCard({ m, streamNames, onDelete, onEdit, deleting, footer }: Props) {
  const forText = streamNames
    ? ` · For ${m.streamIds.map((id) => streamNames[id] || 'removed class').join(', ')}`
    : '';
  return (
    <Card>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <span className='inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900'>
            {m.subject}
          </span>
          <h3 className='mt-2 break-words text-lg font-bold text-slate-900'>{m.title}</h3>
          <p className='text-xs text-slate-500'>
            Posted by {m.teacherName} on {fmtDate(m.createdAt)}
            {m.updatedAt ? ` · Updated ${fmtDate(m.updatedAt)}` : ''}
            {forText}
          </p>
        </div>
        {(onEdit || onDelete) && (
          <div className='flex flex-wrap gap-2'>
            {onEdit && (
              <Btn variant='secondary' onClick={onEdit}>
                <Pencil className='h-4 w-4' />
                Edit
              </Btn>
            )}
            {onDelete && (
              <Btn variant='danger' onClick={onDelete} disabled={deleting}>
                <Trash2 className='h-4 w-4' />
                {deleting ? 'Deleting…' : 'Delete'}
              </Btn>
            )}
          </div>
        )}
      </div>
      {m.body && <p className='mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700'>{m.body}</p>}
      {(m.link || m.attachment) && (
        <div className='mt-4 flex flex-wrap gap-2'>
          {m.link && (
            <a href={m.link} target='_blank' rel='noreferrer' className={linkCls}>
              <ExternalLink className='h-4 w-4 shrink-0' />
              Open link
            </a>
          )}
          {m.attachment && m.attachment.url && (
            <a href={m.attachment.url} target='_blank' rel='noreferrer' download={m.attachment.name} className={linkCls}>
              <Paperclip className='h-4 w-4 shrink-0' />
              <span className='truncate'>{m.attachment.name}</span>
              <span className='shrink-0 font-normal text-emerald-700'>({fmtSize(m.attachment.size)})</span>
            </a>
          )}
        </div>
      )}
      {footer}
    </Card>
  );
}

