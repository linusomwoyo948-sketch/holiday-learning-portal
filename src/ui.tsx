import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import type { Stream } from './lib';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
  secondary:
    'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50',
  danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50';

export const labelCls = 'mb-1 block text-sm font-medium text-slate-700';

export function Btn({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-amber-200 bg-amber-50 text-amber-900',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <header className="bg-emerald-800 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-emerald-900">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{title}</div>
            {subtitle && (
              <div className="truncate text-sm text-emerald-100">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {right}
      </div>
    </header>
  );
}

export function StreamPicker({
  streams,
  value,
  onChange,
}: {
  streams: Stream[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!streams.length)
    return (
      <p className="text-sm text-slate-500">No classes have been set up yet.</p>
    );
  return (
    <div className="flex flex-wrap gap-2">
      {streams.map(s => {
        const on = value.includes(s.id);
        return (
          <button
            type="button"
            key={s.id}
            aria-pressed={on}
            onClick={() =>
              onChange(on ? value.filter(x => x !== s.id) : [...value, s.id])
            }
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
              on
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-400'
            }`}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

