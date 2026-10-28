import { api, putFile } from './platform/client';

export { api };

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PART_BYTES = 1024 * 1024;
const PARALLEL_PARTS = 4;
const SINGLE_REQUEST_MAX = 2.5 * 1024 * 1024;
const SHRINKABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_SIDE = 2000;
const SESSION_KEY = 'holiday-portal-student';

export type Stream = { id: string; name: string };

export type TeacherStatus = 'pending' | 'approved' | 'rejected';

export type Teacher = {
  id?: string;
  userId: string;
  email: string;
  name: string;
  phone: string;
  subjects: string;
  streamIds: string[];
  status: TeacherStatus;
  createdAt: string;
};

export type Attachment = {
  path: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
};

export type Material = {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  title: string;
  body: string;
  link: string;
  streamIds: string[];
  attachment: Attachment | null;
  createdAt: string;
};

export type Student = {
  id: string;
  admissionNo: string;
  name: string;
  streamId: string;
};

export type StudentSession = {
  token: string;
  schoolName?: string;
  role?: 'student' | 'parent';
  name: string;
  admissionNo: string;
  streamId: string;
  streamName: string;
};

type ErrorShape = {
  response?: {
    status?: number;
    data?: { error?: unknown; message?: unknown };
  };
};

export function errMsg(e: unknown, fallback: string): string {
  const data = (e as ErrorShape | null)?.response?.data;
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (data && typeof data.message === 'string' && data.message)
    return data.message;
  return fallback;
}

export function statusOf(e: unknown): number {
  return (e as ErrorShape | null)?.response?.status || 0;
}

export function loadStudentSession(): StudentSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudentSession;
    return parsed && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStudentSession(s: StudentSession | null): void {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable; the session lasts for this visit only
  }
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const LETTERS = 'ABCDEFGH';

export type ExamPhase = 'upcoming' | 'open' | 'closed';

export type ExamQuestion = {
  id: string;
  type: 'mcq' | 'written';
  text: string;
  options: string[];
  marks: number;
  correct?: number;
};

export type TeacherExamSummary = {
  id: string;
  title: string;
  subject: string;
  streamIds: string[];
  startAt: string;
  endAt: string;
  totalMarks: number;
  questionCount: number;
  phase: ExamPhase;
  submitted: number;
  writing: number;
};

export type ExamDetail = {
  id: string;
  title: string;
  subject: string;
  instructions: string;
  teacherName: string;
  streamIds: string[];
  startAt: string;
  endAt: string;
  totalMarks: number;
  questions: ExamQuestion[];
};

export type Submission = {
  id: string;
  examId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  streamId: string;
  answers: Record<string, string>;
  status: 'in_progress' | 'submitted';
  autoSubmitted: boolean;
  startedAt: string;
  submittedAt: string;
  autoScore: number;
  marks: Record<string, number>;
  comment: string;
};

export type StudentExam = {
  id: string;
  title: string;
  subject: string;
  teacherName: string;
  instructions: string;
  startAt: string;
  endAt: string;
  questionCount: number;
  totalMarks: number;
  submission: { status: 'in_progress' | 'submitted'; submittedAt: string; autoSubmitted: boolean } | null;
};

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function phaseAt(e: { startAt: string; endAt: string }, now: number): ExamPhase {
  if (now < Date.parse(e.startAt)) return 'upcoming';
  if (now < Date.parse(e.endAt)) return 'open';
  return 'closed';
}

export function submissionTotal(
  exam: { questions: ExamQuestion[] },
  s: Submission,
): { score: number; pending: number } {
  let score = s.autoScore || 0;
  let pending = 0;
  exam.questions.forEach((q) => {
    if (q.type !== 'written') return;
    const m = s.marks ? s.marks[q.id] : undefined;
    if (typeof m === 'number') score += m;
    else pending += 1;
  });
  return { score: Math.round(score * 10) / 10, pending };
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Large phone photos are resized on the device before upload. Text and handwriting stay sharp at
// 2000 pixels, and the file is usually 5 to 10 times smaller, so it uploads much faster.
async function shrinkPhoto(file: File): Promise<File> {
  if (!SHRINKABLE_TYPES.includes(file.type) || file.size < 400 * 1024) return file;
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    const dot = file.name.lastIndexOf('.');
    const base = (dot > 0 ? file.name.slice(0, dot) : file.name) || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export type PreparedUpload = { name: string; size: number; data?: string; uploadId?: string; count?: number };

// Sends the whole file straight to storage with a one-time link from the server. This is the fastest way.
// Returns null if direct upload is not available, so the caller falls back to sending it through the server.
async function uploadDirect(
  file: File,
  who: 'teacher' | 'student',
  token: string,
  onProgress?: (percent: number) => void,
): Promise<PreparedUpload | null> {
  let link: { direct?: boolean; uploadId?: string; url?: string } = {};
  try {
    const r = await api.post(who === 'teacher' ? '/api/teacher/uploads/sign' : '/api/student/uploads/sign', { token });
    link = r.data || {};
  } catch {
    return null;
  }
  if (!link.direct || !link.url || !link.uploadId) return null;
  for (let attempt = 1; ; attempt++) {
    try {
      await putFile(link.url, file, (p) => onProgress && onProgress(Math.min(99, p)));
      break;
    } catch {
      // After two tries, fall back to sending the file through the server in pieces.
      if (attempt >= 2) return null;
      await pause(1500);
    }
  }
  if (onProgress) onProgress(100);
  return { name: file.name, size: file.size, uploadId: link.uploadId, count: 1 };
}

// Small files go in one request. Larger files go in 1 MB pieces, four at a time, and the server
// joins them back into one file. Returns what the save request needs to find the file.
export async function uploadFileInParts(
  file: File,
  who: 'teacher' | 'student',
  token: string,
  onProgress?: (percent: number) => void,
): Promise<PreparedUpload> {
  if (onProgress) onProgress(0);
  try {
    const prepared = await shrinkPhoto(file);
    const direct = await uploadDirect(prepared, who, token, onProgress);
    if (direct) return direct;
    if (prepared.size <= SINGLE_REQUEST_MAX) {
      const data = bufferToBase64(await prepared.arrayBuffer());
      return { name: prepared.name, size: prepared.size, data };
    }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    const count = Math.max(1, Math.ceil(prepared.size / PART_BYTES));
    const url = who === 'teacher' ? '/api/teacher/uploads/part' : '/api/student/uploads/part';
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < count) {
        const index = next;
        next += 1;
        const buf = await prepared.slice(index * PART_BYTES, (index + 1) * PART_BYTES).arrayBuffer();
        const data = bufferToBase64(buf);
        for (let attempt = 1; ; attempt++) {
          try {
            await api.post(url, { token, uploadId, index, data });
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            await pause(1000 * attempt);
          }
        }
        done += 1;
        if (onProgress) onProgress(Math.round((done / count) * 100));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, count) }, () => worker()));
    return { name: prepared.name, size: prepared.size, uploadId, count };
  } finally {
    if (onProgress) onProgress(-1);
  }
}

const BAD_SHEET_CHARS = ['/', '?', '*', '[', ']', ':', String.fromCharCode(92)];

export function safeFileTitle(s: string): string {
  const cleaned = s
    .split('')
    .filter((c) => /[A-Za-z0-9 _-]/.test(c))
    .join('')
    .trim();
  return cleaned || 'marks';
}

// Builds an Excel file in the browser. The spreadsheet library loads only when a download is asked for.
export async function downloadExcel(
  fileName: string,
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>,
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((s, idx) => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const width = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
    ws['!cols'] = Array.from({ length: width }, (_v, i) => ({
      wch: Math.min(40, Math.max(8, ...s.rows.map((r) => String(r[i] ?? '').length + 2))),
    }));
    let name = s.name
      .split('')
      .filter((c) => !BAD_SHEET_CHARS.includes(c))
      .join('')
      .slice(0, 28) || `Sheet ${idx + 1}`;
    while (used.has(name)) name = `${name.slice(0, 25)} ${idx + 1}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, fileName);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

