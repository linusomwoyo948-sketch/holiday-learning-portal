// End-to-end check against the local test server (npm run local:server must be running).
// Usage: node local/smoke-test.mjs
const BASE = process.env.BASE || 'http://localhost:8787';
const OWNER = 'linusomwoyo948@gmail.com';
const PRINCIPAL = 'principal.test@example.com';
const TEACHER = 'teacher.test@example.com';

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
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const b64 = (s) => Buffer.from(s).toString('base64');

const me0 = await call('GET', '/api/me', undefined, OWNER);
check(me0.status === 200 && me0.data.role === 'owner', 'owner signs in and is recognised as site owner');
check((await call('GET', '/api/me')).status === 401, 'signed-out request is refused');

const req = await call('POST', '/api/principal/request', { principalName: 'Test Principal', phone: '0700000000', schoolName: 'Test Academy' }, PRINCIPAL);
check(req.status === 200, 'principal registers a school');
const schools = await call('GET', '/api/owner/schools', undefined, OWNER);
const school = (schools.data.schools || []).find((s) => s.name === 'Test Academy');
check(!!school, 'owner sees the school request');
check((await call('POST', `/api/owner/schools/${school.id}`, { status: 'approved' }, OWNER)).status === 200, 'owner approves the school');
check((await call('POST', `/api/owner/schools/${school.id}`, { status: 'approved' }, PRINCIPAL)).status === 403, 'principal cannot use owner actions');

const st = await call('POST', '/api/admin/streams', { name: 'Form 2 East' }, PRINCIPAL);
check(st.status === 200, 'principal adds a class');
const found = await call('GET', '/api/schools/find?name=' + encodeURIComponent('test academy'));
check(found.status === 200 && found.data.streams.length === 1, 'school can be found by name, with its class');
const streamId = found.data.streams[0].id;

const reg = await call('POST', '/api/teacher/register', { schoolId: school.id, name: 'Test Teacher', subjects: 'Maths', phone: '0711111111', streamIds: [streamId] }, TEACHER);
check(reg.status === 200, 'teacher asks to join the school');
const tlist = await call('GET', '/api/admin/teachers', undefined, PRINCIPAL);
const teacher = (tlist.data.teachers || [])[0];
check(!!teacher, 'principal sees the teacher request');
check((await call('POST', `/api/admin/teachers/${teacher.userId || teacher.id}`, { status: 'approved', streamIds: [streamId] }, PRINCIPAL)).status === 200, 'principal approves the teacher');
const tme = await call('GET', '/api/me', undefined, TEACHER);
check(tme.data.role === 'approved', 'teacher is now approved');

check((await call('POST', '/api/teacher/students', { streamId, entries: [{ admissionNo: 'A100', name: 'Jane Pupil' }] }, TEACHER)).status === 200, 'teacher adds a student');

// File in one request
const mat1 = await call('POST', '/api/teacher/materials', { title: 'Notes 1', subject: 'Maths', body: 'Read this', streamIds: [streamId], file: { name: 'notes.txt', data: b64('hello notes') } }, TEACHER);
check(mat1.status === 200, 'teacher posts a material with a small file');
// File in pieces
const uploadId = `${Date.now()}-abcdef1234`;
const p0 = await call('POST', '/api/teacher/uploads/part', { uploadId, index: 0, data: b64('part-one ') }, TEACHER);
const p1 = await call('POST', '/api/teacher/uploads/part', { uploadId, index: 1, data: b64('part-two') }, TEACHER);
check(p0.status === 200 && p1.status === 200, 'teacher uploads a file in two pieces');
const mat2 = await call('POST', '/api/teacher/materials', { title: 'Notes 2', subject: 'Maths', body: 'Two parts', streamIds: [streamId], file: { name: 'big.txt', uploadId, count: 2 } }, TEACHER);
check(mat2.status === 200, 'material with a joined file is saved');
const sign = await call('POST', '/api/teacher/uploads/sign', {}, TEACHER);
check(sign.status === 200 && sign.data.direct === false, 'direct upload link is skipped in test mode (falls back to pieces)');

const login = await call('POST', '/api/student/login', { schoolId: school.id, admissionNo: 'a100', streamId });
check(login.status === 200 && !!login.data.token, 'student signs in with admission number and stream');
const token = login.data.token;
const mats = await call('POST', '/api/student/materials', { token });
check(mats.status === 200 && mats.data.materials.length === 2, 'student sees both materials');
const joined = mats.data.materials.find((m) => m.title === 'Notes 2');
const fileRes = await fetch(BASE + joined.attachment.url);
check((await fileRes.text()) === 'part-one part-two', 'joined file downloads with the right content');

const asg = await call('POST', '/api/teacher/assignments', { title: 'Homework 1', subject: 'Maths', instructions: 'Do 1-10', streamIds: [streamId], submissionMode: 'paper' }, TEACHER);
check(asg.status === 200, 'teacher sends a paper assignment');
const sAsg = await call('POST', '/api/student/assignments', { token });
const asgId = sAsg.data.assignments[0].id;
check((await call('POST', '/api/student/parent-pin', { token, pin: '4321' })).status === 200, 'student sets a parent PIN');
const plogin = await call('POST', '/api/parent/login', { schoolId: school.id, admissionNo: 'A100', streamId, pin: '4321' });
check(plogin.status === 200, 'parent signs in with the PIN');
const ptoken = plogin.data.token;
check((await call('POST', `/api/parent/assignments/${asgId}/check`, { token: ptoken, done: true, note: 'Finished at home' })).status === 200, 'parent confirms the assignment is done');
check((await call('POST', `/api/student/assignments/${asgId}/submit`, { token: ptoken, answer: 'x' })).status === 403, 'parent cannot hand in work');
const tl = await call('GET', '/api/teacher/assignments', undefined, TEACHER);
check(tl.data.assignments[0].parentDone === 1, 'teacher sees 1 parent confirmed in the list');
const review = await call('GET', `/api/teacher/assignments/${asgId}/submissions`, undefined, TEACHER);
check(review.data.parentChecks[0].status === 'done' && review.data.parentChecks[0].note === 'Finished at home', 'teacher sees the parent check and note');

// Backups
const bk = await call('POST', '/api/owner/backups', {}, OWNER);
check(bk.status === 200 && bk.data.backup.records > 0, 'owner makes a backup');
const bl = await call('GET', '/api/owner/backups', undefined, OWNER);
check(bl.data.snapshots.length >= 1 && !!bl.data.snapshots[0].url, 'backup appears with a download link');
const bdata = await (await fetch(BASE + bl.data.snapshots[0].url)).text();
check(JSON.parse(bdata).tables.teachers !== undefined, 'downloaded backup contains the teachers');

// Export file list
const ex = await call('GET', '/api/owner/export-files', undefined, OWNER);
check(ex.status === 200 && ex.data.files.length === 2, 'owner downloads the list of attached files');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
