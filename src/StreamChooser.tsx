import { Users } from 'lucide-react';

export type StreamChoice = { id: string; name: string; done: number; pending: number };

type Props = {
  items: StreamChoice[];
  value: string;
  onChange: (id: string) => void;
  doneLabel: string;
  pendingLabel: string;
};

export default function StreamChooser({ items, value, onChange, doneLabel, pendingLabel }: Props) {
  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3' role='radiogroup' aria-label='Choose a stream'>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type='button'
            role='radio'
            aria-checked={on}
            onClick={() => onChange(it.id)}
            className={`rounded-xl border p-4 text-left transition ${
              on
                ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600'
                : 'border-slate-200 bg-white hover:border-emerald-300'
            }`}
          >
            <div className='flex items-center gap-2'>
              <Users className='h-4 w-4 shrink-0 text-emerald-700' />
              <span className='truncate font-bold text-slate-900'>{it.name}</span>
            </div>
            <div className='mt-1 text-xs text-slate-600'>
              {it.done} {doneLabel} · {it.pending} {pendingLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}

