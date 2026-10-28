// Checks moving data from an old site to a new one: backup restore, account matching and file copy.
// Usage: OLD=http://localhost:8787 NEW=http://localhost:8788 node local/move-test.mjs
const OLD = process.env.OLD || 'http://localhost:8787';
const NEW = process.env.NEW || 'http://localhost:8788';
const OWNER = 'linusomwoyo948@gmail.com';
const TEACHER = 'teacher.test@example.com';
const PRINCIPAL = 'principal.test@example.com';

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) failures++;
}

async function call(base, method, path, body, email) {
  const headers = { 'content-type': 'application/json' };
  if (email) headers.authorization = 'Bearer local:' + encodeURIComponent(email);
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// 1. Download the newest backup from the old site, and pretend the teacher and principal had old-style account ids.
const bl = await call(OLD, 'GET', '/api/owner/backups', undefined, OWNER);
let text = await (await fetch(OLD + bl.data.snapshots[0].url)).text();
const snap = JSON.parse(text);
const teacherId = Object.keys(snap.tables.teachers)[0];
const principalId = Object.values(snap.tables.schools).find((sc) => sc.name === 'Test Academy').principalUserId;
if (!teacherId || !principalId) throw new Error('test data missing');
text = text.split(teacherId).join('OLDTEACHERID0001').split(principalId).join('OLDPRINCIPALID01');

// 2. Upload it to the new site in pieces and restore it.
const bytes = Buffer.from(text, 'utf8');
const uploadId = 'move-test-' + Date.now();
const CHUNK = 1500000;
const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
for (let i = 0; i < count; i++) {
  const r = await call(NEW, 'POST', '/api/owner/backups/upload-chunk', { uploadId, index: i, data: bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64') }, OWNER);
  check(r.status === 200, `backup piece ${i + 1} of ${count} uploaded to the new site`);
}
const fin = await call(NEW, 'POST', '/api/owner/backups/upload-finish', { uploadId, count }, OWNER);
check(fin.status === 200, 'new site accepts the backup file' + (fin.status === 200 ? '' : ': ' + JSON.stringify(fin.data)));
const start = await call(NEW, 'POST', '/api/owner/backups/restore/start', { path: fin.data.backup.path, confirm: 'RESTORE' }, OWNER);
check(start.status === 200 && start.data.total > 0, 'restore starts');
let finished = false;
for (let i = 0; i < 50 && !finished; i++) {
  const st = await call(NEW, 'POST', '/api/owner/backups/restore/step', {}, OWNER);
  finished = !!st.data.finished;
}
check(finished, 'restore finishes');

// 3. People sign in with the same email and find their accounts.
const pme = await call(NEW, 'GET', '/api/me', undefined, PRINCIPAL);
check(pme.data.role === 'principal', 'principal signs in on the new site and is still the approved principal');
const tme = await call(NEW, 'GET', '/api/me', undefined, TEACHER);
check(tme.data.role === 'approved', 'teacher signs in on the new site and is still approved');
const tm = await call(NEW, 'GET', '/api/teacher/materials', undefined, TEACHER);
check(tm.status === 200 && (tm.data.materials || []).length === 2, 'teacher still sees their 2 materials');

// 4. Copy the attached files across.
const ex = await call(OLD, 'GET', '/api/owner/export-files', undefined, OWNER);
const files = ex.data.files.map((f) => ({ path: f.path, url: OLD + f.url }));
const cs = await call(NEW, 'POST', '/api/owner/file-copy/start', { files }, OWNER);
check(cs.status === 200, 'file copy starts');
let job = cs.data.job;
for (let i = 0; i < 20 && !job.finishedAt; i++) {
  job = (await call(NEW, 'POST', '/api/owner/file-copy/step', {}, OWNER)).data.job;
}
check(job.finishedAt && job.copied === files.length && job.failed.length === 0, `all ${files.length} files copied`);

// 5. A student on the new site opens a file.
const found = await call(NEW, 'GET', '/api/schools/find?name=' + encodeURIComponent('Test Academy'));
const login = await call(NEW, 'POST', '/api/student/login', { schoolId: found.data.school.id, admissionNo: 'A100', streamId: found.data.streams[0].id });
check(login.status === 200, 'student signs in on the new site');
const mats = await call(NEW, 'POST', '/api/student/materials', { token: login.data.token });
const m = mats.data.materials.find((x) => x.title === 'Notes 2');
const content = await (await fetch(NEW + m.attachment.url)).text();
check(content === 'part-one part-two', 'student opens the copied file and it is correct');

// 6. A new teacher who never used the old site can still join.
const newcomer = await call(NEW, 'GET', '/api/me', undefined, 'newteacher@example.com');
check(newcomer.status === 200 && newcomer.data.role === 'unregistered', 'a brand-new teacher signs in and can register');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
