// Checks deleting a whole school and deleting backups against the local test server.
// Start with an empty test server (no local-data.json), then: node local/delete-test.mjs [path-to-local-data-folder]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8787';
const DATA_DIR = process.argv[2] || process.cwd();
const OWNER = 'linusomwoyo948@gmail.com';

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) failures++;
}
async function call(method, path, body, email) {
  const headers = { 'content-type': 'application/json' };
  if (email) headers.authorization = 'Bearer local:' + encodeURIComponent(email);
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
const b64 = (s) => Buffer.from(s).toString('base64');

// Sets up one school with a principal, teacher, class, student, and one of everything.
async function makeSchool(tag) {
  const principal = `principal.${tag}@example.com`;
  const teacher = `teacher.${tag}@example.com`;
  const name = `School ${tag.toUpperCase()}`;
  await call('POST', '/api/principal/request', { principalName: `P ${tag}`, phone: '0700000000', schoolName: name }, principal);
  const schools = (await call('GET', '/api/owner/schools', undefined, OWNER)).data.schools;
  const school = schools.find((s) => s.name === name);
  await call('POST', `/api/owner/schools/${school.id}`, { status: 'approved' }, OWNER);
  await call('POST', '/api/admin/streams', { name: 'Form 1' }, principal);
  const found = (await call('GET', '/api/schools/find?name=' + encodeURIComponent(name))).data;
  const streamId = found.streams[0].id;
  await call('POST', '/api/teacher/register', { schoolId: school.id, name: `T ${tag}`, subjects: 'Maths', phone: '0711111111', streamIds: [streamId] }, teacher);
  const t = (await call('GET', '/api/admin/teachers', undefined, principal)).data.teachers[0];
  await call('POST', `/api/admin/teachers/${t.userId || t.id}`, { status: 'approved', streamIds: [streamId] }, principal);
  await call('POST', '/api/teacher/students', { streamId, entries: [{ admissionNo: `${tag}1`, name: `Learner ${tag}` }] }, teacher);
  await call('POST', '/api/teacher/materials', { title: `Notes ${tag}`, subject: 'Maths', body: 'x', streamIds: [streamId], file: { name: 'n.txt', data: b64(`notes ${tag}`) } }, teacher);
  const asg = await call('POST', '/api/teacher/assignments', { title: `Asg ${tag}`, subject: 'Maths', instructions: 'y', streamIds: [streamId], submissionMode: 'portal' }, teacher);
  const now = Date.now();
  await call('POST', '/api/teacher/exams', { title: `Exam ${tag}`, subject: 'Maths', streamIds: [streamId], startAt: new Date(now - 60000).toISOString(), endAt: new Date(now + 3600000).toISOString(), questions: [{ type: 'mcq', text: 'q', options: ['a', 'b'], correct: 1, marks: 1 }] }, teacher);
  await call('POST', '/api/staff/announcements', { title: `Notice ${tag}`, message: 'm', streamIds: [streamId] }, principal);
  await call('POST', '/api/teacher/bank', { subject: 'Maths', topic: 't', questions: [{ type: 'mcq', text: `bank ${tag}`, options: ['a', 'b'], correct: 0, marks: 1 }] }, teacher);
  const login = (await call('POST', '/api/student/login', { schoolId: school.id, admissionNo: `${tag}1`, streamId })).data;
  const token = login.token;
  const sAsg = (await call('POST', '/api/student/assignments', { token })).data.assignments[0];
  await call('POST', `/api/student/assignments/${sAsg.id}/submit`, { token, answer: 'done', file: { name: 'w.txt', data: b64(`work ${tag}`) } });
  const mats = (await call('POST', '/api/student/materials', { token })).data.materials;
  await call('POST', '/api/student/questions', { token, itemType: 'material', itemId: mats[0].id, text: 'help' });
  const ex = (await call('POST', '/api/student/exams', { token })).data.exams[0];
  await call('POST', `/api/student/exams/${ex.id}/start`, { token });
  await call('POST', `/api/student/exams/${ex.id}/save`, { token, answers: { [Object.keys({})[0] || 'x']: '1' }, submit: true });
  await call('POST', '/api/student/parent-pin', { token, pin: '1234' });
  const plogin = (await call('POST', '/api/parent/login', { schoolId: school.id, admissionNo: `${tag}1`, streamId, pin: '1234' })).data;
  await call('POST', `/api/parent/assignments/${sAsg.id}/check`, { token: plogin.token, done: true, note: `note ${tag}` });
  return { school, name, principal, teacher, streamId, token, tag };
}

function dataText() {
  return readFileSync(join(DATA_DIR, 'local-data.json'), 'utf8');
}
function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...listFiles(f));
    else out.push(f);
  }
  return out;
}

const A = await makeSchool('a');
const B = await makeSchool('b');
check(dataText().includes('Learner a') && dataText().includes('note a'), 'school A has its data before deletion');
const filesBefore = listFiles(join(DATA_DIR, 'local-files')).filter((f) => !f.includes('backups'));

// Safety rules
const notPaused = await call('POST', `/api/owner/schools/${A.school.id}/delete/start`, { confirm: A.name }, OWNER);
check(notPaused.status === 400, 'an active school cannot be deleted before it is paused');
await call('POST', `/api/owner/schools/${A.school.id}`, { status: 'suspended' }, OWNER);
const wrongName = await call('POST', `/api/owner/schools/${A.school.id}/delete/start`, { confirm: 'wrong' }, OWNER);
check(wrongName.status === 400, 'deletion needs the school name typed correctly');
const notOwner = await call('POST', `/api/owner/schools/${A.school.id}/delete/start`, { confirm: A.name }, A.principal);
check(notOwner.status === 403, 'only the site owner can delete a school');

// Delete
const start = await call('POST', `/api/owner/schools/${A.school.id}/delete/start`, { confirm: 'school a' }, OWNER);
check(start.status === 200, 'deletion starts (name match ignores capital letters)');
let step;
for (let i = 0; i < 20; i++) {
  step = await call('POST', '/api/owner/schools/delete/step', {}, OWNER);
  if (step.data.finished) break;
}
check(step.data.finished && step.data.removed > 0, `deletion finishes (${step.data.removed} records removed)`);

// Nothing of A is left in the live tables (backups are separate files)
const live = JSON.parse(dataText());
const leftovers = [];
for (const [table, rows] of Object.entries(live)) {
  if (table.startsWith('audit_') || table.startsWith('chg_') || table === 'usage' || table.startsWith('rl_') || table === 'student_sessions') continue;
  for (const [id, rec] of Object.entries(rows)) {
    const s = JSON.stringify(rec) + id;
    if (s.includes(A.school.id) || s.includes('Learner a') || s.includes('note a') || s.includes('bank a') || s.includes('Notes a') || s.includes('teacher.a@') || s.includes('principal.a@')) {
      if (table === 'settings' && id === 'school-delete-job') continue;
      leftovers.push(`${table}/${id}`);
    }
  }
}
check(leftovers.length === 0, 'no record of school A remains' + (leftovers.length ? ': ' + leftovers.join(', ') : ''));
const emptyPointerTables = Object.entries(live).filter(([t, rows]) => t.startsWith('p_') && Object.keys(rows).length > 0 && JSON.stringify(rows).includes(A.school.id));
check(emptyPointerTables.length === 0, 'no class or teacher lists of school A remain');
const filesAfter = listFiles(join(DATA_DIR, 'local-files')).filter((f) => !f.includes('backups'));
const aFilesLeft = filesAfter.filter((f) => { try { const c = readFileSync(f, 'utf8'); return c === 'notes a' || c === 'work a'; } catch { return false; } });
check(aFilesLeft.length === 0 && filesAfter.length < filesBefore.length, 'school A’s uploaded files are deleted');

// A's people can no longer get in; the name is free again
check((await call('POST', '/api/student/materials', { token: A.token })).status === 401, 'school A learners are signed out');
check((await call('GET', '/api/me', undefined, A.teacher)).data.role !== 'approved', 'school A teacher is no longer a teacher there');
check((await call('GET', '/api/schools/find?name=' + encodeURIComponent(A.name))).status === 404, 'school A can no longer be found by name');
const again = await call('POST', '/api/principal/request', { principalName: 'P a', phone: '0700000000', schoolName: A.name }, A.principal);
check(again.status === 200, 'the principal and school name are free to register again');

// B is untouched
const bMats = await call('POST', '/api/student/materials', { token: B.token });
check(bMats.status === 200 && bMats.data.materials.length === 1, 'school B learners still see their materials');
const bFile = await fetch(BASE + bMats.data.materials[0].attachment.url);
check((await bFile.text()) === 'notes b', 'school B files are still there');
const bReview = await call('GET', `/api/teacher/assignments/${(await call('GET', '/api/teacher/assignments', undefined, B.teacher)).data.assignments[0].id}/submissions`, undefined, B.teacher);
check(bReview.data.submissions.length === 1 && bReview.data.parentChecks[0].note === 'note b', 'school B submissions and parent checks are intact');

// Backups
await call('POST', '/api/owner/backups', {}, OWNER);
await call('POST', '/api/owner/backups', {}, OWNER);
let list = (await call('GET', '/api/owner/backups', undefined, OWNER)).data.snapshots;
check(list.length >= 3, `several backups exist (${list.length}), including the safety copy`);
const one = list[list.length - 1].path;
const d1 = await call('POST', '/api/owner/backups/delete', { paths: [one] }, OWNER);
check(d1.data.deleted === 1, 'one chosen backup is deleted');
const keep = await call('POST', '/api/owner/backups/delete', { keepNewest: true }, OWNER);
list = (await call('GET', '/api/owner/backups', undefined, OWNER)).data.snapshots;
check(list.length === 1, `clear old backups keeps only the newest (${keep.data.deleted} deleted)`);
const backupFiles = listFiles(join(DATA_DIR, 'local-files', 'backups', 'snapshots'));
check(backupFiles.length === 1, 'deleted backup files are removed from storage');
// Deleting the newest too, then backing up again, makes a fresh full backup
await call('POST', '/api/owner/backups/delete', { paths: [list[0].path] }, OWNER);
const fresh = await call('POST', '/api/owner/backups', {}, OWNER);
check(fresh.status === 200 && fresh.data.backup.records > 0, 'a new backup still works after deleting all of them');
check((await call('POST', '/api/owner/backups/delete', { keepNewest: true }, B.principal)).status === 403, 'only the site owner can delete backups');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
