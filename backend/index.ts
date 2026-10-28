import {
  router,
  json,
  error,
  requireAuth,
  db,
  storage,
  increment,
  isAppDatabaseError,
  notifications,
  rebuildUserIds,
  isLocal,
} from '../server/platform';
import type { RouterContext, RouterMiddleware, RouterResponse, RouterRoutes } from '../server/platform';
import { createHash, randomUUID } from 'node:crypto';

// ===================== configuration =====================

const OWNER_EMAIL = 'linusomwoyo948@gmail.com';
const LEGACY_PRINCIPAL_EMAIL = 'linusomwoyo2@gmail.com';
const LEGACY_SCHOOL_ID = 'main';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PARTS = 24;
const PART_MAX_CHARS = 2900000;
const SESSION_DAYS = 14;
const EXAM_GRACE_MS = 90 * 1000;
const CACHE_TTL_MS = 20 * 1000;
const BACKUP_KEEP = 30;
const LOGIN_FAIL_LIMIT_IP = 40;
const LOGIN_FAIL_LIMIT_ADM = 8;
const ADM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-';
const FILE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const INTERNAL_SETTINGS = new Set(['backup-meta', 'restore-job', 'migration-v2', 'migration-v2-lock', 'file-copy-job']);
const CANONICAL_TABLES = [
  'schools',
  'school_names',
  'principal_index',
  'teachers',
  'students',
  'materials',
  'exams',
  'assignments',
  'exam_submissions',
  'assignment_submissions',
  'catalog',
  'settings',
  'streams',
  'announcements',
  'questions',
  'qbank',
  'parent_checks',
  'parent_check_counts',
];

// ===================== types =====================

type Ctx = RouterContext;
type Resp = RouterResponse;
type Rec = Record<string, unknown>;

type SchoolStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
type SchoolRec = {
  name: string;
  nameKey: string;
  principalEmail: string;
  principalUserId: string;
  principalName: string;
  phone: string;
  status: SchoolStatus;
  createdAt: string;
  decidedAt: string;
};
type SchoolRow = SchoolRec & { id: string };
type IndexRec = { schoolId: string };

type TeacherStatus = 'pending' | 'approved' | 'rejected';
type StreamRec = { name: string; createdAt: string };
type StreamItem = { id: string; name: string; createdAt: string };
type CatalogRec = { items: StreamItem[] };
type TeacherRec = {
  userId: string;
  schoolId?: string;
  email: string;
  name: string;
  phone: string;
  subjects: string;
  streamIds: string[];
  status: TeacherStatus;
  createdAt: string;
  updatedAt: string;
};
type StudentRec = {
  schoolId?: string;
  admissionNo: string;
  name: string;
  streamId: string;
  addedBy: string;
  createdAt: string;
};
type Attachment = { path: string; name: string; contentType: string; size: number };
type MaterialRec = {
  schoolId?: string;
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
type SessionRec = {
  studentId: string;
  streamId: string;
  schoolId?: string;
  expiresAt: string;
  role?: 'student' | 'parent';
};
type SettingsRec = { schoolName: string };
type QuestionType = 'mcq' | 'written';
type Question = { id: string; type: QuestionType; text: string; options: string[]; correct: number; marks: number };
type ExamRec = {
  schoolId?: string;
  teacherId: string;
  teacherName: string;
  title: string;
  subject: string;
  instructions: string;
  streamIds: string[];
  startAt: string;
  endAt: string;
  questions: Question[];
  totalMarks: number;
  createdAt: string;
};
type ExamRow = ExamRec & { id: string };
type SubmissionRec = {
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
  updatedAt: string;
};
type SubmissionRow = SubmissionRec & { id: string };
type AssignmentRec = {
  schoolId: string;
  teacherId: string;
  teacherName: string;
  title: string;
  subject: string;
  instructions: string;
  streamIds: string[];
  dueAt: string;
  totalMarks: number;
  attachment: Attachment | null;
  createdAt: string;
  submissionMode?: 'portal' | 'paper';
};
type AssignmentRow = AssignmentRec & { id: string };
type AssignmentSubRec = {
  assignmentId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  streamId: string;
  answer: string;
  attachment: Attachment | null;
  submittedAt: string;
  late: boolean;
  marks: number | null;
  feedback: string;
  markedAt: string;
};
type StatsRec = { students: number; teachers: number };
type ParentCheckRec = {
  assignmentId: string;
  studentId: string;
  streamId: string;
  schoolId: string;
  done: boolean;
  note: string;
  checkedAt: string;
};

async function getParentChecks(keys: string[]): Promise<Array<ParentCheckRec | null>> {
  const out: Array<ParentCheckRec | null> = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...(await db.get<ParentCheckRec>('parent_checks', keys.slice(i, i + 100))));
  }
  return out;
}
type BankRec = {
  teacherId: string;
  subject: string;
  topic: string;
  type: QuestionType;
  text: string;
  options: string[];
  correct: number;
  marks: number;
  createdAt: string;
};
type AnnouncementRec = {
  schoolId: string;
  authorId: string;
  authorName: string;
  authorRole: 'teacher' | 'principal';
  title: string;
  message: string;
  streamIds: string[];
  createdAt: string;
};
type QuestionRec = {
  schoolId: string;
  teacherId: string;
  itemType: 'material' | 'assignment';
  itemId: string;
  itemTitle: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  streamId: string;
  text: string;
  createdAt: string;
  answer: string;
  answeredAt: string;
};

type Actor = {
  userId: string;
  email: string;
  name: string;
  isOwner: boolean;
  principalSchool: SchoolRow | null;
  teacher: TeacherRec | null;
  school: SchoolRow | null;
  streamIds: string[];
};
type PrincipalActor = Actor & { principalSchool: SchoolRow };

type SnapshotKind = 'auto' | 'manual' | 'base' | 'uploaded' | 'safety';
type Snapshot = { version: number; createdAt: string; throughDay: string; tables: Record<string, Record<string, Rec>> };
type SnapshotInfo = { path: string; createdAt: string; records: number; size: number; kind: SnapshotKind };
type BackupMeta = { latest: string; lastProcessedDay: string; snapshots: SnapshotInfo[] };
type RestoreJob = {
  path: string;
  tables: string[];
  t: number;
  o: number;
  done: number;
  total: number;
  startedAt: string;
  by: string;
  finishedAt: string;
};

// ===================== small helpers =====================

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bodyOf(ctx: Ctx): Rec {
  const b = ctx.body;
  if (b && typeof b === 'object') return b as Rec;
  if (typeof b === 'string' && b) {
    try {
      const parsed: unknown = JSON.parse(b);
      if (parsed && typeof parsed === 'object') return parsed as Rec;
    } catch {
      return {};
    }
  }
  return {};
}

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function keyOf(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .filter(c => KEY_CHARS.includes(c))
    .join('');
}

function emailKey(email: string): string {
  return email
    .toLowerCase()
    .split('')
    .map(c => (KEY_CHARS.includes(c) ? c : '_'))
    .join('');
}

function schoolIdOf(rec: { schoolId?: string } | null | undefined): string {
  return (rec && rec.schoolId) || LEGACY_SCHOOL_ID;
}

function sidOf(rec: Rec): string {
  return typeof rec.schoolId === 'string' && rec.schoolId ? rec.schoolId : LEGACY_SCHOOL_ID;
}

function normAdm(v: unknown): string {
  return str(v, 40)
    .toUpperCase()
    .split('')
    .filter(c => ADM_CHARS.includes(c))
    .join('');
}

function studentKey(streamId: string, adm: string): string {
  return `${streamId}-${adm.split('/').join('_')}`;
}

function safeFileName(name: string): string {
  const cleaned = name
    .split('')
    .map(c => (FILE_CHARS.includes(c) ? c : '_'))
    .join('');
  return cleaned || 'attachment';
}

function byNewest(a: { createdAt: string }, b: { createdAt: string }): number {
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

function isSafeId(s: string): boolean {
  return s.length > 0 && s.length <= 200 && s.split('').every(c => ID_CHARS.includes(c));
}

function partKey(key: string): string {
  return isSafeId(key) && key.length <= 90 ? key : sha256(key).slice(0, 40);
}

const P = {
  schoolTeachers: (id: string) => `p_sch_tch_${partKey(id)}`,
  streamStudents: (id: string) => `p_stu_${partKey(id)}`,
  streamMaterials: (id: string) => `p_mat_${partKey(id)}`,
  teacherMaterials: (id: string) => `p_mat_t_${partKey(id)}`,
  streamExams: (id: string) => `p_exam_${partKey(id)}`,
  teacherExams: (id: string) => `p_exam_t_${partKey(id)}`,
  streamAssignments: (id: string) => `p_asg_${partKey(id)}`,
  teacherAssignments: (id: string) => `p_asg_t_${partKey(id)}`,
  examSubs: (id: string) => `p_esub_${partKey(id)}`,
  assignmentSubs: (id: string) => `p_asub_${partKey(id)}`,
  streamAnnouncements: (id: string) => `p_ann_${partKey(id)}`,
  authorAnnouncements: (id: string) => `p_ann_a_${partKey(id)}`,
  teacherQuestions: (id: string) => `p_q_t_${partKey(id)}`,
  studentQuestions: (id: string) => `p_q_s_${partKey(id)}`,
  teacherBank: (id: string) => `p_bank_${partKey(id)}`,
};

function chunkItems<T>(items: T[], maxCount = 400, maxBytes = 700000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    const size = JSON.stringify(it).length + 16;
    if (cur.length && (cur.length >= maxCount || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

function isQuotaError(e: unknown): boolean {
  return isAppDatabaseError(e) && e.code === 'AppDatabaseQuotaExceeded';
}

// ===================== short-lived cache =====================

const cache = new Map<string, { at: number; value: unknown }>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  return undefined;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.clear();
}

function cacheDrop(key: string): void {
  cache.delete(key);
}

// ===================== journalled writes (feed the backups) =====================

function journaled(table: string): boolean {
  return !(
    table === 'student_sessions' ||
    table.startsWith('rl_') ||
    table.startsWith('chg_') ||
    table.startsWith('audit_')
  );
}

async function journal(table: string, ids: string[]): Promise<void> {
  if (!ids.length || !journaled(table)) return;
  const day = dayKey(new Date());
  const items = ids.map(id => ({ id: sha256(`${table}|${id}`).slice(0, 40), record: { t: table, i: id } }));
  try {
    for (const c of chunkItems(items)) await db.tx.update(`chg_${day}`, c);
  } catch (e) {
    console.error('journal write failed', table, e);
  }
}

async function wAdd(table: string, records: Array<Rec & { id: string }>): Promise<Array<string | null>> {
  const results: Array<string | null> = [];
  for (const c of chunkItems(records)) {
    const res = await db.tx.add(table, c);
    results.push(...res);
  }
  await journal(
    table,
    results.filter((r): r is string => !!r)
  );
  return results;
}

async function wUpdate(
  table: string,
  items: Array<{ id: string; record: Rec; if?: Rec }>,
  options?: { patch?: boolean }
): Promise<boolean[]> {
  const results: boolean[] = [];
  const changed: string[] = [];
  for (const c of chunkItems(items)) {
    const res = await db.tx.update(table, c, options);
    res.forEach((ok, i) => {
      results.push(ok);
      if (ok) changed.push(c[i].id);
    });
  }
  await journal(table, changed);
  return results;
}

async function wDelete(table: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 400) await db.tx.delete(table, ids.slice(i, i + 400));
  await journal(table, ids);
}

// ===================== partition lists =====================

async function addPointers(tables: string[], id: string, createdAt: string): Promise<void> {
  for (const t of tables) await wUpdate(t, [{ id, record: { createdAt } }]);
}

async function removePointers(tables: string[], id: string): Promise<void> {
  for (const t of tables) await wDelete(t, [id]);
}

async function listIds(table: string, maxPages = 40): Promise<string[]> {
  const ids: string[] = [];
  let nextToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    let page: { items: Array<{ id: string }>; nextToken?: string };
    try {
      page = await db.list<{ createdAt: string }>(table, { limit: 500, nextToken });
    } catch (e) {
      if (i === 0 && !isQuotaError(e)) return ids;
      throw e;
    }
    page.items.forEach(it => ids.push(it.id));
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }
  return ids;
}

async function listPointers(table: string, maxPages = 40): Promise<Array<{ id: string; createdAt: string }>> {
  const out: Array<{ id: string; createdAt: string }> = [];
  let nextToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    let page: { items: Array<{ id: string; createdAt?: string }>; nextToken?: string };
    try {
      page = await db.list<{ createdAt: string }>(table, { limit: 500, nextToken });
    } catch (e) {
      if (i === 0 && !isQuotaError(e)) return out;
      throw e;
    }
    page.items.forEach(it => out.push({ id: it.id, createdAt: typeof it.createdAt === 'string' ? it.createdAt : '' }));
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }
  return out;
}

async function getMany<T>(table: string, ids: string[]): Promise<Array<T & { id: string }>> {
  const out: Array<T & { id: string }> = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const recs = await db.get<T>(table, chunk);
    recs.forEach((r, j) => {
      if (r) out.push({ ...r, id: chunk[j] });
    });
  }
  return out;
}

async function scanAll(table: string): Promise<Array<Rec & { id: string }>> {
  const out: Array<Rec & { id: string }> = [];
  let nextToken: string | undefined;
  for (let i = 0; i < 1000; i++) {
    let page: { items: Array<Rec & { id: string }>; nextToken?: string };
    try {
      page = await db.list<Rec>(table, { limit: 500, nextToken });
    } catch (e) {
      if (i === 0 && !isQuotaError(e)) return out;
      throw e;
    }
    out.push(...page.items);
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }
  return out;
}

// ===================== audit log and rate limits =====================

async function audit(by: string, action: string, detail: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7).split('-').join('');
  try {
    await db.tx.add(`audit_${month}`, [
      { id: `${Date.now()}-${randomUUID().slice(0, 8)}`, at: nowIso(), by, action, detail: detail.slice(0, 300) },
    ]);
  } catch (e) {
    console.error('audit write failed', e);
  }
}

function clientIp(ctx: Ctx): string {
  const ev = ctx.event || {};
  const rc = ev.requestContext || {};
  const headers = ev.headers || {};
  const raw =
    headers['x-nf-client-connection-ip'] ||
    (rc.http && rc.http.sourceIp) ||
    (rc.identity && rc.identity.sourceIp) ||
    headers['x-forwarded-for'] ||
    headers['X-Forwarded-For'] ||
    '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function hourKey(): string {
  return new Date().toISOString().slice(0, 13).split('-').join('').split('T').join('');
}

function limiterId(bucket: string, key: string): string {
  return sha256(`${bucket}|${key}`).slice(0, 40);
}

async function failCount(bucket: string, key: string): Promise<number> {
  try {
    const [r] = await db.get<{ n: number }>(`rl_${hourKey()}`, [limiterId(bucket, key)]);
    return r ? Number(r.n) || 0 : 0;
  } catch (e) {
    if (isQuotaError(e)) throw e;
    return 0;
  }
}

async function recordFail(bucket: string, key: string): Promise<void> {
  const table = `rl_${hourKey()}`;
  const id = limiterId(bucket, key);
  try {
    await db.tx.add(table, [{ id, n: 0 }]);
    await db.tx.update(table, [{ id, record: { n: increment(1) } }], { patch: true });
  } catch (e) {
    console.error('rate limit write failed', e);
  }
}

// ===================== uploads =====================

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function teacherOwner(userId: string): string {
  return `t-${partKey(userId)}`;
}

function studentOwner(studentId: string): string {
  return `s-${sha256(studentId).slice(0, 24)}`;
}

function filePartPath(ownerKey: string, uploadId: string, index: number): string {
  return `uploads/${ownerKey}/${uploadId}/${String(index).padStart(3, '0')}.part`;
}

function hasUpload(f: Rec | null): boolean {
  if (!f) return false;
  return (typeof f.data === 'string' && !!f.data) || (typeof f.uploadId === 'string' && !!f.uploadId);
}

// Large files arrive in 2 MB pieces so no single request is too big for the server.
async function savePart(ownerKey: string, b: Rec): Promise<Resp> {
  const uploadId = str(b.uploadId, 64);
  const index = Number(b.index);
  const data = typeof b.data === 'string' ? b.data : '';
  if (uploadId.length < 8 || !isSafeId(uploadId)) return error('Invalid upload.', 400);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
    return error('This file is too large. Files must be 20 MB or smaller.', 400);
  }
  if (!data || data.length > PART_MAX_CHARS) return error('Upload part is too large.', 400);
  const [ok] = await storage.write([
    { path: filePartPath(ownerKey, uploadId, index), content: data, contentType: 'application/octet-stream' },
  ]);
  if (!ok) return error('Could not upload the file. Please try again.', 500);
  return json({ ok: true });
}

async function saveUpload(raw: unknown, folder: string, ownerKey: string): Promise<Attachment | null | string> {
  const f = (raw && typeof raw === 'object' ? raw : null) as Rec | null;
  if (!hasUpload(f) || !f) return null;
  const fileName = str(f.name, 120) || 'attachment';
  const contentType = EXT_TYPES[fileExt(fileName)];
  if (!contentType) {
    return 'This type of file is not allowed. Use a PDF, Word, PowerPoint, Excel, text file or a photo (JPG, PNG).';
  }
  let content: string;
  let size: number;
  let partPaths: string[] = [];
  const uploadId = str(f.uploadId, 64);
  if (uploadId) {
    const count = Number(f.count);
    if (uploadId.length < 8 || !isSafeId(uploadId) || !Number.isInteger(count) || count < 1 || count > MAX_PARTS) {
      return 'The file upload was not valid. Please choose the file again.';
    }
    partPaths = Array.from({ length: count }, (_v, i) => filePartPath(ownerKey, uploadId, i));
    if (count === 1) {
      // Sent in one piece straight to storage: move it into place without copying it through the server.
      const size0 = await storage.size(partPaths[0]);
      if (size0 === null) return 'The file did not finish uploading. Please try again.';
      if (size0 > MAX_FILE_BYTES) {
        await deleteFiles(partPaths);
        return 'Files must be 20 MB or smaller.';
      }
      const finalPath = `${folder}/${safeFileName(fileName)}`;
      if (await storage.move(partPaths[0], finalPath)) {
        return { path: finalPath, name: fileName, contentType, size: size0 };
      }
    }
    const parts = await storage.read(partPaths);
    if (parts.length !== count || parts.some(p => !p || !p.content)) {
      return 'Part of the file did not finish uploading. Please try again.';
    }
    const buf = Buffer.concat(parts.map(p => Buffer.from(p.content || '', 'base64')));
    size = buf.length;
    if (size > MAX_FILE_BYTES) {
      await deleteFiles(partPaths);
      return 'Files must be 20 MB or smaller.';
    }
    content = buf.toString('base64');
  } else {
    content = String(f.data);
    size = Math.floor((content.length * 3) / 4);
    if (size > MAX_FILE_BYTES) return 'Files must be 20 MB or smaller.';
  }
  const path = `${folder}/${safeFileName(fileName)}`;
  const [written] = await storage.write([{ path, content, contentType }]);
  if (!written) return 'Could not save the file. Please try again.';
  if (partPaths.length) {
    try {
      await deleteFiles(partPaths);
    } catch (e) {
      console.error('upload part clean-up failed', e);
    }
  }
  return { path, name: fileName, contentType, size };
}

async function directUploadLink(ownerKey: string): Promise<Resp> {
  const uploadId = `${Date.now()}-${randomUUID().split('-').join('').slice(0, 12)}`;
  const url = await storage.uploadUrl(filePartPath(ownerKey, uploadId, 0));
  if (!url) return json({ direct: false });
  return json({ direct: true, uploadId, url });
}

// Removes pieces of uploads that were started more than a day ago but never finished.
async function cleanupStaleUploads(): Promise<number> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale: string[] = [];
  let nextToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await storage.list({ prefix: 'uploads/', nextToken, limit: 1000 });
    for (const p of page.paths) {
      const id = p.split('/')[2] || '';
      const ts = Number(id.split('-')[0]);
      if (Number.isFinite(ts) && ts > 0 && ts < cutoff) stale.push(p);
    }
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }
  await deleteFiles(stale);
  return stale.length;
}

async function attachUrls<T extends { attachment: Attachment | null }>(items: T[]) {
  const paths = items.map(i => i.attachment?.path).filter((p): p is string => !!p);
  const urlMap = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const res = await storage.url(paths.slice(i, i + 100));
    res.forEach(r => urlMap.set(r.path, r.url));
  }
  return items.map(i => ({
    ...i,
    attachment: i.attachment ? { ...i.attachment, url: urlMap.get(i.attachment.path) || '' } : null,
  }));
}

async function deleteFiles(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    if (chunk.length) await storage.delete(chunk);
  }
}

function safeLink(link: string): string | null {
  if (!link) return '';
  const lower = link.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return null;
  if (link.includes(' ') || link.includes('<') || link.includes('>')) return null;
  return link;
}

// ===================== schools =====================

async function claimName(nameKey: string, schoolId: string): Promise<boolean> {
  const [existing] = await db.get<IndexRec>('school_names', [nameKey], { consistent: true });
  if (existing) return existing.schoolId === schoolId;
  const [added] = await wAdd('school_names', [{ id: nameKey, schoolId }]);
  return !!added;
}

async function releaseName(nameKey: string, schoolId: string): Promise<void> {
  if (!nameKey) return;
  const [existing] = await db.get<IndexRec>('school_names', [nameKey], { consistent: true });
  if (existing && existing.schoolId === schoolId) await wDelete('school_names', [nameKey]);
}

async function ensureLegacySchool(): Promise<SchoolRow> {
  const [existing] = await db.get<SchoolRec>('schools', [LEGACY_SCHOOL_ID], { consistent: true });
  if (existing) return { ...existing, id: LEGACY_SCHOOL_ID };
  const [settings] = await db.get<SettingsRec>('settings', ['school']);
  const base = (settings && settings.schoolName) || 'Holiday Learning School';
  let name = base;
  if (!(await claimName(keyOf(name), LEGACY_SCHOOL_ID))) {
    name = `${base} (main)`;
    await claimName(keyOf(name), LEGACY_SCHOOL_ID);
  }
  const ts = nowIso();
  const rec: SchoolRec = {
    name,
    nameKey: keyOf(name),
    principalEmail: LEGACY_PRINCIPAL_EMAIL,
    principalUserId: '',
    principalName: 'Principal',
    phone: '',
    status: 'approved',
    createdAt: ts,
    decidedAt: ts,
  };
  await wUpdate('schools', [{ id: LEGACY_SCHOOL_ID, record: rec }]);
  await wUpdate('principal_index', [{ id: emailKey(LEGACY_PRINCIPAL_EMAIL), record: { schoolId: LEGACY_SCHOOL_ID } }]);
  return { ...rec, id: LEGACY_SCHOOL_ID };
}

async function getSchool(id: string, fresh = false): Promise<SchoolRow | null> {
  if (!id) return null;
  const key = `school:${id}`;
  if (!fresh) {
    const hit = cacheGet<SchoolRow | null>(key);
    if (hit !== undefined) return hit;
  }
  const [s] = await db.get<SchoolRec>('schools', [id], { consistent: true });
  let row: SchoolRow | null = s ? { ...s, id } : null;
  if (!row && id === LEGACY_SCHOOL_ID) row = await ensureLegacySchool();
  cacheSet(key, row);
  return row;
}

function dropSchool(id: string): void {
  cacheDrop(`school:${id}`);
}

function duplicateNameMessage(name: string): string {
  return `A school called “${name}” is already registered on the portal. Use your school’s full official name, or contact the site owner.`;
}

async function bumpStat(schoolId: string, field: 'students' | 'teachers', delta: number): Promise<void> {
  if (!delta) return;
  try {
    await db.tx.add('stats', [{ id: schoolId, students: 0, teachers: 0 }]);
    await wUpdate('stats', [{ id: schoolId, record: { [field]: increment(delta) } }], { patch: true });
  } catch (e) {
    console.error('stat update failed', e);
  }
}

// ===================== classes / streams =====================

function catalogId(schoolId: string): string {
  return schoolId === LEGACY_SCHOOL_ID ? 'streams' : `streams-${schoolId}`;
}

function sortStreams(items: StreamItem[]): StreamItem[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

async function loadCatalog(schoolId: string): Promise<StreamItem[]> {
  const key = `cat:${schoolId}`;
  const hit = cacheGet<StreamItem[]>(key);
  if (hit) return hit;
  const [cat] = await db.get<CatalogRec>('catalog', [catalogId(schoolId)], { consistent: true });
  let items: StreamItem[] = [];
  if (cat && Array.isArray(cat.items)) items = cat.items;
  else if (schoolId === LEGACY_SCHOOL_ID) {
    const legacy = await scanAll('streams');
    items = legacy.map(s => ({ id: s.id, name: String(s.name || ''), createdAt: String(s.createdAt || nowIso()) }));
  }
  cacheSet(key, items);
  return items;
}

async function saveCatalog(schoolId: string, items: StreamItem[]): Promise<boolean> {
  const [ok] = await wUpdate('catalog', [{ id: catalogId(schoolId), record: { items } }]);
  if (ok) cacheSet(`cat:${schoolId}`, items);
  return !!ok;
}

async function getStreams(schoolId: string): Promise<Array<{ id: string; name: string }>> {
  const items = await loadCatalog(schoolId);
  return sortStreams(items).map(s => ({ id: s.id, name: s.name }));
}

// ===================== who is calling =====================

async function getActor(ctx: Ctx): Promise<Actor> {
  const user = ctx.user!;
  const email = (user.email || '').trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL;
  let principalSchool: SchoolRow | null = null;
  if (email && !isOwner) {
    const [idx] = await db.get<IndexRec>('principal_index', [emailKey(email)], { consistent: true });
    if (idx) principalSchool = await getSchool(idx.schoolId);
    else if (email === LEGACY_PRINCIPAL_EMAIL) principalSchool = await ensureLegacySchool();
  }
  let teacher: TeacherRec | null = null;
  if (!isOwner && !principalSchool) {
    const [t] = await db.get<TeacherRec>('teachers', [user.userId], { consistent: true });
    teacher = t || null;
  }
  let school: SchoolRow | null = principalSchool;
  if (!school && teacher) school = await getSchool(schoolIdOf(teacher));
  let streamIds: string[] = [];
  if (principalSchool && principalSchool.status === 'approved') {
    streamIds = (await getStreams(principalSchool.id)).map(s => s.id);
  } else if (teacher && teacher.status === 'approved' && school && school.status === 'approved') {
    streamIds = teacher.streamIds || [];
  }
  const name = (principalSchool && principalSchool.principalName) || (teacher && teacher.name) || user.name || email;
  return { userId: user.userId, email, name, isOwner, principalSchool, teacher, school, streamIds };
}

function roleOf(a: Actor): string {
  if (a.isOwner) return 'owner';
  if (a.principalSchool) {
    const st = a.principalSchool.status;
    if (st === 'approved') return 'principal';
    if (st === 'suspended') return 'suspended';
    return st === 'pending' ? 'principal-pending' : 'principal-rejected';
  }
  if (a.teacher && a.school) {
    if (a.school.status === 'suspended') return 'suspended';
    if (a.school.status === 'approved') return a.teacher.status;
  }
  return 'unregistered';
}

const requireOwner: RouterMiddleware = async ctx => {
  const email = (ctx.user?.email || '').trim().toLowerCase();
  if (email !== OWNER_EMAIL) return error('Only the site owner can do this.', 403);
  return undefined;
};

async function principalActor(ctx: Ctx): Promise<PrincipalActor | Resp> {
  const a = await getActor(ctx);
  if (!a.principalSchool || a.principalSchool.status !== 'approved') {
    return error('Only an approved principal can do this.', 403);
  }
  return a as PrincipalActor;
}

async function staffActor(ctx: Ctx): Promise<Actor | Resp> {
  const actor = await getActor(ctx);
  if (actor.isOwner || actor.principalSchool) {
    return error(
      'Students, learning materials, assignments and exams are added by teachers. Principals approve teachers and manage classes.',
      403
    );
  }
  if (actor.teacher && actor.teacher.status === 'approved' && actor.school && actor.school.status === 'approved') {
    return actor;
  }
  return error('Your teacher account has not been approved by the principal yet.', 403);
}

function sessionError(): Resp {
  return error('Your session has expired. Please sign in again.', 401);
}

type StudentCtx = StudentRec & { id: string; schoolId: string; schoolName: string; role: 'student' | 'parent' };

// ---------- phone alerts for staff, and weekly usage counts ----------

let ownerUserId = '';

async function rememberOwner(userId: string): Promise<void> {
  if (!userId || ownerUserId === userId) return;
  ownerUserId = userId;
  try {
    await db.tx.update('settings', [{ id: 'owner-user', record: { userId } }]);
  } catch (e) {
    console.error('could not store owner id', e);
  }
}

async function getOwnerUserId(): Promise<string> {
  if (ownerUserId) return ownerUserId;
  const [r] = await db.get<{ userId: string }>('settings', ['owner-user']);
  ownerUserId = r && r.userId ? r.userId : '';
  return ownerUserId;
}

async function pushTo(userIds: string[], title: string, body: string): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  try {
    await notifications.send({ userIds: ids, notification: { title, body }, ttlSeconds: 86400 });
  } catch (e) {
    console.error('push failed', e);
  }
}

function weekKey(weeksAgo = 0): string {
  const d = new Date();
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday - weeksAgo * 7);
  return dayKey(new Date(monday));
}

type UsageField = 'logins' | 'posts' | 'submissions' | 'questions';
type UsageRec = Record<UsageField, number>;

async function bumpUsage(schoolId: string, field: UsageField): Promise<void> {
  const id = `${weekKey(0)}_${partKey(schoolId)}`;
  try {
    await db.tx.add('usage', [{ id, logins: 0, posts: 0, submissions: 0, questions: 0 }]);
    await db.tx.update('usage', [{ id, record: { [field]: increment(1) } }], { patch: true });
  } catch (e) {
    console.error('usage update failed', e);
  }
}

async function studentFromToken(token: string): Promise<StudentCtx | null> {
  if (!token || token.length > 200) return null;
  const hashed = sha256(token);
  const cached = cacheGet<StudentCtx>(`sess:${hashed}`);
  if (cached) return cached;
  const found = await loadStudentSession(token, hashed);
  if (found) cacheSet(`sess:${hashed}`, found);
  return found;
}

async function loadStudentSession(token: string, hashed: string): Promise<StudentCtx | null> {
  let [session] = await db.get<SessionRec>('student_sessions', [hashed], { consistent: true });
  if (!session && isSafeId(token)) {
    [session] = await db.get<SessionRec>('student_sessions', [token], { consistent: true });
  }
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  const [student] = await db.get<StudentRec>('students', [session.studentId]);
  if (!student) return null;
  const school = await getSchool(schoolIdOf(student));
  if (!school || school.status !== 'approved') return null;
  return {
    ...student,
    id: session.studentId,
    schoolId: school.id,
    schoolName: school.name,
    role: session.role === 'parent' ? 'parent' : 'student',
  };
}

// ===================== materials =====================

async function materialsWithUrls(items: Array<MaterialRec & { id: string }>) {
  return attachUrls(items);
}

// ===================== exams =====================

function examPhase(e: { startAt: string; endAt: string }, now = Date.now()): 'upcoming' | 'open' | 'closed' {
  if (now < Date.parse(e.startAt)) return 'upcoming';
  if (now < Date.parse(e.endAt)) return 'open';
  return 'closed';
}

function submissionKey(examId: string, studentId: string): string {
  return `${examId}_${studentId}`;
}

function scoreMcq(exam: ExamRec, answers: Record<string, string>): number {
  let total = 0;
  for (const q of exam.questions) {
    const a = answers[q.id];
    if (q.type === 'mcq' && a !== undefined && a !== '' && Number(a) === q.correct) total += q.marks;
  }
  return total;
}

function cleanAnswers(exam: ExamRec, raw: unknown): Record<string, string> {
  const src = raw && typeof raw === 'object' ? (raw as Rec) : {};
  const out: Record<string, string> = {};
  for (const q of exam.questions) {
    const v = src[q.id];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).slice(0, 5000);
    if (q.type === 'mcq') {
      const n = Number(s);
      if (s !== '' && Number.isInteger(n) && n >= 0 && n < q.options.length) out[q.id] = String(n);
    } else if (s.trim()) {
      out[q.id] = s;
    }
  }
  return out;
}

function parseQuestions(raw: unknown): Question[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Add at least one question.';
  if (raw.length > 100) return 'An exam can have at most 100 questions.';
  const out: Question[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = i + 1;
    const q = (raw[i] && typeof raw[i] === 'object' ? raw[i] : {}) as Rec;
    const type: QuestionType = q.type === 'mcq' ? 'mcq' : 'written';
    const text = str(q.text, 3000);
    if (!text) return `Question ${n} has no question text.`;
    const marks = Number(q.marks);
    if (!Number.isFinite(marks) || marks <= 0 || marks > 100) return `Give question ${n} marks between 1 and 100.`;
    let options: string[] = [];
    let correct = -1;
    if (type === 'mcq') {
      const rawOptions: unknown[] = Array.isArray(q.options) ? q.options : [];
      options = rawOptions.map(o => str(o, 500));
      if (options.length < 2) return `Question ${n} needs at least two answer choices.`;
      if (options.length > 8) return `Question ${n} can have at most eight answer choices.`;
      if (options.some(o => !o)) return `Fill in every answer choice for question ${n}.`;
      correct = Number(q.correct);
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        return `Mark the correct answer for question ${n}.`;
      }
    }
    out.push({ id: `q${n}`, type, text, options, correct, marks: Math.round(marks * 10) / 10 });
  }
  return out;
}

async function finaliseIfExpired(exam: ExamRec, sub: SubmissionRow): Promise<SubmissionRow> {
  if (sub.status === 'submitted') return sub;
  if (Date.now() < Date.parse(exam.endAt) + EXAM_GRACE_MS) return sub;
  const patch = {
    status: 'submitted' as const,
    autoSubmitted: true,
    submittedAt: exam.endAt,
    autoScore: scoreMcq(exam, sub.answers || {}),
    updatedAt: nowIso(),
  };
  await wUpdate('exam_submissions', [{ id: sub.id, record: patch, if: { status: 'in_progress' } }], { patch: true });
  return { ...sub, ...patch };
}

function studentExamView(exam: ExamRow) {
  return {
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    teacherName: exam.teacherName,
    instructions: exam.instructions,
    startAt: exam.startAt,
    endAt: exam.endAt,
    totalMarks: exam.totalMarks,
    questions: exam.questions.map(q => ({ id: q.id, type: q.type, text: q.text, options: q.options, marks: q.marks })),
  };
}

function studentResult(exam: ExamRec, sub: SubmissionRec) {
  const auto = sub.status === 'submitted' ? sub.autoScore || 0 : scoreMcq(exam, sub.answers || {});
  const marks = sub.marks || {};
  let written = 0;
  let pending = 0;
  for (const q of exam.questions) {
    if (q.type !== 'written') continue;
    const m = marks[q.id];
    if (typeof m === 'number') written += m;
    else pending += 1;
  }
  return { score: Math.round((auto + written) * 10) / 10, totalMarks: exam.totalMarks, pending, comment: sub.comment || '' };
}

function resultsOpenAt(exam: { endAt: string }): number {
  return Date.parse(exam.endAt) + EXAM_GRACE_MS;
}

async function loadOwnExam(actor: Actor, id: string): Promise<ExamRow | Resp> {
  const [exam] = await db.get<ExamRec>('exams', [id], { consistent: true });
  if (!exam) return error('Exam not found.', 404);
  if (exam.teacherId !== actor.userId) return error('You can only manage exams you created.', 403);
  return { ...exam, id };
}

async function rosterNames(streamIds: string[]): Promise<Array<{ id: string; name: string; admissionNo: string; streamId: string }>> {
  const out: Array<{ id: string; name: string; admissionNo: string; streamId: string }> = [];
  for (const streamId of streamIds) {
    const ids = await listIds(P.streamStudents(streamId));
    const recs = await getMany<StudentRec>('students', ids);
    recs.forEach(r => out.push({ id: r.id, name: r.name, admissionNo: r.admissionNo, streamId }));
  }
  return out;
}

// ===================== assignments =====================

function isMarked(s: { marks?: number | null }): boolean {
  return typeof s.marks === 'number';
}

function modeOf(a: { submissionMode?: string }): 'portal' | 'paper' {
  return a.submissionMode === 'paper' ? 'paper' : 'portal';
}

function assignmentSubKey(assignmentId: string, studentId: string): string {
  return `${assignmentId}_${studentId}`;
}

async function loadOwnAssignment(actor: Actor, id: string): Promise<AssignmentRow | Resp> {
  const [a] = await db.get<AssignmentRec>('assignments', [id], { consistent: true });
  if (!a) return error('Assignment not found.', 404);
  if (a.teacherId !== actor.userId) return error('You can only manage assignments you created.', 403);
  return { ...a, id };
}

async function loadStudentAssignment(streamId: string, id: string): Promise<AssignmentRow | Resp> {
  const [a] = await db.get<AssignmentRec>('assignments', [id], { consistent: true });
  if (!a || !(a.streamIds || []).includes(streamId)) return error('Assignment not found.', 404);
  return { ...a, id };
}

// ===================== editing, announcements, questions =====================

async function syncStreamPointers(
  oldIds: string[],
  newIds: string[],
  table: (id: string) => string,
  itemId: string,
  createdAt: string
): Promise<void> {
  const removed = oldIds.filter(s => !newIds.includes(s));
  const added = newIds.filter(s => !oldIds.includes(s));
  if (removed.length) await removePointers(removed.map(table), itemId);
  if (added.length) await addPointers(added.map(table), itemId, createdAt);
}

async function announcerActor(ctx: Ctx): Promise<Actor | Resp> {
  const a = await getActor(ctx);
  if (a.principalSchool && a.principalSchool.status === 'approved') return a;
  if (a.teacher && a.teacher.status === 'approved' && a.school && a.school.status === 'approved') return a;
  return error('Only approved teachers and principals can post announcements.', 403);
}

// ===================== backups =====================

function parseStored(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
  }
}

const snapshotCache = new Map<string, Snapshot>();

async function readSnapshot(path: string): Promise<Snapshot | null> {
  if (!path) return null;
  const hit = snapshotCache.get(path);
  if (hit) return hit;
  const [f] = await storage.read([path]);
  if (!f || !f.content) return null;
  try {
    const snap = parseStored(f.content) as Snapshot;
    if (!snap || typeof snap.tables !== 'object' || !snap.tables) return null;
    snapshotCache.clear();
    snapshotCache.set(path, snap);
    return snap;
  } catch {
    return null;
  }
}

function countRecords(snap: Snapshot): number {
  let n = 0;
  Object.keys(snap.tables).forEach(t => {
    n += Object.keys(snap.tables[t]).length;
  });
  return n;
}

async function saveSnapshotFile(snap: Snapshot, kind: SnapshotKind): Promise<SnapshotInfo> {
  const stamp = new Date().toISOString().split(':').join('-').split('.').join('-');
  const path = `backups/snapshots/${stamp}-${kind}.json`;
  const content = JSON.stringify(snap);
  const [ok] = await storage.write([{ path, content, contentType: 'application/json' }]);
  if (!ok) throw new Error('Could not save the backup file.');
  return { path, createdAt: nowIso(), records: countRecords(snap), size: content.length, kind };
}

async function getMeta(): Promise<BackupMeta | null> {
  const [m] = await db.get<BackupMeta>('settings', ['backup-meta'], { consistent: true });
  return m || null;
}

async function addToMeta(
  meta: BackupMeta | null,
  info: SnapshotInfo,
  makeLatest: boolean,
  throughDay?: string
): Promise<BackupMeta> {
  const next: BackupMeta = {
    latest: makeLatest || !meta ? info.path : meta.latest,
    lastProcessedDay: throughDay || (meta ? meta.lastProcessedDay : dayKey(new Date())),
    snapshots: [...(meta ? meta.snapshots : []), info],
  };
  const removed: string[] = [];
  while (next.snapshots.length > BACKUP_KEEP) {
    const idx = next.snapshots.findIndex(s => s.path !== next.latest);
    if (idx < 0) break;
    removed.push(next.snapshots[idx].path);
    next.snapshots.splice(idx, 1);
  }
  await db.tx.update('settings', [{ id: 'backup-meta', record: next }]);
  if (removed.length) {
    try {
      await storage.delete(removed);
    } catch (e) {
      console.error('old backup clean-up failed', e);
    }
  }
  return next;
}

function restorableTable(name: string): boolean {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(name) || name.includes('__')) return false;
  return CANONICAL_TABLES.includes(name) || name === 'stats' || name.startsWith('p_');
}

// Builds a complete copy of every record. Used once to create the first backup (and to
// create the faster per-class lists from existing data), never on a schedule.
async function buildFull(writePartitions: boolean): Promise<Snapshot> {
  const tables: Record<string, Record<string, Rec>> = {};
  const data: Record<string, Array<Rec & { id: string }>> = {};
  for (const t of CANONICAL_TABLES) {
    data[t] = await scanAll(t);
    for (const item of data[t]) {
      if (t === 'settings' && INTERNAL_SETTINGS.has(item.id)) continue;
      const { id, ...rest } = item;
      if (!tables[t]) tables[t] = {};
      tables[t][id] = rest;
    }
  }
  const parts: Record<string, Record<string, Rec>> = {};
  const addPart = (table: string, id: string, createdAt: unknown) => {
    if (!parts[table]) parts[table] = {};
    parts[table][id] = { createdAt: typeof createdAt === 'string' ? createdAt : '' };
  };
  const stats: Record<string, StatsRec> = {};
  const stat = (sid: string): StatsRec => {
    if (!stats[sid]) stats[sid] = { students: 0, teachers: 0 };
    return stats[sid];
  };
  for (const t of data.teachers || []) {
    const sid = sidOf(t);
    addPart(P.schoolTeachers(sid), t.id, t.createdAt);
    if (t.status === 'approved') stat(sid).teachers += 1;
  }
  for (const s of data.students || []) {
    addPart(P.streamStudents(String(s.streamId || '')), s.id, s.createdAt);
    stat(sidOf(s)).students += 1;
  }
  for (const m of data.materials || []) {
    strArr(m.streamIds).forEach(sid => addPart(P.streamMaterials(sid), m.id, m.createdAt));
    addPart(P.teacherMaterials(String(m.teacherId || '')), m.id, m.createdAt);
  }
  for (const e of data.exams || []) {
    strArr(e.streamIds).forEach(sid => addPart(P.streamExams(sid), e.id, e.createdAt));
    addPart(P.teacherExams(String(e.teacherId || '')), e.id, e.createdAt);
  }
  for (const a of data.assignments || []) {
    strArr(a.streamIds).forEach(sid => addPart(P.streamAssignments(sid), a.id, a.createdAt));
    addPart(P.teacherAssignments(String(a.teacherId || '')), a.id, a.createdAt);
  }
  for (const s of data.exam_submissions || []) addPart(P.examSubs(String(s.examId || '')), s.id, s.startedAt);
  for (const s of data.assignment_submissions || []) {
    addPart(P.assignmentSubs(String(s.assignmentId || '')), s.id, s.submittedAt);
  }
  for (const an of data.announcements || []) {
    strArr(an.streamIds).forEach(sid => addPart(P.streamAnnouncements(sid), an.id, an.createdAt));
    addPart(P.authorAnnouncements(String(an.authorId || '')), an.id, an.createdAt);
  }
  for (const bq of data.qbank || []) addPart(P.teacherBank(String(bq.teacherId || '')), bq.id, bq.createdAt);
  for (const q of data.questions || []) {
    addPart(P.teacherQuestions(String(q.teacherId || '')), q.id, q.createdAt);
    addPart(P.studentQuestions(String(q.studentId || '')), q.id, q.createdAt);
  }
  if (writePartitions) {
    for (const table of Object.keys(parts)) {
      const items = Object.keys(parts[table]).map(id => ({ id, record: parts[table][id] }));
      for (const c of chunkItems(items)) await db.tx.update(table, c);
    }
    const statItems = Object.keys(stats).map(id => ({ id, record: { students: stats[id].students, teachers: stats[id].teachers } }));
    for (const c of chunkItems(statItems)) await db.tx.update('stats', c);
  }
  Object.keys(parts).forEach(t => {
    tables[t] = parts[t];
  });
  tables.stats = {};
  Object.keys(stats).forEach(id => {
    tables.stats[id] = { students: stats[id].students, teachers: stats[id].teachers };
  });
  return { version: 2, createdAt: nowIso(), throughDay: dayKey(new Date()), tables };
}

function daysFrom(start: string, end: string): string[] {
  const toTime = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)));
  const endT = toTime(end);
  let t = toTime(start);
  if (!Number.isFinite(t) || t > endT) t = endT;
  const out: string[] = [];
  for (let i = 0; i < 400 && t <= endT; i++) {
    out.push(dayKey(new Date(t)));
    t += 86400000;
  }
  return out;
}

// Incremental backup: start from the last backup file and apply only the records that changed.
async function runBackup(kind: SnapshotKind): Promise<SnapshotInfo> {
  await ensureMigrated();
  let meta = await getMeta();
  const snap = meta ? await readSnapshot(meta.latest) : null;
  if (!meta || !snap) {
    const full = await buildFull(false);
    const info = await saveSnapshotFile(full, 'base');
    await addToMeta(meta, info, true, full.throughDay);
    return info;
  }
  const today = dayKey(new Date());
  const changed = new Map<string, Set<string>>();
  for (const day of daysFrom(meta.lastProcessedDay || today, today)) {
    let nextToken: string | undefined;
    for (let i = 0; i < 400; i++) {
      let page: { items: Array<{ id: string; t?: unknown; i?: unknown }>; nextToken?: string };
      try {
        page = await db.list<{ t: string; i: string }>(`chg_${day}`, { limit: 500, nextToken });
      } catch (e) {
        if (i === 0 && !isQuotaError(e)) break;
        throw e;
      }
      for (const m of page.items) {
        if (typeof m.t !== 'string' || typeof m.i !== 'string') continue;
        if (!changed.has(m.t)) changed.set(m.t, new Set());
        changed.get(m.t)!.add(m.i);
      }
      if (!page.nextToken) break;
      nextToken = page.nextToken;
    }
  }
  const tables = snap.tables;
  for (const [table, idSet] of Array.from(changed.entries())) {
    const ids = Array.from(idSet).filter(id => !(table === 'settings' && INTERNAL_SETTINGS.has(id)));
    if (!tables[table]) tables[table] = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const recs = await db.get<Rec>(table, chunk);
      recs.forEach((r, j) => {
        if (r) tables[table][chunk[j]] = r;
        else delete tables[table][chunk[j]];
      });
    }
  }
  const next: Snapshot = { version: 2, createdAt: nowIso(), throughDay: today, tables };
  const info = await saveSnapshotFile(next, kind);
  meta = await addToMeta(meta, info, true, today);
  snapshotCache.clear();
  snapshotCache.set(info.path, next);
  return info;
}

async function restoreStep(by: string): Promise<{ done: number; total: number; finished: boolean }> {
  const [job] = await db.get<RestoreJob>('settings', ['restore-job'], { consistent: true });
  if (!job || job.finishedAt) throw new Error('NO_JOB');
  const snap = await readSnapshot(job.path);
  if (!snap) throw new Error('The backup file could not be read.');
  let t = job.t;
  let o = job.o;
  let done = job.done;
  const deadline = Date.now() + 8000;
  while (t < job.tables.length && Date.now() < deadline) {
    const table = job.tables[t];
    const recs = snap.tables[table] || {};
    const ids = Object.keys(recs)
      .sort()
      .filter(id => !(table === 'settings' && INTERNAL_SETTINGS.has(id)));
    if (o >= ids.length) {
      t += 1;
      o = 0;
      continue;
    }
    const slice = ids.slice(o, o + 300).map(id => ({ id, record: recs[id] }));
    const first = chunkItems(slice)[0];
    await wUpdate(table, first);
    o += first.length;
    done += first.length;
  }
  const finished = t >= job.tables.length;
  await db.tx.update(
    'settings',
    [{ id: 'restore-job', record: { t, o, done, finishedAt: finished ? nowIso() : '' } }],
    { patch: true }
  );
  if (finished) {
    cache.clear();
    try {
      await rebuildUserIds();
    } catch (e) {
      console.error('could not match accounts after restore', e);
    }
    await audit(by, 'Restore finished', job.path);
  }
  return { done, total: job.total, finished };
}

type FileCopyJob = {
  total: number;
  next: number;
  copied: number;
  failed: string[];
  startedAt: string;
  finishedAt: string;
};

const FILE_COPY_LIST = 'backups/file-copy-list.json';

function copyablePath(path: string): boolean {
  if (!path || path.length > 400 || path.startsWith('/') || path.includes('..')) return false;
  if (path.startsWith('backups/') || path.startsWith('uploads/')) return false;
  return path.split('/').every(seg => seg.length > 0 && seg.split('').every(c => FILE_CHARS.includes(c)));
}

function uploadPartPath(uploadId: string, index: number): string {
  return `backups/uploads/${uploadId}/${String(index).padStart(4, '0')}.part`;
}

// ===================== one-time move to the faster data layout =====================

let migrated = false;

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  const [flag] = await db.get<{ done: boolean }>('settings', ['migration-v2'], { consistent: true });
  if (flag && flag.done) {
    migrated = true;
    return;
  }
  const now = Date.now();
  const [got] = await db.tx.add('settings', [{ id: 'migration-v2-lock', at: now }]);
  if (!got) {
    const [lock] = await db.get<{ at: number }>('settings', ['migration-v2-lock'], { consistent: true });
    if (lock && now - lock.at < 5 * 60 * 1000) {
      for (let i = 0; i < 10; i++) {
        await sleep(2000);
        const [f] = await db.get<{ done: boolean }>('settings', ['migration-v2'], { consistent: true });
        if (f && f.done) {
          migrated = true;
          return;
        }
      }
      return;
    }
    const [taken] = await db.tx.update(
      'settings',
      [{ id: 'migration-v2-lock', record: { at: now }, if: { at: lock ? lock.at : undefined } }],
      { patch: true }
    );
    if (!taken) return;
  }
  const full = await buildFull(true);
  const meta = await getMeta();
  if (!meta) {
    const info = await saveSnapshotFile(full, 'base');
    await addToMeta(null, info, true, full.throughDay);
  }
  await db.tx.update('settings', [{ id: 'migration-v2', record: { done: true, at: nowIso() } }]);
  migrated = true;
}

// ===================== route middleware =====================

const checkParams: RouterMiddleware = async ctx => {
  const params = ctx.params || {};
  for (const k of Object.keys(params)) {
    if (!isSafeId(String(params[k] || ''))) return error('Invalid request.', 400);
  }
  return undefined;
};

const migrate: RouterMiddleware = async () => {
  await ensureMigrated();
  return undefined;
};

// ===================== routes =====================

const routes: RouterRoutes = {
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'POST /api/teacher/uploads/part': [
    requireAuth(),
    // Pieces are stored under the signed-in user's own folder. The full approval checks run once,
    // when the material or assignment is saved, instead of on every piece.
    async ctx => savePart(teacherOwner(ctx.user!.userId), bodyOf(ctx)),
  ],

  // A one-time link the browser uses to send a file straight to storage (much faster than in pieces).
  'POST /api/teacher/uploads/sign': [
    requireAuth(),
    async ctx => directUploadLink(teacherOwner(ctx.user!.userId)),
  ],

  'POST /api/student/uploads/sign': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      return directUploadLink(studentOwner(student.id));
    },
  ],

  'POST /api/student/uploads/part': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      return savePart(studentOwner(student.id), b);
    },
  ],

  // ---------- public ----------

  'GET /api/site': [
    async () => {
      let siteName = cacheGet<string>('site');
      if (siteName === undefined) {
        const [s] = await db.get<{ siteName: string }>('settings', ['site']);
        siteName = (s && s.siteName) || '';
        cacheSet('site', siteName);
      }
      return json({ siteName });
    },
  ],

  'GET /api/schools/find': [
    async ctx => {
      const name = str(ctx.query?.name, 120);
      const key = keyOf(name);
      if (!key) return error('Enter the school name.', 400);
      await getSchool(LEGACY_SCHOOL_ID);
      const [idx] = await db.get<IndexRec>('school_names', [key]);
      const school = idx ? await getSchool(idx.schoolId) : null;
      if (!school) {
        return error(`No school called “${name}” is registered on the portal. Check the exact school name.`, 404);
      }
      if (school.status === 'suspended') return error('This school’s account is paused. Please contact your school.', 403);
      if (school.status !== 'approved') return error('This school is not open on the portal yet.', 403);
      return json({ school: { id: school.id, name: school.name }, streams: await getStreams(school.id) });
    },
  ],

  'GET /api/me': [
    requireAuth(),
    async ctx => {
      const a = await getActor(ctx);
      if (a.isOwner) await rememberOwner(a.userId);
      const school = a.school;
      const open = !!school && school.status === 'approved';
      return json({
        role: roleOf(a),
        email: a.email,
        name: a.name,
        teacher: a.teacher,
        school: school ? { id: school.id, name: school.name, status: school.status } : null,
        streams: open && school ? await getStreams(school.id) : [],
        myStreamIds: a.streamIds,
        principalRequest: a.principalSchool
          ? {
              schoolName: a.principalSchool.name,
              principalName: a.principalSchool.principalName,
              phone: a.principalSchool.phone,
              status: a.principalSchool.status,
            }
          : null,
      });
    },
  ],

  // ---------- site owner ----------

  'POST /api/owner/site': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const siteName = str(bodyOf(ctx).siteName, 80);
      if (!siteName) return error('Enter a name for the website.', 400);
      const [ok] = await wUpdate('settings', [{ id: 'site', record: { siteName } }]);
      if (!ok) return error('Could not save the website name.', 500);
      cacheSet('site', siteName);
      await audit(ctx.user?.email || '', 'Website name changed', siteName);
      return json({ siteName });
    },
  ],

  'GET /api/owner/schools': [
    requireAuth(),
    requireOwner,
    async () => {
      const schools = await scanAll('schools');
      const stats = await getMany<StatsRec>('stats', schools.map(s => s.id));
      const statMap = new Map(stats.map(s => [s.id, s]));
      const rows = await Promise.all(
        schools.map(async raw => {
          const s = raw as unknown as SchoolRow;
          const active = s.status === 'approved' || s.status === 'suspended';
          const classes = active ? (await loadCatalog(s.id)).length : 0;
          const st = statMap.get(s.id);
          return {
            id: s.id,
            name: s.name,
            principalName: s.principalName,
            principalEmail: s.principalEmail,
            phone: s.phone,
            status: s.status,
            createdAt: s.createdAt,
            classes,
            teachers: st ? Math.max(0, Number(st.teachers) || 0) : 0,
            students: st ? Math.max(0, Number(st.students) || 0) : 0,
          };
        })
      );
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return json({ schools: rows });
    },
  ],

  'POST /api/owner/schools/:id': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const status = bodyOf(ctx).status;
      if (status !== 'approved' && status !== 'rejected' && status !== 'suspended') {
        return error('Choose approve, decline or pause.', 400);
      }
      const [ok] = await wUpdate('schools', [{ id: ctx.params.id, record: { status, decidedAt: nowIso() } }], {
        patch: true,
      });
      if (!ok) return error('School not found.', 404);
      dropSchool(ctx.params.id);
      const school = await getSchool(ctx.params.id, true);
      await audit(ctx.user?.email || '', `School ${status}`, school ? school.name : ctx.params.id);
      return json({ ok: true });
    },
  ],

  'DELETE /api/owner/schools/:id': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const school = await getSchool(ctx.params.id, true);
      if (!school) return error('School not found.', 404);
      if (school.status === 'approved' || school.status === 'suspended') {
        return error('Only pending or declined requests can be removed. Pause an active school instead.', 400);
      }
      await releaseName(school.nameKey, school.id);
      const ek = emailKey(school.principalEmail);
      const [idx] = await db.get<IndexRec>('principal_index', [ek], { consistent: true });
      if (idx && idx.schoolId === school.id) await wDelete('principal_index', [ek]);
      await wDelete('schools', [school.id]);
      dropSchool(school.id);
      await audit(ctx.user?.email || '', 'School request removed', school.name);
      return json({ ok: true });
    },
  ],

  'GET /api/owner/audit': [
    requireAuth(),
    requireOwner,
    async () => {
      const now = new Date();
      const months = [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))].map(d =>
        d.toISOString().slice(0, 7).split('-').join('')
      );
      const events: Array<Rec & { id: string }> = [];
      for (const m of months) {
        try {
          const page = await db.list<Rec>(`audit_${m}`, { limit: 200 });
          events.push(...page.items);
        } catch (e) {
          if (isQuotaError(e)) throw e;
        }
      }
      events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      return json({ events: events.slice(0, 100) });
    },
  ],

  'GET /api/owner/backups': [
    requireAuth(),
    requireOwner,
    async () => {
      const meta = await getMeta();
      const snaps = meta ? meta.snapshots : [];
      const urls = snaps.length ? await storage.url(snaps.map(s => s.path)) : [];
      const urlMap = new Map(urls.map(u => [u.path, u.url]));
      const [job] = await db.get<RestoreJob>('settings', ['restore-job'], { consistent: true });
      return json({
        snapshots: [...snaps].reverse().map(s => ({ ...s, url: urlMap.get(s.path) || '' })),
        restore: job && !job.finishedAt ? { path: job.path, done: job.done, total: job.total } : null,
      });
    },
  ],

  'POST /api/owner/backups': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const info = await runBackup('manual');
      await audit(ctx.user?.email || '', 'Backup made', `${info.records} records`);
      return json({ backup: info });
    },
  ],

  'POST /api/owner/backups/restore/start': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const b = bodyOf(ctx);
      if (str(b.confirm, 20) !== 'RESTORE') return error('Type RESTORE to confirm.', 400);
      const path = str(b.path, 300);
      const meta = await getMeta();
      if (!meta || !meta.snapshots.some(s => s.path === path)) return error('That backup was not found.', 404);
      const target = await readSnapshot(path);
      if (!target) return error('That backup file could not be read.', 400);
      const tables = Object.keys(target.tables).filter(restorableTable).sort();
      let total = 0;
      tables.forEach(t => {
        total += Object.keys(target.tables[t]).filter(id => !(t === 'settings' && INTERNAL_SETTINGS.has(id))).length;
      });
      // Keep a copy of the data as it is now, in case the restore needs to be undone.
      await runBackup('safety');
      const by = ctx.user?.email || '';
      const job: RestoreJob = { path, tables, t: 0, o: 0, done: 0, total, startedAt: nowIso(), by, finishedAt: '' };
      await db.tx.update('settings', [{ id: 'restore-job', record: job }]);
      await audit(by, 'Restore started', path);
      return json({ total });
    },
  ],

  'POST /api/owner/backups/restore/step': [
    requireAuth(),
    requireOwner,
    async ctx => {
      try {
        return json(await restoreStep(ctx.user?.email || ''));
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'NO_JOB') return error('There is no restore in progress.', 400);
        throw e;
      }
    },
  ],

  'POST /api/owner/backups/upload-chunk': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const b = bodyOf(ctx);
      const uploadId = str(b.uploadId, 64);
      const index = Number(b.index);
      const data = typeof b.data === 'string' ? b.data : '';
      if (uploadId.length < 8 || !isSafeId(uploadId)) return error('Invalid upload.', 400);
      if (!Number.isInteger(index) || index < 0 || index > 400) return error('Invalid upload part.', 400);
      if (!data || data.length > 2200000) return error('Upload part is too large.', 400);
      const [ok] = await storage.write([
        { path: uploadPartPath(uploadId, index), content: data, contentType: 'application/octet-stream' },
      ]);
      if (!ok) return error('Could not save the upload. Please try again.', 500);
      return json({ ok: true });
    },
  ],

  'POST /api/owner/backups/upload-finish': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const b = bodyOf(ctx);
      const uploadId = str(b.uploadId, 64);
      const count = Number(b.count);
      if (uploadId.length < 8 || !isSafeId(uploadId)) return error('Invalid upload.', 400);
      if (!Number.isInteger(count) || count < 1 || count > 400) return error('Invalid upload.', 400);
      const paths = Array.from({ length: count }, (_v, i) => uploadPartPath(uploadId, i));
      const files = await storage.read(paths);
      if (files.some(f => !f || !f.content)) return error('Part of the file is missing. Please upload it again.', 400);
      let parsed: unknown = null;
      try {
        const buf = Buffer.concat(files.map(f => Buffer.from(f.content || '', 'base64')));
        parsed = JSON.parse(buf.toString('utf8'));
      } catch {
        try {
          parsed = JSON.parse(files.map(f => f.content || '').join(''));
        } catch {
          parsed = null;
        }
      }
      await deleteFiles(paths);
      const raw = parsed as Snapshot | null;
      if (!raw || typeof raw !== 'object' || !raw.tables || typeof raw.tables !== 'object') {
        return error('This file is not a backup from this website.', 400);
      }
      const tables: Record<string, Record<string, Rec>> = {};
      Object.keys(raw.tables).forEach(t => {
        const recs = raw.tables[t];
        if (restorableTable(t) && recs && typeof recs === 'object') tables[t] = recs;
      });
      const clean: Snapshot = {
        version: 2,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
        throughDay: typeof raw.throughDay === 'string' ? raw.throughDay : dayKey(new Date()),
        tables,
      };
      if (!countRecords(clean)) return error('This backup file has no records in it.', 400);
      const info = await saveSnapshotFile(clean, 'uploaded');
      await addToMeta(await getMeta(), info, false);
      await audit(ctx.user?.email || '', 'Backup file uploaded', `${info.records} records`);
      return json({ backup: info });
    },
  ],

  // ---------- moving files between sites ----------

  // A list of every attached file with a short-lived download link, for copying the files to a new site.
  'GET /api/owner/export-files': [
    requireAuth(),
    requireOwner,
    async () => {
      const paths = new Set<string>();
      for (const table of ['materials', 'assignments', 'assignment_submissions']) {
        const recs = await scanAll(table);
        recs.forEach(r => {
          const a = r.attachment as Attachment | null | undefined;
          if (a && typeof a.path === 'string' && a.path) paths.add(a.path);
        });
      }
      const list = [...paths].sort();
      const files: Array<{ path: string; url: string }> = [];
      for (let i = 0; i < list.length; i += 100) {
        const res = await storage.url(list.slice(i, i + 100));
        res.forEach(r => files.push({ path: r.path, url: r.url }));
      }
      return json({ kind: 'holiday-portal-files', createdAt: nowIso(), files });
    },
  ],

  'GET /api/owner/file-copy': [
    requireAuth(),
    requireOwner,
    async () => {
      const [job] = await db.get<FileCopyJob>('settings', ['file-copy-job'], { consistent: true });
      return json({ job: job || null });
    },
  ],

  'POST /api/owner/file-copy/start': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const b = bodyOf(ctx);
      const raw = Array.isArray(b.files) ? (b.files as unknown[]) : [];
      const files = raw
        .map(f => (f && typeof f === 'object' ? (f as Rec) : {}))
        .map(f => ({ path: str(f.path, 400), url: str(f.url, 4000) }))
        .filter(
          f =>
            copyablePath(f.path) &&
            (f.url.toLowerCase().startsWith('https://') || (isLocal() && f.url.startsWith('http://localhost')))
        );
      if (!files.length) return error('This file has no files to copy. Download the file list from the old site again.', 400);
      const [ok] = await storage.write([
        { path: FILE_COPY_LIST, content: JSON.stringify(files), contentType: 'application/json' },
      ]);
      if (!ok) return error('Could not start the copy. Please try again.', 500);
      const job: FileCopyJob = { total: files.length, next: 0, copied: 0, failed: [], startedAt: nowIso(), finishedAt: '' };
      await db.tx.update('settings', [{ id: 'file-copy-job', record: job }]);
      await audit(ctx.user?.email || '', 'File copy started', `${files.length} files`);
      return json({ job });
    },
  ],

  'POST /api/owner/file-copy/step': [
    requireAuth(),
    requireOwner,
    async ctx => {
      const [job] = await db.get<FileCopyJob>('settings', ['file-copy-job'], { consistent: true });
      if (!job || job.finishedAt) return error('There is no file copy in progress.', 400);
      const [listFile] = await storage.read([FILE_COPY_LIST]);
      if (!listFile || !listFile.content) return error('The file list is missing. Start the copy again.', 400);
      const files = parseStored(listFile.content) as Array<{ path: string; url: string }>;
      const deadline = Date.now() + 35000;
      let next = job.next;
      let copied = job.copied;
      const failed = [...(job.failed || [])];
      while (next < files.length && Date.now() < deadline) {
        const f = files[next];
        try {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          const type = EXT_TYPES[fileExt(f.path)] || res.headers.get('content-type') || 'application/octet-stream';
          if (!(await storage.writeBytes(f.path, bytes, type))) throw new Error('save failed');
          copied += 1;
        } catch (e) {
          console.error('file copy failed', f.path, e);
          if (failed.length < 500) failed.push(f.path);
        }
        next += 1;
      }
      const finished = next >= files.length;
      const update: FileCopyJob = { ...job, next, copied, failed, finishedAt: finished ? nowIso() : '' };
      await db.tx.update('settings', [{ id: 'file-copy-job', record: update }]);
      if (finished) {
        await deleteFiles([FILE_COPY_LIST]);
        await audit(ctx.user?.email || '', 'File copy finished', `${copied} copied, ${failed.length} failed`);
      }
      return json({ job: update });
    },
  ],

  // ---------- principal registration ----------

  'POST /api/principal/request': [
    requireAuth(),
    async ctx => {
      const user = ctx.user!;
      const email = (user.email || '').trim().toLowerCase();
      if (!email) return error('Your sign-in did not share an email address. Please sign in with your email.', 400);
      if (email === OWNER_EMAIL) return error('The site owner account cannot register a school.', 400);
      const a = await getActor(ctx);
      if (a.teacher) {
        return error('This account is already registered as a teacher. Use a different email for the principal account.', 400);
      }
      const b = bodyOf(ctx);
      const principalName = str(b.principalName, 100);
      const phone = str(b.phone, 30);
      const schoolName = str(b.schoolName, 120);
      if (!principalName) return error('Enter your full name.', 400);
      if (!schoolName) return error('Enter the name of your school.', 400);
      const key = keyOf(schoolName);
      if (key.length < 3) return error('Enter the full name of your school.', 400);
      const ts = nowIso();

      if (a.principalSchool) {
        const s = a.principalSchool;
        if (s.status === 'approved') return error('Your school is already approved.', 400);
        if (s.status === 'suspended') return error('Your school account is paused. Contact the site owner.', 400);
        if (key !== s.nameKey) {
          if (!(await claimName(key, s.id))) return error(duplicateNameMessage(schoolName), 400);
          await releaseName(s.nameKey, s.id);
        }
        const [ok] = await wUpdate(
          'schools',
          [
            {
              id: s.id,
              record: { name: schoolName, nameKey: key, principalName, phone, principalUserId: user.userId, status: 'pending' },
            },
          ],
          { patch: true }
        );
        if (!ok) return error('Could not send your request. Please try again.', 500);
        dropSchool(s.id);
        return json({ ok: true });
      }

      const id = randomUUID();
      if (!(await claimName(key, id))) return error(duplicateNameMessage(schoolName), 400);
      const rec: SchoolRec = {
        name: schoolName,
        nameKey: key,
        principalEmail: email,
        principalUserId: user.userId,
        principalName,
        phone,
        status: 'pending',
        createdAt: ts,
        decidedAt: '',
      };
      const [added] = await wAdd('schools', [{ id, ...rec }]);
      if (!added) {
        await releaseName(key, id);
        return error('Could not send your request. Please try again.', 500);
      }
      await wUpdate('principal_index', [{ id: emailKey(email), record: { schoolId: id } }]);
      await pushTo([await getOwnerUserId()], 'New school request', `${principalName} asked to register ${schoolName}.`);
      return json({ ok: true });
    },
  ],

  // ---------- principal (approved) ----------

  'POST /api/admin/settings': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const school = a.principalSchool;
      const schoolName = str(bodyOf(ctx).schoolName, 120);
      const key = keyOf(schoolName);
      if (key.length < 3) return error('Enter the full name of your school.', 400);
      if (key !== school.nameKey) {
        if (!(await claimName(key, school.id))) {
          return error(`A school called “${schoolName}” already exists on the portal. Choose a different name.`, 400);
        }
        await releaseName(school.nameKey, school.id);
      }
      const [ok] = await wUpdate('schools', [{ id: school.id, record: { name: schoolName, nameKey: key } }], {
        patch: true,
      });
      if (!ok) return error('Could not save the school name.', 500);
      dropSchool(school.id);
      return json({ schoolName });
    },
  ],

  'GET /api/admin/teachers': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      const ids = await listIds(P.schoolTeachers(schoolId));
      const teachers = (await getMany<TeacherRec>('teachers', ids)).filter(t => schoolIdOf(t) === schoolId);
      const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
      teachers.sort(
        (x, y) => (order[x.status] ?? 3) - (order[y.status] ?? 3) || (y.createdAt || '').localeCompare(x.createdAt || '')
      );
      return json({ teachers });
    },
  ],

  'POST /api/admin/teachers/:id': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const [t] = await db.get<TeacherRec>('teachers', [ctx.params.id], { consistent: true });
      if (!t || schoolIdOf(t) !== a.principalSchool.id) return error('Teacher not found.', 404);
      const b = bodyOf(ctx);
      const patch: Rec = { updatedAt: nowIso() };
      if (b.status === 'approved' || b.status === 'rejected' || b.status === 'pending') patch.status = b.status;
      if (Array.isArray(b.streamIds)) {
        const valid = new Set(a.streamIds);
        patch.streamIds = strArr(b.streamIds).filter(id => valid.has(id));
      }
      const [ok] = await wUpdate('teachers', [{ id: ctx.params.id, record: patch }], { patch: true });
      if (!ok) return error('Teacher not found.', 404);
      const was = t.status === 'approved';
      const now = (patch.status || t.status) === 'approved';
      if (was !== now) await bumpStat(a.principalSchool.id, 'teachers', now ? 1 : -1);
      return json({ ok: true });
    },
  ],

  'DELETE /api/admin/teachers/:id': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const [t] = await db.get<TeacherRec>('teachers', [ctx.params.id], { consistent: true });
      if (!t || schoolIdOf(t) !== a.principalSchool.id) return error('Teacher not found.', 404);
      await wDelete('teachers', [ctx.params.id]);
      await removePointers([P.schoolTeachers(a.principalSchool.id)], ctx.params.id);
      if (t.status === 'approved') await bumpStat(a.principalSchool.id, 'teachers', -1);
      return json({ ok: true });
    },
  ],

  'POST /api/admin/streams': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      const name = str(bodyOf(ctx).name, 60);
      if (!name) return error('Enter a class / stream name.', 400);
      cacheDrop(`cat:${schoolId}`);
      const items = await loadCatalog(schoolId);
      if (items.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        return error('That class / stream already exists.', 400);
      }
      const stream: StreamItem = { id: randomUUID(), name, createdAt: nowIso() };
      const next = [...items, stream];
      if (!(await saveCatalog(schoolId, next))) return error('Could not add the class. Please try again.', 500);
      return json({ stream: { id: stream.id, name }, streams: sortStreams(next).map(s => ({ id: s.id, name: s.name })) });
    },
  ],

  'GET /api/admin/stream-summary': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      const streams = await getStreams(schoolId);
      const teacherIds = await listIds(P.schoolTeachers(schoolId));
      const teachers = (await getMany<TeacherRec>('teachers', teacherIds)).filter(
        t => schoolIdOf(t) === schoolId && t.status === 'approved'
      );
      let totalStudents = 0;
      const summary = await Promise.all(
        streams.map(async s => {
          const count = (await listIds(P.streamStudents(s.id))).length;
          totalStudents += count;
          return {
            id: s.id,
            name: s.name,
            students: count,
            teachers: teachers.filter(t => (t.streamIds || []).includes(s.id)).map(t => t.name),
          };
        })
      );
      return json({ summary, totalStudents });
    },
  ],

  'DELETE /api/admin/streams/:id': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      cacheDrop(`cat:${schoolId}`);
      const items = await loadCatalog(schoolId);
      const next = items.filter(s => s.id !== ctx.params.id);
      if (!(await saveCatalog(schoolId, next))) return error('Could not delete the class. Please try again.', 500);
      return json({ ok: true, streams: sortStreams(next).map(s => ({ id: s.id, name: s.name })) });
    },
  ],

  // ---------- teacher registration ----------

  'POST /api/teacher/register': [
    requireAuth(),
    async ctx => {
      const a = await getActor(ctx);
      if (!a.email) return error('Your sign-in did not share an email address. Please sign in with your email.', 400);
      if (a.isOwner) return error('The site owner account cannot register as a teacher.', 400);
      if (a.principalSchool) {
        return error('This account is registered as a principal. Use a different email for a teacher account.', 400);
      }
      const b = bodyOf(ctx);
      const school = await getSchool(str(b.schoolId, 100), true);
      if (!school || school.status !== 'approved') return error('That school is not open on the portal.', 400);
      const name = str(b.name, 100);
      const subjects = str(b.subjects, 200);
      if (!name) return error('Enter your full name.', 400);
      if (!subjects) return error('Enter the subjects you teach.', 400);
      const valid = new Set((await getStreams(school.id)).map(s => s.id));
      const requested = strArr(b.streamIds).filter(id => valid.has(id));
      const existing = a.teacher;
      const oldSchool = existing ? schoolIdOf(existing) : '';
      const sameSchool = !!existing && oldSchool === school.id;
      if (existing && existing.status === 'approved' && !sameSchool) {
        return error('You are already an approved teacher at another school.', 400);
      }
      const approved = !!existing && existing.status === 'approved' && sameSchool;
      const ts = nowIso();
      const rec: TeacherRec = {
        userId: a.userId,
        schoolId: school.id,
        email: a.email,
        name,
        phone: str(b.phone, 30),
        subjects,
        streamIds: approved && existing ? existing.streamIds : requested,
        status: approved ? 'approved' : 'pending',
        createdAt: (existing && existing.createdAt) || ts,
        updatedAt: ts,
      };
      const [ok] = await wUpdate('teachers', [{ id: a.userId, record: rec }]);
      if (!ok) return error('Could not save your registration. Please try again.', 500);
      if (existing && !sameSchool) await removePointers([P.schoolTeachers(oldSchool)], a.userId);
      await addPointers([P.schoolTeachers(school.id)], a.userId, rec.createdAt);
      if (!approved) await pushTo([school.principalUserId], 'New teacher request', `${name} asked to join ${school.name}.`);
      return json({ teacher: rec });
    },
  ],

  // ---------- teacher: materials ----------

  'GET /api/teacher/materials': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const ids = await listIds(P.teacherMaterials(actor.userId));
      const mine = (await getMany<MaterialRec>('materials', ids)).filter(m => m.teacherId === actor.userId);
      return json({ materials: await materialsWithUrls(mine.sort(byNewest)) });
    },
  ],

  'POST /api/teacher/materials': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const b = bodyOf(ctx);
      const title = str(b.title, 200);
      const subject = str(b.subject, 80);
      const content = str(b.body, 20000);
      const link = safeLink(str(b.link, 500));
      if (!title) return error('Give the material a title.', 400);
      if (!subject) return error('Enter the subject.', 400);
      if (link === null) return error('Links must start with http:// or https:// and contain no spaces.', 400);
      const allowed = new Set(actor.streamIds);
      const streamIds = strArr(b.streamIds).filter(id => allowed.has(id));
      if (!streamIds.length) return error('Choose at least one class / stream for this material.', 400);
      const f = (b.file && typeof b.file === 'object' ? b.file : null) as Rec | null;
      const hasFile = hasUpload(f);
      if (!content && !link && !hasFile) return error('Add notes, a link or a file for students to use.', 400);
      const id = randomUUID();
      const attachment = await saveUpload(b.file, `materials/${id}`, teacherOwner(actor.userId));
      if (typeof attachment === 'string') return error(attachment, 400);
      const rec: MaterialRec = {
        schoolId: actor.school ? actor.school.id : LEGACY_SCHOOL_ID,
        teacherId: actor.userId,
        teacherName: actor.name,
        subject,
        title,
        body: content,
        link,
        streamIds,
        attachment,
        createdAt: nowIso(),
      };
      const [added] = await wAdd('materials', [{ id, ...rec }]);
      if (!added) return error('Could not save the material. Please try again.', 500);
      await addPointers([...streamIds.map(P.streamMaterials), P.teacherMaterials(actor.userId)], id, rec.createdAt);
      await bumpUsage(rec.schoolId || LEGACY_SCHOOL_ID, 'posts');
      return json({ material: { id, ...rec } });
    },
  ],

  'DELETE /api/teacher/materials/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [m] = await db.get<MaterialRec>('materials', [id], { consistent: true });
      if (!m) return error('Material not found.', 404);
      if (m.teacherId !== actor.userId) return error('You can only delete materials you posted.', 403);
      if (m.attachment?.path) await deleteFiles([m.attachment.path]);
      await wDelete('materials', [id]);
      await removePointers([...(m.streamIds || []).map(P.streamMaterials), P.teacherMaterials(actor.userId)], id);
      return json({ ok: true });
    },
  ],

  // ---------- teacher: students ----------

  'GET /api/teacher/students': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const streamId = str(ctx.query?.streamId, 100);
      if (!actor.streamIds.includes(streamId)) return error('You are not assigned to that class.', 403);
      const ids = await listIds(P.streamStudents(streamId));
      const students = await getMany<StudentRec>('students', ids);
      students.sort((x, y) => x.admissionNo.localeCompare(y.admissionNo, undefined, { numeric: true }));
      return json({ students });
    },
  ],

  'POST /api/teacher/students': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const b = bodyOf(ctx);
      const streamId = str(b.streamId, 100);
      if (!actor.streamIds.includes(streamId)) return error('You are not assigned to that class.', 403);
      const entries: unknown[] = Array.isArray(b.entries) ? b.entries.slice(0, 300) : [];
      const schoolId = actor.school ? actor.school.id : LEGACY_SCHOOL_ID;
      const ts = nowIso();
      const items = new Map<string, StudentRec & { id: string }>();
      for (const raw of entries) {
        const e = (raw && typeof raw === 'object' ? raw : {}) as Rec;
        const adm = normAdm(e.admissionNo);
        if (!adm) continue;
        const id = studentKey(streamId, adm);
        items.set(id, { id, schoolId, admissionNo: adm, name: str(e.name, 100), streamId, addedBy: actor.email, createdAt: ts });
      }
      if (!items.size) return error('Enter at least one admission number.', 400);
      const list = Array.from(items.values());
      const added = await wAdd('students', list);
      const existing = list.filter((_s, i) => !added[i]);
      if (existing.length) {
        await wUpdate(
          'students',
          existing.map(s => ({ id: s.id, record: { name: s.name, admissionNo: s.admissionNo, addedBy: s.addedBy } })),
          { patch: true }
        );
      }
      const newIds = added.filter((x): x is string => !!x);
      if (newIds.length) {
        await wUpdate(
          P.streamStudents(streamId),
          newIds.map(id => ({ id, record: { createdAt: ts } }))
        );
        await bumpStat(schoolId, 'students', newIds.length);
      }
      return json({ saved: list.length });
    },
  ],

  'DELETE /api/teacher/students/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [rec] = await db.get<StudentRec>('students', [id], { consistent: true });
      if (!rec) return error('Student not found.', 404);
      if (!actor.streamIds.includes(rec.streamId)) return error('You are not assigned to that class.', 403);
      await wDelete('students', [id]);
      await removePointers([P.streamStudents(rec.streamId)], id);
      await bumpStat(schoolIdOf(rec), 'students', -1);
      return json({ ok: true });
    },
  ],

  // ---------- teacher: assignments ----------

  'GET /api/teacher/assignments': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const ids = await listIds(P.teacherAssignments(actor.userId));
      const mine = (await getMany<AssignmentRec>('assignments', ids))
        .filter(a => a.teacherId === actor.userId)
        .sort(byNewest)
        .slice(0, 100);
      const countRecs = mine.length
        ? await db.get<{ done: number; notDone: number }>('parent_check_counts', mine.map(a => a.id))
        : [];
      const assignments = await Promise.all(
        mine.map(async (a, idx) => {
          const pc = countRecs[idx];
          const subIds = modeOf(a) === 'paper' ? [] : await listIds(P.assignmentSubs(a.id));
          const subs = await getMany<AssignmentSubRec>('assignment_submissions', subIds);
          return {
            id: a.id,
            title: a.title,
            subject: a.subject,
            streamIds: a.streamIds,
            dueAt: a.dueAt,
            totalMarks: a.totalMarks,
            createdAt: a.createdAt,
            hasFile: !!a.attachment,
            submissionMode: modeOf(a),
            submitted: subs.length,
            marked: subs.filter(isMarked).length,
            parentDone: pc ? Math.max(0, pc.done || 0) : 0,
            parentNotDone: pc ? Math.max(0, pc.notDone || 0) : 0,
          };
        })
      );
      return json({ assignments });
    },
  ],

  'POST /api/teacher/assignments': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const b = bodyOf(ctx);
      const title = str(b.title, 200);
      const subject = str(b.subject, 80);
      const instructions = str(b.instructions, 20000);
      if (!title) return error('Give the assignment a title.', 400);
      if (!subject) return error('Enter the subject.', 400);
      const allowed = new Set(actor.streamIds);
      const streamIds = strArr(b.streamIds).filter(id => allowed.has(id));
      if (!streamIds.length) return error('Choose at least one class / stream for this assignment.', 400);
      const submissionMode: 'portal' | 'paper' = b.submissionMode === 'paper' ? 'paper' : 'portal';
      let dueAt = '';
      const dueRaw = submissionMode === 'paper' ? '' : str(b.dueAt, 40);
      if (dueRaw) {
        const t = Date.parse(dueRaw);
        if (!Number.isFinite(t)) return error('The due date is not valid.', 400);
        if (t <= Date.now()) return error('The due date has already passed. Choose a later date.', 400);
        dueAt = new Date(t).toISOString();
      }
      let totalMarks = 0;
      if (b.totalMarks !== undefined && b.totalMarks !== null && b.totalMarks !== '') {
        const n = Number(b.totalMarks);
        if (!Number.isFinite(n) || n < 0 || n > 1000) return error('Total marks must be between 0 and 1000.', 400);
        totalMarks = Math.round(n * 10) / 10;
      }
      const fileObj = b.file && typeof b.file === 'object' ? (b.file as Rec) : null;
      const hasFile = hasUpload(fileObj);
      if (!instructions && !hasFile) return error('Write the assignment questions or attach a file.', 400);
      const id = randomUUID();
      const attachment = await saveUpload(b.file, `assignments/${id}`, teacherOwner(actor.userId));
      if (typeof attachment === 'string') return error(attachment, 400);
      const rec: AssignmentRec = {
        schoolId: actor.school ? actor.school.id : LEGACY_SCHOOL_ID,
        teacherId: actor.userId,
        teacherName: actor.name,
        title,
        subject,
        instructions,
        streamIds,
        dueAt,
        totalMarks,
        attachment,
        createdAt: nowIso(),
        submissionMode,
      };
      const [added] = await wAdd('assignments', [{ id, ...rec }]);
      if (!added) return error('Could not save the assignment. Please try again.', 500);
      await addPointers([...streamIds.map(P.streamAssignments), P.teacherAssignments(actor.userId)], id, rec.createdAt);
      await bumpUsage(rec.schoolId || LEGACY_SCHOOL_ID, 'posts');
      return json({ assignment: { id, ...rec } });
    },
  ],

  'DELETE /api/teacher/assignments/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const a = await loadOwnAssignment(actor, ctx.params.id);
      if ('statusCode' in a) return a;
      const subIds = await listIds(P.assignmentSubs(a.id));
      const subs = await getMany<AssignmentSubRec>('assignment_submissions', subIds);
      const paths = subs.map(s => s.attachment?.path).filter((p): p is string => !!p);
      if (a.attachment?.path) paths.push(a.attachment.path);
      await deleteFiles(paths);
      await wDelete('assignment_submissions', subIds);
      await wDelete(P.assignmentSubs(a.id), subIds);
      await wDelete('assignments', [a.id]);
      await removePointers([...(a.streamIds || []).map(P.streamAssignments), P.teacherAssignments(actor.userId)], a.id);
      return json({ ok: true });
    },
  ],

  'GET /api/teacher/assignments/:id/submissions': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const a = await loadOwnAssignment(actor, ctx.params.id);
      if ('statusCode' in a) return a;
      const subIds = await listIds(P.assignmentSubs(a.id));
      const subs = await getMany<AssignmentSubRec>('assignment_submissions', subIds);
      subs.sort((x, y) => (x.studentName || x.admissionNo).localeCompare(y.studentName || y.admissionNo));
      const seen = new Set(subs.map(s => s.studentId));
      const roster = await rosterNames(a.streamIds);
      const checkRecs = await getParentChecks(roster.map(st => assignmentSubKey(a.id, st.id)));
      const parentChecks = roster
        .map((st, i) => {
          const c = checkRecs[i];
          return {
            studentId: st.id,
            name: st.name,
            admissionNo: st.admissionNo,
            streamId: st.streamId,
            status: !c ? 'none' : c.done ? 'done' : 'not_done',
            note: c ? c.note || '' : '',
            checkedAt: c ? c.checkedAt : '',
          };
        })
        .sort((x, y) => x.admissionNo.localeCompare(y.admissionNo, undefined, { numeric: true }));
      const notSubmitted = roster
        .filter(st => !seen.has(st.id))
        .map(st => ({ name: st.name, admissionNo: st.admissionNo, streamId: st.streamId }))
        .sort((x, y) => x.admissionNo.localeCompare(y.admissionNo, undefined, { numeric: true }));
      const [assignment] = await attachUrls([a]);
      return json({ assignment, submissions: await attachUrls(subs), notSubmitted, parentChecks });
    },
  ],

  'POST /api/teacher/assignment-submissions/:id/mark': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [sub] = await db.get<AssignmentSubRec>('assignment_submissions', [id], { consistent: true });
      if (!sub) return error('Submission not found.', 404);
      const a = await loadOwnAssignment(actor, sub.assignmentId);
      if ('statusCode' in a) return a;
      const b = bodyOf(ctx);
      let marks: number | null = null;
      if (b.marks !== null && b.marks !== undefined && b.marks !== '') {
        const n = Number(b.marks);
        const max = a.totalMarks > 0 ? a.totalMarks : 1000;
        if (!Number.isFinite(n) || n < 0 || n > max) return error(`Marks must be between 0 and ${max}.`, 400);
        marks = Math.round(n * 10) / 10;
      }
      const feedback = str(b.feedback, 3000);
      const [ok] = await wUpdate(
        'assignment_submissions',
        [{ id, record: { marks, feedback, markedAt: marks === null ? '' : nowIso() } }],
        { patch: true }
      );
      if (!ok) return error('Could not save the marks. Please try again.', 500);
      return json({ marks, feedback });
    },
  ],

  // ---------- teacher: exams ----------

  'GET /api/teacher/exams': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const ids = await listIds(P.teacherExams(actor.userId));
      const mine = (await getMany<ExamRec>('exams', ids))
        .filter(e => e.teacherId === actor.userId)
        .sort((x, y) => (y.startAt || '').localeCompare(x.startAt || ''))
        .slice(0, 60);
      const exams = await Promise.all(
        mine.map(async e => {
          const subs = await getMany<SubmissionRec>('exam_submissions', await listIds(P.examSubs(e.id)));
          const ended = Date.now() >= Date.parse(e.endAt) + EXAM_GRACE_MS;
          return {
            id: e.id,
            title: e.title,
            subject: e.subject,
            streamIds: e.streamIds,
            startAt: e.startAt,
            endAt: e.endAt,
            totalMarks: e.totalMarks,
            questionCount: e.questions.length,
            phase: examPhase(e),
            submitted: subs.filter(s => s.status === 'submitted' || ended).length,
            writing: subs.filter(s => s.status === 'in_progress' && !ended).length,
          };
        })
      );
      return json({ exams, serverNow: nowIso() });
    },
  ],

  'POST /api/teacher/exams': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const b = bodyOf(ctx);
      const title = str(b.title, 200);
      const subject = str(b.subject, 80);
      if (!title) return error('Give the exam a title.', 400);
      if (!subject) return error('Enter the subject.', 400);
      const allowed = new Set(actor.streamIds);
      const streamIds = strArr(b.streamIds).filter(id => allowed.has(id));
      if (!streamIds.length) return error('Choose at least one class / stream for this exam.', 400);
      const start = Date.parse(str(b.startAt, 40));
      const end = Date.parse(str(b.endAt, 40));
      if (!Number.isFinite(start) || !Number.isFinite(end)) return error('Set the exam date, start time and finish time.', 400);
      if (end <= start) return error('The finish time must be after the start time.', 400);
      if (end <= Date.now()) return error('The finish time has already passed. Choose a later time.', 400);
      const questions = parseQuestions(b.questions);
      if (typeof questions === 'string') return error(questions, 400);
      const totalMarks = Math.round(questions.reduce((s, q) => s + q.marks, 0) * 10) / 10;
      const id = randomUUID();
      const rec: ExamRec = {
        schoolId: actor.school ? actor.school.id : LEGACY_SCHOOL_ID,
        teacherId: actor.userId,
        teacherName: actor.name,
        title,
        subject,
        instructions: str(b.instructions, 3000),
        streamIds,
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
        questions,
        totalMarks,
        createdAt: nowIso(),
      };
      const [added] = await wAdd('exams', [{ id, ...rec }]);
      if (!added) return error('Could not save the exam. Please try again.', 500);
      await addPointers([...streamIds.map(P.streamExams), P.teacherExams(actor.userId)], id, rec.createdAt);
      await bumpUsage(rec.schoolId || LEGACY_SCHOOL_ID, 'posts');
      return json({ exam: { id, ...rec } });
    },
  ],

  'DELETE /api/teacher/exams/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const exam = await loadOwnExam(actor, ctx.params.id);
      if ('statusCode' in exam) return exam;
      const subIds = await listIds(P.examSubs(exam.id));
      await wDelete('exam_submissions', subIds);
      await wDelete(P.examSubs(exam.id), subIds);
      await wDelete('exams', [exam.id]);
      await removePointers([...(exam.streamIds || []).map(P.streamExams), P.teacherExams(actor.userId)], exam.id);
      return json({ ok: true });
    },
  ],

  'GET /api/teacher/exams/:id/results': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const exam = await loadOwnExam(actor, ctx.params.id);
      if ('statusCode' in exam) return exam;
      const raw = await getMany<SubmissionRec>('exam_submissions', await listIds(P.examSubs(exam.id)));
      const submissions: SubmissionRow[] = [];
      for (const s of raw) submissions.push(await finaliseIfExpired(exam, s));
      submissions.sort((x, y) => (x.studentName || x.admissionNo).localeCompare(y.studentName || y.admissionNo));
      const seen = new Set(submissions.map(s => s.studentId));
      const notAttempted = (await rosterNames(exam.streamIds))
        .filter(st => !seen.has(st.id))
        .map(st => ({ name: st.name, admissionNo: st.admissionNo, streamId: st.streamId }))
        .sort((x, y) => x.admissionNo.localeCompare(y.admissionNo, undefined, { numeric: true }));
      return json({ exam, submissions, notAttempted, serverNow: nowIso() });
    },
  ],

  'POST /api/teacher/submissions/:id/mark': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [sub] = await db.get<SubmissionRec>('exam_submissions', [id], { consistent: true });
      if (!sub) return error('Submission not found.', 404);
      const exam = await loadOwnExam(actor, sub.examId);
      if ('statusCode' in exam) return exam;
      const current = await finaliseIfExpired(exam, { ...sub, id });
      if (current.status !== 'submitted') return error('You can mark this work after the student has submitted it.', 400);
      const b = bodyOf(ctx);
      const src = b.marks && typeof b.marks === 'object' ? (b.marks as Rec) : {};
      const marks: Record<string, number> = {};
      for (const q of exam.questions) {
        if (q.type !== 'written') continue;
        const v = src[q.id];
        if (v === undefined || v === null || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > q.marks) {
          return error(`Marks for question ${q.id.slice(1)} must be between 0 and ${q.marks}.`, 400);
        }
        marks[q.id] = Math.round(n * 10) / 10;
      }
      const comment = str(b.comment, 2000);
      const [ok] = await wUpdate('exam_submissions', [{ id, record: { marks, comment, updatedAt: nowIso() } }], {
        patch: true,
      });
      if (!ok) return error('Could not save the marks. Please try again.', 500);
      return json({ marks, comment });
    },
  ],

  // ---------- editing after posting ----------

  'PUT /api/teacher/materials/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [m] = await db.get<MaterialRec>('materials', [id], { consistent: true });
      if (!m) return error('Material not found.', 404);
      if (m.teacherId !== actor.userId) return error('You can only edit materials you posted.', 403);
      const b = bodyOf(ctx);
      const title = str(b.title, 200);
      const subject = str(b.subject, 80);
      const content = str(b.body, 20000);
      const link = safeLink(str(b.link, 500));
      if (!title) return error('Give the material a title.', 400);
      if (!subject) return error('Enter the subject.', 400);
      if (link === null) return error('Links must start with http:// or https:// and contain no spaces.', 400);
      const allowed = new Set(actor.streamIds);
      const streamIds = strArr(b.streamIds).filter(sid => allowed.has(sid));
      if (!streamIds.length) return error('Choose at least one class / stream for this material.', 400);
      let attachment = m.attachment;
      const oldFiles: string[] = [];
      const f = (b.file && typeof b.file === 'object' ? b.file : null) as Rec | null;
      if (hasUpload(f)) {
        const up = await saveUpload(b.file, `materials/${id}/${Date.now()}`, teacherOwner(actor.userId));
        if (typeof up === 'string') return error(up, 400);
        if (attachment) oldFiles.push(attachment.path);
        attachment = up;
      } else if (b.removeFile === true && attachment) {
        oldFiles.push(attachment.path);
        attachment = null;
      }
      if (!content && !link && !attachment) return error('Add notes, a link or a file for students to use.', 400);
      const rec = { ...m, subject, title, body: content, link, streamIds, attachment, updatedAt: nowIso() };
      const [ok] = await wUpdate('materials', [{ id, record: rec }]);
      if (!ok) return error('Could not save the changes. Please try again.', 500);
      await syncStreamPointers(m.streamIds || [], streamIds, P.streamMaterials, id, m.createdAt);
      if (oldFiles.length) await deleteFiles(oldFiles);
      return json({ material: { id, ...rec } });
    },
  ],

  'PUT /api/teacher/assignments/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const a = await loadOwnAssignment(actor, ctx.params.id);
      if ('statusCode' in a) return a;
      const b = bodyOf(ctx);
      const title = str(b.title, 200);
      const subject = str(b.subject, 80);
      const instructions = str(b.instructions, 20000);
      if (!title) return error('Give the assignment a title.', 400);
      if (!subject) return error('Enter the subject.', 400);
      const allowed = new Set(actor.streamIds);
      const streamIds = strArr(b.streamIds).filter(sid => allowed.has(sid));
      if (!streamIds.length) return error('Choose at least one class / stream for this assignment.', 400);
      const submissionMode: 'portal' | 'paper' = b.submissionMode === 'paper' ? 'paper' : 'portal';
      if (submissionMode !== modeOf(a)) {
        const subIds = await listIds(P.assignmentSubs(a.id));
        if (subIds.length) {
          return error(
            'Students have already handed in work through the portal, so the way of handing in can no longer be changed.',
            400
          );
        }
      }
      let dueAt = '';
      if (submissionMode === 'portal') {
        const dueRaw = str(b.dueAt, 40);
        if (dueRaw) {
          const t = Date.parse(dueRaw);
          if (!Number.isFinite(t)) return error('The due date is not valid.', 400);
          const unchanged = !!a.dueAt && Math.abs(t - Date.parse(a.dueAt)) < 60000;
          if (!unchanged && t <= Date.now()) return error('The due date has already passed. Choose a later date.', 400);
          dueAt = new Date(t).toISOString();
        }
      }
      let totalMarks = 0;
      if (b.totalMarks !== undefined && b.totalMarks !== null && b.totalMarks !== '') {
        const n = Number(b.totalMarks);
        if (!Number.isFinite(n) || n < 0 || n > 1000) return error('Total marks must be between 0 and 1000.', 400);
        totalMarks = Math.round(n * 10) / 10;
      }
      let attachment = a.attachment;
      const oldFiles: string[] = [];
      const f = (b.file && typeof b.file === 'object' ? b.file : null) as Rec | null;
      if (hasUpload(f)) {
        const up = await saveUpload(b.file, `assignments/${a.id}/${Date.now()}`, teacherOwner(actor.userId));
        if (typeof up === 'string') return error(up, 400);
        if (attachment) oldFiles.push(attachment.path);
        attachment = up;
      } else if (b.removeFile === true && attachment) {
        oldFiles.push(attachment.path);
        attachment = null;
      }
      if (!instructions && !attachment) return error('Write the assignment questions or attach a file.', 400);
      const rec: AssignmentRec = {
        schoolId: a.schoolId,
        teacherId: a.teacherId,
        teacherName: a.teacherName,
        title,
        subject,
        instructions,
        streamIds,
        dueAt,
        totalMarks,
        attachment,
        createdAt: a.createdAt,
        submissionMode,
      };
      const [ok] = await wUpdate('assignments', [{ id: a.id, record: { ...rec, updatedAt: nowIso() } }]);
      if (!ok) return error('Could not save the changes. Please try again.', 500);
      await syncStreamPointers(a.streamIds || [], streamIds, P.streamAssignments, a.id, a.createdAt);
      if (oldFiles.length) await deleteFiles(oldFiles);
      return json({ assignment: { id: a.id, ...rec } });
    },
  ],

  'GET /api/teacher/exams/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const exam = await loadOwnExam(actor, ctx.params.id);
      if ('statusCode' in exam) return exam;
      return json({ exam, phase: examPhase(exam), serverNow: nowIso() });
    },
  ],

  'PUT /api/teacher/exams/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const exam = await loadOwnExam(actor, ctx.params.id);
      if ('statusCode' in exam) return exam;
      const { id, ...current } = exam;
      const b = bodyOf(ctx);
      const phase = examPhase(exam);
      const title = str(b.title, 200);
      if (!title) return error('Give the exam a title.', 400);
      const instructions = str(b.instructions, 3000);
      let next: ExamRec;
      if (phase === 'upcoming') {
        const subject = str(b.subject, 80);
        if (!subject) return error('Enter the subject.', 400);
        const allowed = new Set(actor.streamIds);
        const streamIds = strArr(b.streamIds).filter(sid => allowed.has(sid));
        if (!streamIds.length) return error('Choose at least one class / stream for this exam.', 400);
        const start = Date.parse(str(b.startAt, 40));
        const end = Date.parse(str(b.endAt, 40));
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          return error('Set the exam date, start time and finish time.', 400);
        }
        if (end <= start) return error('The finish time must be after the start time.', 400);
        if (end <= Date.now()) return error('The finish time has already passed. Choose a later time.', 400);
        const questions = parseQuestions(b.questions);
        if (typeof questions === 'string') return error(questions, 400);
        const totalMarks = Math.round(questions.reduce((s, q) => s + q.marks, 0) * 10) / 10;
        next = {
          ...current,
          title,
          subject,
          instructions,
          streamIds,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          questions,
          totalMarks,
        };
      } else if (phase === 'open') {
        let end = Date.parse(str(b.endAt, 40));
        if (!Number.isFinite(end)) end = Date.parse(exam.endAt);
        if (end <= Date.now()) return error('The new finish time has already passed. Choose a later time.', 400);
        next = { ...current, title, instructions, endAt: new Date(end).toISOString() };
      } else {
        next = { ...current, title, instructions };
      }
      const [ok] = await wUpdate('exams', [{ id, record: { ...next, updatedAt: nowIso() } }]);
      if (!ok) return error('Could not save the changes. Please try again.', 500);
      if (phase === 'upcoming') {
        await syncStreamPointers(exam.streamIds || [], next.streamIds, P.streamExams, id, exam.createdAt);
      }
      return json({ exam: { id, ...next }, phase });
    },
  ],

  // ---------- announcements ----------

  'GET /api/staff/announcements': [
    requireAuth(),
    async ctx => {
      const a = await announcerActor(ctx);
      if ('statusCode' in a) return a;
      const ids = await listIds(P.authorAnnouncements(a.userId));
      const items = (await getMany<AnnouncementRec>('announcements', ids)).sort(byNewest);
      return json({ announcements: items });
    },
  ],

  'POST /api/staff/announcements': [
    requireAuth(),
    async ctx => {
      const a = await announcerActor(ctx);
      if ('statusCode' in a) return a;
      const b = bodyOf(ctx);
      const title = str(b.title, 120);
      const message = str(b.message, 2000);
      if (!message) return error('Write the announcement.', 400);
      const allowed = new Set(a.streamIds);
      const streamIds = strArr(b.streamIds).filter(sid => allowed.has(sid));
      if (!streamIds.length) return error('Choose at least one class / stream.', 400);
      const id = randomUUID();
      const rec: AnnouncementRec = {
        schoolId: a.school ? a.school.id : LEGACY_SCHOOL_ID,
        authorId: a.userId,
        authorName: a.name,
        authorRole: a.principalSchool ? 'principal' : 'teacher',
        title,
        message,
        streamIds,
        createdAt: nowIso(),
      };
      const [added] = await wAdd('announcements', [{ id, ...rec }]);
      if (!added) return error('Could not post the announcement. Please try again.', 500);
      await addPointers([...streamIds.map(P.streamAnnouncements), P.authorAnnouncements(a.userId)], id, rec.createdAt);
      await bumpUsage(rec.schoolId, 'posts');
      return json({ announcement: { id, ...rec } });
    },
  ],

  'DELETE /api/staff/announcements/:id': [
    requireAuth(),
    async ctx => {
      const a = await announcerActor(ctx);
      if ('statusCode' in a) return a;
      const id = ctx.params.id;
      const [rec] = await db.get<AnnouncementRec>('announcements', [id], { consistent: true });
      if (!rec) return error('Announcement not found.', 404);
      if (rec.authorId !== a.userId) return error('You can only delete your own announcements.', 403);
      await wDelete('announcements', [id]);
      await removePointers([...(rec.streamIds || []).map(P.streamAnnouncements), P.authorAnnouncements(a.userId)], id);
      return json({ ok: true });
    },
  ],

  // ---------- questions from students ----------

  'GET /api/teacher/questions': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const ids = await listIds(P.teacherQuestions(actor.userId));
      const items = (await getMany<QuestionRec>('questions', ids)).filter(q => q.teacherId === actor.userId);
      items.sort((x, y) => {
        const ux = x.answer ? 1 : 0;
        const uy = y.answer ? 1 : 0;
        return ux - uy || (y.createdAt || '').localeCompare(x.createdAt || '');
      });
      return json({ questions: items.slice(0, 300) });
    },
  ],

  'POST /api/teacher/questions/:id/answer': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [q] = await db.get<QuestionRec>('questions', [id], { consistent: true });
      if (!q || q.teacherId !== actor.userId) return error('Question not found.', 404);
      const answer = str(bodyOf(ctx).answer, 3000);
      if (!answer) return error('Write your answer.', 400);
      const answeredAt = nowIso();
      const [ok] = await wUpdate('questions', [{ id, record: { answer, answeredAt } }], { patch: true });
      if (!ok) return error('Could not save the answer. Please try again.', 500);
      return json({ answer, answeredAt });
    },
  ],

  'DELETE /api/teacher/questions/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [q] = await db.get<QuestionRec>('questions', [id], { consistent: true });
      if (!q || q.teacherId !== actor.userId) return error('Question not found.', 404);
      await wDelete('questions', [id]);
      await removePointers([P.teacherQuestions(q.teacherId), P.studentQuestions(q.studentId)], id);
      return json({ ok: true });
    },
  ],

  'POST /api/student/questions': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      const itemType = b.itemType === 'assignment' ? 'assignment' : 'material';
      const itemId = str(b.itemId, 100);
      const text = str(b.text, 1500);
      if (!text) return error('Type your question.', 400);
      if (!isSafeId(itemId)) return error('Invalid request.', 400);
      if ((await failCount('question', student.id)) >= 15) {
        return error('You have asked many questions in the last hour. Please wait a little before asking again.', 429);
      }
      const table = itemType === 'assignment' ? 'assignments' : 'materials';
      const [item] = await db.get<{ teacherId: string; title: string; streamIds: string[] }>(table, [itemId]);
      if (!item || !(item.streamIds || []).includes(student.streamId)) return error('Not found.', 404);
      const id = randomUUID();
      const rec: QuestionRec = {
        schoolId: student.schoolId,
        teacherId: item.teacherId,
        itemType,
        itemId,
        itemTitle: item.title,
        studentId: student.id,
        studentName: student.name,
        admissionNo: student.admissionNo,
        streamId: student.streamId,
        text,
        createdAt: nowIso(),
        answer: '',
        answeredAt: '',
      };
      const [added] = await wAdd('questions', [{ id, ...rec }]);
      if (!added) return error('Could not send your question. Please try again.', 500);
      await addPointers([P.teacherQuestions(item.teacherId), P.studentQuestions(student.id)], id, rec.createdAt);
      await recordFail('question', student.id);
      await bumpUsage(student.schoolId, 'questions');
      await pushTo(
        [item.teacherId],
        'New question from a student',
        `${student.name || 'A student'} asked about “${item.title}”.`
      );
      return json({ question: { id, ...rec } });
    },
  ],

  'POST /api/student/questions/list': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      const itemId = str(b.itemId, 100);
      const ids = await listIds(P.studentQuestions(student.id));
      let items = (await getMany<QuestionRec>('questions', ids)).filter(q => q.studentId === student.id);
      if (itemId) items = items.filter(q => q.itemId === itemId);
      items.sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
      return json({ questions: items.slice(0, 200) });
    },
  ],

  'POST /api/student/announcements': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const ids = await listIds(P.streamAnnouncements(student.streamId));
      const items = (await getMany<AnnouncementRec>('announcements', ids))
        .filter(a => (a.streamIds || []).includes(student.streamId))
        .sort(byNewest)
        .slice(0, 60);
      return json({ announcements: items });
    },
  ],

  // ---------- student notifications ----------

  'POST /api/student/notifications': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const since = new Date(now - 14 * day).toISOString();
      const sid = student.streamId;
      type Item = { id: string; title: string; body: string; at: string; tab: string; when?: string; whenLabel?: string };
      const items: Item[] = [];

      const matPtrs = (await listPointers(P.streamMaterials(sid))).filter(p => p.createdAt >= since);
      const mats = await getMany<MaterialRec>('materials', matPtrs.map(p => p.id).slice(-25));
      mats.forEach(m =>
        items.push({ id: `m-${m.id}`, title: `New material: ${m.title}`, body: `${m.subject} · ${m.teacherName}`, at: m.createdAt, tab: 'materials' })
      );

      const asgs = (await getMany<AssignmentRec>('assignments', await listIds(P.streamAssignments(sid)))).filter(a =>
        (a.streamIds || []).includes(sid)
      );
      asgs
        .filter(a => a.createdAt >= since)
        .forEach(a =>
          items.push({
            id: `a-${a.id}`,
            title: `New assignment: ${a.title}`,
            body: modeOf(a) === 'paper' ? `${a.subject} · hand in on paper on opening day` : a.subject,
            at: a.createdAt,
            tab: 'assignments',
            when: modeOf(a) === 'portal' && a.dueAt ? a.dueAt : undefined,
            whenLabel: 'Due',
          })
        );
      const portal = asgs.filter(a => modeOf(a) === 'portal');
      const aKeys = portal.map(a => assignmentSubKey(a.id, student.id));
      for (let i = 0; i < aKeys.length; i += 100) {
        const recs = await db.get<AssignmentSubRec>('assignment_submissions', aKeys.slice(i, i + 100));
        recs.forEach((s, j) => {
          const a = portal[i + j];
          if (s && isMarked(s) && s.markedAt && s.markedAt >= since) {
            items.push({
              id: `am-${a.id}`,
              title: `Your assignment was marked: ${a.title}`,
              body: `${s.marks}${a.totalMarks ? ` / ${a.totalMarks}` : ''}${s.feedback ? ' · your teacher left feedback' : ''}`,
              at: s.markedAt,
              tab: 'assignments',
            });
          }
        });
      }

      const exams = (await getMany<ExamRec>('exams', await listIds(P.streamExams(sid)))).filter(e =>
        (e.streamIds || []).includes(sid)
      );
      const resultExams: ExamRow[] = [];
      exams.forEach(e => {
        const start = Date.parse(e.startAt);
        if (e.createdAt >= since) {
          items.push({
            id: `e-${e.id}`,
            title: `Exam scheduled: ${e.title}`,
            body: e.subject,
            at: e.createdAt,
            tab: 'exams',
            when: e.startAt,
            whenLabel: 'Opens',
          });
        }
        if (start > now && start - now <= day) {
          items.push({
            id: `es-${e.id}`,
            title: `Exam opens soon: ${e.title}`,
            body: e.subject,
            at: new Date(start - day).toISOString(),
            tab: 'exams',
            when: e.startAt,
            whenLabel: 'Opens',
          });
        }
        const ro = resultsOpenAt(e);
        if (ro <= now && ro >= now - 14 * day) resultExams.push(e);
      });
      const eKeys = resultExams.map(e => submissionKey(e.id, student.id));
      for (let i = 0; i < eKeys.length; i += 100) {
        const recs = await db.get<SubmissionRec>('exam_submissions', eKeys.slice(i, i + 100));
        recs.forEach((s, j) => {
          const e = resultExams[i + j];
          if (s) {
            items.push({
              id: `er-${e.id}`,
              title: `Your score is out: ${e.title}`,
              body: 'Open Exams to see your score and answers.',
              at: new Date(resultsOpenAt(e)).toISOString(),
              tab: 'exams',
            });
          }
        });
      }

      const annPtrs = (await listPointers(P.streamAnnouncements(sid))).filter(p => p.createdAt >= since);
      const anns = await getMany<AnnouncementRec>('announcements', annPtrs.map(p => p.id).slice(-25));
      anns.forEach(an =>
        items.push({
          id: `n-${an.id}`,
          title: an.title ? `Notice: ${an.title}` : `Notice from ${an.authorName}`,
          body: an.message.slice(0, 140),
          at: an.createdAt,
          tab: 'notices',
        })
      );

      const qs = await getMany<QuestionRec>('questions', (await listIds(P.studentQuestions(student.id))).slice(-100));
      qs.filter(q => q.studentId === student.id && q.answer && q.answeredAt >= since).forEach(q =>
        items.push({
          id: `q-${q.id}`,
          title: 'Your teacher answered your question',
          body: `About “${q.itemTitle}”`,
          at: q.answeredAt,
          tab: q.itemType === 'assignment' ? 'assignments' : 'materials',
        })
      );

      const nowIsoStr = nowIso();
      const shown = items
        .filter(it => it.at && it.at <= nowIsoStr)
        .sort((x, y) => y.at.localeCompare(x.at))
        .slice(0, 40);
      return json({ items: shown, serverNow: nowIsoStr });
    },
  ],

  // ---------- parent access ----------

  'POST /api/student/parent-pin': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      const pin = str(b.pin, 20);
      if (!/^[0-9]{4,8}$/.test(pin)) return error('The PIN must be 4 to 8 digits.', 400);
      const [ok] = await wUpdate('students', [{ id: student.id, record: { parentPinHash: sha256(`${student.id}|${pin}`) } }], {
        patch: true,
      });
      if (!ok) return error('Could not save the PIN. Please try again.', 500);
      return json({ ok: true });
    },
  ],

  'POST /api/student/parent-pin/status': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const [rec] = await db.get<{ parentPinHash?: string }>('students', [student.id], { consistent: true });
      return json({ hasPin: !!(rec && rec.parentPinHash) });
    },
  ],

  'POST /api/parent/login': [
    async ctx => {
      const b = bodyOf(ctx);
      const school = await getSchool(str(b.schoolId, 100));
      if (!school || school.status !== 'approved') return error('This school is not open on the portal right now.', 403);
      const adm = normAdm(b.admissionNo);
      const streamId = str(b.streamId, 100);
      const pin = str(b.pin, 20);
      if (!adm) return error("Enter your child's admission number.", 400);
      if (!streamId) return error("Select your child's class / stream.", 400);
      if (!/^[0-9]{4,8}$/.test(pin)) return error('Enter the parent PIN (4 to 8 digits) your child set up.', 400);
      const ip = clientIp(ctx);
      const admKey = `${school.id}|${adm}`;
      if (
        (await failCount('parent-ip', ip)) >= LOGIN_FAIL_LIMIT_IP ||
        (await failCount('parent-adm', admKey)) >= LOGIN_FAIL_LIMIT_ADM
      ) {
        return error('Too many unsuccessful attempts. Please wait an hour and try again.', 429);
      }
      const streams = await getStreams(school.id);
      const stream = streams.find(s => s.id === streamId);
      if (!stream) return error("Select your child's class / stream.", 400);
      const studentId = studentKey(streamId, adm);
      const [student] = await db.get<StudentRec & { parentPinHash?: string }>('students', [studentId], { consistent: true });
      if (!student || schoolIdOf(student) !== school.id || !student.parentPinHash || student.parentPinHash !== sha256(`${studentId}|${pin}`)) {
        await recordFail('parent-ip', ip);
        await recordFail('parent-adm', admKey);
        return error(
          'The admission number, class or PIN is not correct. Ask your child to check the parent PIN in their Report card tab.',
          404
        );
      }
      await bumpUsage(school.id, 'logins');
      const token = randomUUID().split('-').join('') + randomUUID().split('-').join('');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [added] = await db.tx.add('student_sessions', [
        { id: sha256(token), studentId, streamId, schoolId: school.id, expiresAt, role: 'parent' },
      ]);
      if (!added) return error('Could not sign you in. Please try again.', 500);
      return json({
        token,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          streamId,
          streamName: stream.name,
          schoolName: school.name,
          role: 'parent',
        },
      });
    },
  ],

  // ---------- site owner usage summary ----------

  'GET /api/owner/usage': [
    requireAuth(),
    requireOwner,
    async () => {
      const schools = (await scanAll('schools')).filter(s => s.status === 'approved' || s.status === 'suspended');
      const thisWeek = weekKey(0);
      const lastWeek = weekKey(1);
      const ids: string[] = [];
      schools.forEach(s => {
        ids.push(`${thisWeek}_${partKey(s.id)}`, `${lastWeek}_${partKey(s.id)}`);
      });
      const recs: Array<UsageRec | null> = [];
      for (let i = 0; i < ids.length; i += 100) recs.push(...(await db.get<UsageRec>('usage', ids.slice(i, i + 100))));
      const empty: UsageRec = { logins: 0, posts: 0, submissions: 0, questions: 0 };
      const rows = schools.map((s, i) => ({
        id: s.id,
        name: String(s.name || ''),
        thisWeek: { ...empty, ...(recs[i * 2] || {}) },
        lastWeek: { ...empty, ...(recs[i * 2 + 1] || {}) },
      }));
      const score = (u: UsageRec) => u.logins + u.posts + u.submissions + u.questions;
      rows.sort((x, y) => score(y.thisWeek) - score(x.thisWeek) || x.name.localeCompare(y.name));
      return json({ rows, weekStart: thisWeek });
    },
  ],

  // ---------- principal overview and promotion ----------

  'GET /api/admin/overview': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      const streams = await getStreams(schoolId);
      const teachers = (await getMany<TeacherRec>('teachers', await listIds(P.schoolTeachers(schoolId)))).filter(
        t => schoolIdOf(t) === schoolId && t.status === 'approved'
      );
      const teacherRows = await Promise.all(
        teachers.map(async t => {
          const [mats, asgs, exams, qIds] = await Promise.all([
            listPointers(P.teacherMaterials(t.id)),
            listPointers(P.teacherAssignments(t.id)),
            listPointers(P.teacherExams(t.id)),
            listIds(P.teacherQuestions(t.id)),
          ]);
          const qs = await getMany<QuestionRec>('questions', qIds.slice(-300));
          let lastActive = '';
          [...mats, ...asgs, ...exams].forEach(p => {
            if (p.createdAt > lastActive) lastActive = p.createdAt;
          });
          return {
            id: t.id,
            name: t.name,
            subjects: t.subjects,
            classes: (t.streamIds || []).length,
            materials: mats.length,
            assignments: asgs.length,
            exams: exams.length,
            openQuestions: qs.filter(q => !q.answer).length,
            lastActive,
          };
        })
      );
      const now = Date.now();
      const streamRows = await Promise.all(
        streams.map(async s => {
          const n = (await listIds(P.streamStudents(s.id))).length;
          const asgs = (await getMany<AssignmentRec>('assignments', await listIds(P.streamAssignments(s.id)))).filter(
            x => (x.streamIds || []).includes(s.id) && modeOf(x) === 'portal'
          );
          let handIns = 0;
          for (const x of asgs) {
            const prefix = `${x.id}_${s.id}-`;
            handIns += (await listIds(P.assignmentSubs(x.id))).filter(id => id.startsWith(prefix)).length;
          }
          const exams = (await getMany<ExamRec>('exams', await listIds(P.streamExams(s.id))))
            .filter(e => (e.streamIds || []).includes(s.id) && now >= resultsOpenAt(e))
            .sort((x, y) => (x.startAt || '').localeCompare(y.startAt || ''))
            .slice(-10);
          let sat = 0;
          let got = 0;
          let outOf = 0;
          for (const e of exams) {
            const prefix = `${e.id}_${s.id}-`;
            const subIds = (await listIds(P.examSubs(e.id))).filter(id => id.startsWith(prefix));
            sat += subIds.length;
            const subs = await getMany<SubmissionRec>('exam_submissions', subIds);
            subs.forEach(su => {
              got += studentResult(e, su).score;
              outOf += e.totalMarks;
            });
          }
          const pctOf = (x: number, y: number) => (y > 0 ? Math.round((x / y) * 1000) / 10 : null);
          return {
            id: s.id,
            name: s.name,
            students: n,
            assignments: asgs.length,
            exams: exams.length,
            handInRate: pctOf(handIns, asgs.length * n),
            examRate: pctOf(sat, exams.length * n),
            averageScore: pctOf(got, outOf),
          };
        })
      );
      return json({ teachers: teacherRows, streams: streamRows });
    },
  ],

  'POST /api/admin/promote-stream': [
    requireAuth(),
    async ctx => {
      const a = await principalActor(ctx);
      if ('statusCode' in a) return a;
      const schoolId = a.principalSchool.id;
      const b = bodyOf(ctx);
      const from = str(b.from, 100);
      const to = str(b.to, 100);
      const remove = b.remove === true;
      const valid = new Set(a.streamIds);
      if (!valid.has(from)) return error('Choose a class / stream to move students from.', 400);
      if (!remove && (!valid.has(to) || to === from)) return error('Choose a different class / stream to move students to.', 400);
      const ids = await listIds(P.streamStudents(from));
      const students = await getMany<StudentRec>('students', ids);
      if (remove) {
        await wDelete('students', ids);
        await wDelete(P.streamStudents(from), ids);
        await bumpStat(schoolId, 'students', -students.length);
        await audit(a.email, 'Students removed (finished school)', `${students.length} students`);
        return json({ moved: 0, skipped: 0, removed: students.length });
      }
      const targetIds = new Set(await listIds(P.streamStudents(to)));
      const ts = nowIso();
      const moves = students.map(s => ({
        old: s.id,
        id: studentKey(to, s.admissionNo),
        record: {
          schoolId: s.schoolId || schoolId,
          admissionNo: s.admissionNo,
          name: s.name,
          streamId: to,
          addedBy: s.addedBy,
          createdAt: s.createdAt || ts,
        },
      }));
      const ok = moves.filter(m => !targetIds.has(m.id));
      if (ok.length) {
        await wUpdate('students', ok.map(m => ({ id: m.id, record: m.record })));
        await wUpdate(P.streamStudents(to), ok.map(m => ({ id: m.id, record: { createdAt: ts } })));
        await wDelete('students', ok.map(m => m.old));
        await wDelete(P.streamStudents(from), ok.map(m => m.old));
      }
      await audit(a.email, 'Students moved up', `${ok.length} students`);
      return json({ moved: ok.length, skipped: moves.length - ok.length, removed: 0 });
    },
  ],

  // ---------- question bank ----------

  'GET /api/teacher/bank': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const ids = await listIds(P.teacherBank(actor.userId));
      const items = (await getMany<BankRec>('qbank', ids)).filter(q => q.teacherId === actor.userId).sort(byNewest);
      return json({ questions: items });
    },
  ],

  'POST /api/teacher/bank': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const b = bodyOf(ctx);
      const subject = str(b.subject, 80);
      const topic = str(b.topic, 80);
      if (!subject) return error('Enter the subject before saving questions to your bank.', 400);
      const parsed = parseQuestions(b.questions);
      if (typeof parsed === 'string') return error(parsed, 400);
      const ts = nowIso();
      const records = parsed.map(q => ({
        id: sha256(`${actor.userId}|${subject.toLowerCase()}|${q.type}|${q.text}`).slice(0, 32),
        teacherId: actor.userId,
        subject,
        topic,
        type: q.type,
        text: q.text,
        options: q.options,
        correct: q.correct,
        marks: q.marks,
        createdAt: ts,
      }));
      const unique = Array.from(new Map(records.map(r => [r.id, r])).values());
      const added = await wAdd('qbank', unique);
      const newIds = added.filter((x): x is string => !!x);
      if (newIds.length) {
        await wUpdate(
          P.teacherBank(actor.userId),
          newIds.map(id => ({ id, record: { createdAt: ts } }))
        );
      }
      return json({ saved: newIds.length, duplicates: records.length - newIds.length });
    },
  ],

  'DELETE /api/teacher/bank/:id': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const id = ctx.params.id;
      const [q] = await db.get<BankRec>('qbank', [id], { consistent: true });
      if (!q || q.teacherId !== actor.userId) return error('Question not found.', 404);
      await wDelete('qbank', [id]);
      await removePointers([P.teacherBank(actor.userId)], id);
      return json({ ok: true });
    },
  ],

  // ---------- mark sheet and report card ----------

  'GET /api/teacher/marksheet': [
    requireAuth(),
    async ctx => {
      const actor = await staffActor(ctx);
      if ('statusCode' in actor) return actor;
      const streamId = str(ctx.query?.streamId, 100);
      if (!actor.streamIds.includes(streamId)) return error('You are not assigned to that class.', 403);
      const roster = (await getMany<StudentRec>('students', await listIds(P.streamStudents(streamId)))).sort((x, y) =>
        x.admissionNo.localeCompare(y.admissionNo, undefined, { numeric: true })
      );
      const exams = (await getMany<ExamRec>('exams', await listIds(P.teacherExams(actor.userId)))).filter(
        e => e.teacherId === actor.userId && (e.streamIds || []).includes(streamId)
      );
      const asgs = (await getMany<AssignmentRec>('assignments', await listIds(P.teacherAssignments(actor.userId)))).filter(
        a => a.teacherId === actor.userId && (a.streamIds || []).includes(streamId) && modeOf(a) === 'portal'
      );
      const columns = [
        ...exams.map(e => ({ id: e.id, kind: 'exam', title: e.title, subject: e.subject, totalMarks: e.totalMarks, date: e.startAt })),
        ...asgs.map(a => ({ id: a.id, kind: 'assignment', title: a.title, subject: a.subject, totalMarks: a.totalMarks, date: a.createdAt })),
      ]
        .sort((x, y) => (x.date || '').localeCompare(y.date || ''))
        .slice(-60);
      const marks: Record<string, Record<string, { score: number | null; pending: number; status: string }>> = {};
      roster.forEach(s => {
        marks[s.id] = {};
      });
      const now = Date.now();
      for (const col of columns) {
        const isExam = col.kind === 'exam';
        const keys = roster.map(s => (isExam ? submissionKey(col.id, s.id) : assignmentSubKey(col.id, s.id)));
        for (let i = 0; i < keys.length; i += 100) {
          const chunk = keys.slice(i, i + 100);
          if (isExam) {
            const exam = exams.find(e => e.id === col.id)!;
            const ended = now >= Date.parse(exam.endAt) + EXAM_GRACE_MS;
            const recs = await db.get<SubmissionRec>('exam_submissions', chunk);
            recs.forEach((s, j) => {
              const st = roster[i + j];
              if (!s) marks[st.id][col.id] = { score: null, pending: 0, status: ended ? 'absent' : 'not_yet' };
              else if (s.status !== 'submitted' && !ended) marks[st.id][col.id] = { score: null, pending: 0, status: 'writing' };
              else {
                const r = studentResult(exam, s);
                marks[st.id][col.id] = { score: r.score, pending: r.pending, status: 'done' };
              }
            });
          } else {
            const recs = await db.get<AssignmentSubRec>('assignment_submissions', chunk);
            recs.forEach((s, j) => {
              const st = roster[i + j];
              if (!s) marks[st.id][col.id] = { score: null, pending: 0, status: 'absent' };
              else if (isMarked(s)) marks[st.id][col.id] = { score: s.marks, pending: 0, status: 'done' };
              else marks[st.id][col.id] = { score: null, pending: 0, status: 'tomark' };
            });
          }
        }
      }
      return json({
        students: roster.map(s => ({ id: s.id, name: s.name, admissionNo: s.admissionNo })),
        columns,
        marks,
      });
    },
  ],

  'POST /api/student/report': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const now = Date.now();
      const exams = (await getMany<ExamRec>('exams', await listIds(P.streamExams(student.streamId)))).filter(
        e => (e.streamIds || []).includes(student.streamId) && now >= resultsOpenAt(e)
      );
      const eKeys = exams.map(e => submissionKey(e.id, student.id));
      const eSubs: Array<SubmissionRec | null> = [];
      for (let i = 0; i < eKeys.length; i += 100) {
        eSubs.push(...(await db.get<SubmissionRec>('exam_submissions', eKeys.slice(i, i + 100))));
      }
      const asgs = (await getMany<AssignmentRec>('assignments', await listIds(P.streamAssignments(student.streamId)))).filter(
        a => (a.streamIds || []).includes(student.streamId) && modeOf(a) === 'portal'
      );
      const aKeys = asgs.map(a => assignmentSubKey(a.id, student.id));
      const aSubs: Array<AssignmentSubRec | null> = [];
      for (let i = 0; i < aKeys.length; i += 100) {
        aSubs.push(...(await db.get<AssignmentSubRec>('assignment_submissions', aKeys.slice(i, i + 100))));
      }
      const entries = [
        ...exams.map((e, i) => {
          const s = eSubs[i];
          const r = s ? studentResult(e, s) : null;
          return {
            kind: 'exam',
            id: e.id,
            title: e.title,
            subject: e.subject,
            teacherName: e.teacherName,
            date: e.startAt,
            score: r ? r.score : null,
            total: e.totalMarks,
            pending: r ? r.pending : 0,
            status: s ? 'done' : 'missed',
          };
        }),
        ...asgs.map((a, i) => {
          const s = aSubs[i];
          const marked = !!s && isMarked(s);
          return {
            kind: 'assignment',
            id: a.id,
            title: a.title,
            subject: a.subject,
            teacherName: a.teacherName,
            date: a.createdAt,
            score: marked && s ? s.marks : null,
            total: a.totalMarks,
            pending: 0,
            status: !s ? 'not_submitted' : marked ? 'done' : 'awaiting',
          };
        }),
      ].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
      const streams = await getStreams(student.schoolId);
      const stream = streams.find(s => s.id === student.streamId);
      return json({
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          streamName: stream ? stream.name : '',
          schoolName: student.schoolName,
        },
        entries,
      });
    },
  ],

  // ---------- students ----------

  'POST /api/student/login': [
    async ctx => {
      const b = bodyOf(ctx);
      const school = await getSchool(str(b.schoolId, 100));
      if (!school || school.status !== 'approved') return error('This school is not open on the portal right now.', 403);
      const adm = normAdm(b.admissionNo);
      const streamId = str(b.streamId, 100);
      if (!adm) return error('Enter your admission number.', 400);
      if (!streamId) return error('Select your class / stream.', 400);
      const ip = clientIp(ctx);
      const admKey = `${school.id}|${adm}`;
      if (
        (await failCount('login-ip', ip)) >= LOGIN_FAIL_LIMIT_IP ||
        (await failCount('login-adm', admKey)) >= LOGIN_FAIL_LIMIT_ADM
      ) {
        return error(
          'Too many unsuccessful sign-in attempts. Please wait an hour and try again, or check your details with your class teacher.',
          429
        );
      }
      const streams = await getStreams(school.id);
      const stream = streams.find(s => s.id === streamId);
      if (!stream) return error('Select your class / stream.', 400);
      const studentId = studentKey(streamId, adm);
      const [student] = await db.get<StudentRec>('students', [studentId], { consistent: true });
      if (!student || schoolIdOf(student) !== school.id) {
        await recordFail('login-ip', ip);
        await recordFail('login-adm', admKey);
        return error('We could not find that admission number in the selected class. Please check with your class teacher.', 404);
      }
      await bumpUsage(school.id, 'logins');
      const token = randomUUID().split('-').join('') + randomUUID().split('-').join('');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [added] = await db.tx.add('student_sessions', [
        { id: sha256(token), studentId, streamId, schoolId: school.id, expiresAt },
      ]);
      if (!added) return error('Could not sign you in. Please try again.', 500);
      return json({
        token,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          streamId,
          streamName: stream.name,
          schoolName: school.name,
        },
      });
    },
  ],

  'POST /api/student/materials': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const ids = await listIds(P.streamMaterials(student.streamId));
      const mine = (await getMany<MaterialRec>('materials', ids))
        .filter(m => (m.streamIds || []).includes(student.streamId))
        .sort(byNewest);
      return json({
        student: { name: student.name, admissionNo: student.admissionNo, streamId: student.streamId, schoolName: student.schoolName },
        materials: await materialsWithUrls(mine),
      });
    },
  ],

  'POST /api/student/exams': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const ids = await listIds(P.streamExams(student.streamId));
      const mine = (await getMany<ExamRec>('exams', ids))
        .filter(e => (e.streamIds || []).includes(student.streamId))
        .sort((x, y) => (x.startAt || '').localeCompare(y.startAt || ''))
        .slice(0, 400);
      const keys = mine.map(e => submissionKey(e.id, student.id));
      const subs: Array<SubmissionRec | null> = [];
      for (let i = 0; i < keys.length; i += 100) subs.push(...(await db.get<SubmissionRec>('exam_submissions', keys.slice(i, i + 100))));
      const exams = mine.map((e, i) => {
        const s = subs[i];
        const ended = Date.now() >= Date.parse(e.endAt) + EXAM_GRACE_MS;
        const finished = !!s && (s.status === 'submitted' || ended);
        return {
          id: e.id,
          title: e.title,
          subject: e.subject,
          teacherName: e.teacherName,
          instructions: e.instructions,
          startAt: e.startAt,
          endAt: e.endAt,
          questionCount: e.questions.length,
          totalMarks: e.totalMarks,
          resultsAt: new Date(resultsOpenAt(e)).toISOString(),
          result: s && Date.now() >= resultsOpenAt(e) ? studentResult(e, s) : null,
          submission: s
            ? {
                status: finished ? 'submitted' : 'in_progress',
                submittedAt: s.status === 'submitted' ? s.submittedAt : finished ? e.endAt : '',
                autoSubmitted: s.status === 'submitted' ? s.autoSubmitted : finished,
              }
            : null,
        };
      });
      return json({ exams, serverNow: nowIso() });
    },
  ],

  'POST /api/student/exams/:id/result': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const examId = ctx.params.id;
      const [exam] = await db.get<ExamRec>('exams', [examId], { consistent: true });
      if (!exam || !(exam.streamIds || []).includes(student.streamId)) return error('Exam not found.', 404);
      if (Date.now() < resultsOpenAt(exam)) return error('Results will be available shortly after the exam closes.', 400);
      const key = submissionKey(examId, student.id);
      const [sub] = await db.get<SubmissionRec>('exam_submissions', [key], { consistent: true });
      if (!sub) return error('You did not take this exam.', 404);
      const fin = await finaliseIfExpired(exam, { ...sub, id: key });
      return json({
        exam: {
          id: examId,
          title: exam.title,
          subject: exam.subject,
          teacherName: exam.teacherName,
          startAt: exam.startAt,
          endAt: exam.endAt,
          totalMarks: exam.totalMarks,
          questions: exam.questions,
        },
        answers: fin.answers || {},
        marks: fin.marks || {},
        submittedAt: fin.submittedAt,
        autoSubmitted: fin.autoSubmitted,
        ...studentResult(exam, fin),
      });
    },
  ],

  'POST /api/student/exams/:id/start': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const examId = ctx.params.id;
      const [exam] = await db.get<ExamRec>('exams', [examId], { consistent: true });
      if (!exam || !(exam.streamIds || []).includes(student.streamId)) return error('Exam not found.', 404);
      const phase = examPhase(exam);
      if (phase === 'upcoming') return error('This exam has not opened yet.', 400);
      const key = submissionKey(examId, student.id);
      const [existing] = await db.get<SubmissionRec>('exam_submissions', [key], { consistent: true });
      if (existing) {
        const fin = await finaliseIfExpired(exam, { ...existing, id: key });
        if (fin.status === 'submitted') return error('You have already submitted this exam.', 409);
      }
      if (phase === 'closed' && !existing) return error('This exam has closed.', 400);
      let answers: Record<string, string> = (existing && existing.answers) || {};
      if (!existing) {
        const ts = nowIso();
        const rec: SubmissionRec = {
          examId,
          studentId: student.id,
          studentName: student.name,
          admissionNo: student.admissionNo,
          streamId: student.streamId,
          answers: {},
          status: 'in_progress',
          autoSubmitted: false,
          startedAt: ts,
          submittedAt: '',
          autoScore: 0,
          marks: {},
          comment: '',
          updatedAt: ts,
        };
        const [added] = await wAdd('exam_submissions', [{ id: key, ...rec }]);
        if (added) {
          await addPointers([P.examSubs(examId)], key, ts);
        } else {
          const [again] = await db.get<SubmissionRec>('exam_submissions', [key], { consistent: true });
          if (!again) return error('Could not start the exam. Please try again.', 500);
          if (again.status === 'submitted') return error('You have already submitted this exam.', 409);
          answers = again.answers || {};
        }
      }
      return json({ exam: studentExamView({ ...exam, id: examId }), answers, serverNow: nowIso() });
    },
  ],

  'POST /api/student/exams/:id/save': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      const examId = ctx.params.id;
      const [exam] = await db.get<ExamRec>('exams', [examId], { consistent: true });
      if (!exam || !(exam.streamIds || []).includes(student.streamId)) return error('Exam not found.', 404);
      const key = submissionKey(examId, student.id);
      const [sub] = await db.get<SubmissionRec>('exam_submissions', [key], { consistent: true });
      if (!sub) return error('Start the exam first.', 400);
      if (sub.status === 'submitted') {
        return json({ status: 'submitted', submittedAt: sub.submittedAt, autoSubmitted: sub.autoSubmitted });
      }
      const end = Date.parse(exam.endAt);
      const now = Date.now();
      if (now > end + EXAM_GRACE_MS) {
        const fin = await finaliseIfExpired(exam, { ...sub, id: key });
        return json({ status: 'submitted', submittedAt: fin.submittedAt, autoSubmitted: true });
      }
      const answers = cleanAnswers(exam, b.answers);
      const timeUp = now >= end;
      const finish = b.submit === true || timeUp;
      const ts = nowIso();
      const autoSubmitted = finish && (b.submit !== true || b.auto === true);
      const patch: Rec = { answers, updatedAt: ts };
      if (finish) {
        patch.status = 'submitted';
        patch.autoSubmitted = autoSubmitted;
        patch.submittedAt = ts;
        patch.autoScore = scoreMcq(exam, answers);
        await bumpUsage(student.schoolId, 'submissions');
      }
      const [ok] = await wUpdate('exam_submissions', [{ id: key, record: patch, if: { status: 'in_progress' } }], {
        patch: true,
      });
      if (!ok) {
        const [latest] = await db.get<SubmissionRec>('exam_submissions', [key], { consistent: true });
        if (latest && latest.status === 'submitted') {
          return json({ status: 'submitted', submittedAt: latest.submittedAt, autoSubmitted: latest.autoSubmitted });
        }
        return error('Could not save your answers. Please try again.', 500);
      }
      return json({ status: finish ? 'submitted' : 'in_progress', submittedAt: finish ? ts : '', autoSubmitted, savedAt: ts });
    },
  ],

  'POST /api/student/assignments': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const ids = await listIds(P.streamAssignments(student.streamId));
      const mine = (await getMany<AssignmentRec>('assignments', ids))
        .filter(a => (a.streamIds || []).includes(student.streamId))
        .sort(byNewest)
        .slice(0, 400);
      const keys = mine.map(a => assignmentSubKey(a.id, student.id));
      const subs: Array<AssignmentSubRec | null> = [];
      for (let i = 0; i < keys.length; i += 100) {
        subs.push(...(await db.get<AssignmentSubRec>('assignment_submissions', keys.slice(i, i + 100))));
      }
      const checks = await getParentChecks(keys);
      const isParent = student.role === 'parent';
      const assignments = mine.map((a, i) => {
        const s = subs[i];
        const c = checks[i];
        return {
          id: a.id,
          title: a.title,
          subject: a.subject,
          teacherName: a.teacherName,
          dueAt: a.dueAt,
          totalMarks: a.totalMarks,
          createdAt: a.createdAt,
          submissionMode: modeOf(a),
          status: !s ? 'not_submitted' : isMarked(s) ? 'marked' : 'submitted',
          marks: s && isMarked(s) ? s.marks : null,
          late: !!(s && s.late),
          parentCheck: !c ? 'none' : c.done ? 'done' : 'not_done',
          parentNote: isParent && c ? c.note || '' : '',
          parentCheckedAt: c ? c.checkedAt : '',
        };
      });
      return json({ assignments, serverNow: nowIso() });
    },
  ],

  'POST /api/student/assignments/:id': [
    async ctx => {
      const student = await studentFromToken(str(bodyOf(ctx).token, 200));
      if (!student) return sessionError();
      const a = await loadStudentAssignment(student.streamId, ctx.params.id);
      if ('statusCode' in a) return a;
      const key = assignmentSubKey(a.id, student.id);
      const [sub] = await db.get<AssignmentSubRec>('assignment_submissions', [key], { consistent: true });
      const [assignment] = await attachUrls([a]);
      const submission = sub ? (await attachUrls([{ ...sub, id: key }]))[0] : null;
      return json({
        assignment: {
          id: assignment.id,
          title: assignment.title,
          subject: assignment.subject,
          instructions: assignment.instructions,
          teacherName: assignment.teacherName,
          dueAt: assignment.dueAt,
          totalMarks: assignment.totalMarks,
          createdAt: assignment.createdAt,
          attachment: assignment.attachment,
          submissionMode: modeOf(assignment),
        },
        submission,
        serverNow: nowIso(),
      });
    },
  ],

  'POST /api/student/assignments/:id/submit': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      const a = await loadStudentAssignment(student.streamId, ctx.params.id);
      if ('statusCode' in a) return a;
      if (modeOf(a) === 'paper') {
        return error('This assignment is handed in on paper on opening day, not through the portal.', 400);
      }
      const key = assignmentSubKey(a.id, student.id);
      const [existing] = await db.get<AssignmentSubRec>('assignment_submissions', [key], { consistent: true });
      if (existing && isMarked(existing)) {
        return error('Your teacher has already marked this assignment, so it can no longer be changed.', 400);
      }
      const answer = str(b.answer, 20000);
      const upload = await saveUpload(
        b.file,
        `assignment-work/${a.id}/${student.id}/${Date.now()}`,
        studentOwner(student.id)
      );
      if (typeof upload === 'string') return error(upload, 400);
      const oldFile = existing ? existing.attachment : null;
      let attachment: Attachment | null = upload;
      if (!attachment && b.keepFile === true && oldFile) attachment = oldFile;
      if (!answer && !attachment) return error('Type your answer or attach a photo or file of your work.', 400);
      const now = Date.now();
      const rec: AssignmentSubRec = {
        assignmentId: a.id,
        studentId: student.id,
        studentName: student.name,
        admissionNo: student.admissionNo,
        streamId: student.streamId,
        answer,
        attachment,
        submittedAt: new Date(now).toISOString(),
        late: !!a.dueAt && now > Date.parse(a.dueAt),
        marks: null,
        feedback: existing ? existing.feedback || '' : '',
        markedAt: '',
      };
      const [ok] = await wUpdate('assignment_submissions', [{ id: key, record: rec }]);
      if (!ok) return error('Could not submit your work. Please try again.', 500);
      await addPointers([P.assignmentSubs(a.id)], key, rec.submittedAt);
      if (!existing) await bumpUsage(student.schoolId, 'submissions');
      if (oldFile && (!attachment || attachment.path !== oldFile.path)) await deleteFiles([oldFile.path]);
      return json({ ok: true, submittedAt: rec.submittedAt, late: rec.late });
    },
  ],

  // A parent confirms whether the child has done an assignment, with an optional note for the teacher.
  'POST /api/parent/assignments/:id/check': [
    async ctx => {
      const b = bodyOf(ctx);
      const student = await studentFromToken(str(b.token, 200));
      if (!student) return sessionError();
      if (student.role !== 'parent') return error('Only a parent can confirm assignments.', 403);
      const a = await loadStudentAssignment(student.streamId, ctx.params.id);
      if ('statusCode' in a) return a;
      if (typeof b.done !== 'boolean') return error('Choose whether your child has done this assignment.', 400);
      const note = str(b.note, 1000);
      const key = assignmentSubKey(a.id, student.id);
      const [before] = await db.get<ParentCheckRec>('parent_checks', [key], { consistent: true });
      const rec: ParentCheckRec = {
        assignmentId: a.id,
        studentId: student.id,
        streamId: student.streamId,
        schoolId: student.schoolId,
        done: b.done,
        note,
        checkedAt: nowIso(),
      };
      const [ok] = await wUpdate('parent_checks', [{ id: key, record: rec }]);
      if (!ok) return error('Could not save your check. Please try again.', 500);
      const prev = !before ? 'none' : before.done ? 'done' : 'not_done';
      const next = rec.done ? 'done' : 'not_done';
      if (prev !== next) {
        try {
          const [cur] = await db.get<{ done: number; notDone: number }>('parent_check_counts', [a.id], { consistent: true });
          let doneN = cur ? cur.done || 0 : 0;
          let notN = cur ? cur.notDone || 0 : 0;
          if (prev === 'done') doneN -= 1;
          if (prev === 'not_done') notN -= 1;
          if (next === 'done') doneN += 1;
          else notN += 1;
          await wUpdate('parent_check_counts', [
            { id: a.id, record: { done: Math.max(0, doneN), notDone: Math.max(0, notN) } },
          ]);
        } catch (e) {
          console.error('parent check count failed', e);
        }
      }
      const changed = !before || before.done !== rec.done || (before.note || '') !== note;
      if (changed && (note || !rec.done)) {
        await pushTo(
          [a.teacherId],
          rec.done ? 'Note from a parent' : 'Parent says work is not done',
          `${student.name || student.admissionNo} · ${a.title}${note ? `: ${note.slice(0, 120)}` : ''}`
        );
      }
      return json({ ok: true, parentCheck: rec.done ? 'done' : 'not_done', parentNote: note, parentCheckedAt: rec.checkedAt });
    },
  ],

  'POST /api/student/logout': [
    async ctx => {
      const token = str(bodyOf(ctx).token, 200);
      if (token) {
        await db.tx.delete('student_sessions', [sha256(token)]);
        cacheDrop(`sess:${sha256(token)}`);
        if (isSafeId(token)) await db.tx.delete('student_sessions', [token]);
      }
      return json({ ok: true });
    },
  ],
};

for (const key of Object.keys(routes)) {
  if (key === 'GET /api/_healthcheck') continue;
  const chain = routes[key];
  routes[key] = key.includes(':') ? [checkParams, migrate, ...chain] : [migrate, ...chain];
}

// Parents can look at their child's work but never change it.
const parentBlock: RouterMiddleware = async ctx => {
  const s = await studentFromToken(str(bodyOf(ctx).token, 200));
  if (s && s.role === 'parent') return error('Parents can view their child’s work but cannot change anything.', 403);
  return undefined;
};

for (const key of [
  'POST /api/student/exams/:id/start',
  'POST /api/student/exams/:id/save',
  'POST /api/student/assignments/:id/submit',
  'POST /api/student/questions',
  'POST /api/student/uploads/part',
  'POST /api/student/uploads/sign',
  'POST /api/student/parent-pin',
]) {
  const chain = routes[key];
  if (chain) routes[key] = [...chain.slice(0, -1), parentBlock, chain[chain.length - 1]];
}

export const handler = router(routes);

// Runs every night at 02:00 Nairobi time (see cron.json).
export const nightlyBackup = async () => {
  try {
    const info = await runBackup('auto');
    await audit('system', 'Nightly backup made', `${info.records} records`);
  } catch (e) {
    console.error('nightly backup failed', e);
    await audit('system', 'Nightly backup FAILED', e instanceof Error ? e.message : 'unknown error');
  }
  try {
    await cleanupStaleUploads();
  } catch (e) {
    console.error('upload clean-up failed', e);
  }
  return { statusCode: 200 };
};

