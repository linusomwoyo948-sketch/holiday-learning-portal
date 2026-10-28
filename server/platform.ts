// Platform layer: routing, sign-in checks, database, file storage and phone alerts.
// On Netlify it uses Supabase (set SUPABASE_URL and SUPABASE_SECRET_KEY).
// Without those settings (npm run local) it keeps data in local-data.json and files in local-files/ for testing.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

type Rec = Record<string, unknown>;

const BUCKET = 'files';

function sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

// ---------- user ids ----------

// Each person is identified by their verified email address.
export function userIdForEmail(email: string): string {
    return 'u' + sha256(email.trim().toLowerCase()).slice(0, 24);
}

// ---------- errors ----------

type DbErrorCode = 'AppDatabaseDuplicateId' | 'AppDatabaseConditionFailed' | 'AppDatabaseQuotaExceeded';

class AppDatabaseError extends Error {
    code: DbErrorCode;
    statusCode = 409;
    details: Record<string, unknown> = {};
    constructor(code: DbErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}

export function isAppDatabaseError(e: unknown): e is AppDatabaseError {
    return e instanceof AppDatabaseError;
}

function translateError(message: string): Error {
    if (message.includes('KV_DUPLICATE')) {
        return new AppDatabaseError('AppDatabaseDuplicateId', message);
    }
    if (message.includes('KV_CONDITION')) {
        return new AppDatabaseError('AppDatabaseConditionFailed', message);
    }
    return new Error(message);
}

// ---------- increment and wire format ----------

const INC = Symbol('increment');
type IncrementValue = { [INC]: number };

export function increment(amount: number): IncrementValue {
    return { [INC]: amount };
}

function isIncrement(v: unknown): v is IncrementValue {
    return typeof v === 'object' && v !== null && INC in v;
}

function encodeRecord(record: Rec): Rec {
    const out: Rec = {};
    for (const [k, v] of Object.entries(record)) {
        if (v === undefined) {
            out[k] = { $unset: true };
        } else if (isIncrement(v)) {
            out[k] = { $inc: v[INC] };
        } else {
            out[k] = v;
        }
    }
    return out;
}

function encodeCondition(cond?: Rec): Rec | undefined {
    if (!cond) {
        return undefined;
    }
    const out: Rec = {};
    for (const [k, v] of Object.entries(cond)) {
        out[k] = v === undefined ? { $absent: true } : v;
    }
    return out;
}

type WireOp = { kind: 'add' | 'update' | 'delete'; tbl: string; patch?: boolean; items: Rec[] };

// ---------- drivers ----------

type FileInfo = { path: string; size: number };

export type Driver = {
    apply(ops: WireOp[], atomic: boolean): Promise<unknown[][]>;
    get(tbl: string, ids: string[]): Promise<Map<string, Rec>>;
    list(tbl: string, offset: number, limit: number): Promise<{ rows: { id: string; data: Rec }[]; more: boolean }>;
    verifyToken(token: string): Promise<{ email: string; name: string } | null>;
    // files
    putFile(path: string, bytes: Buffer, contentType: string): Promise<boolean>;
    getFile(path: string): Promise<Buffer | null>;
    deleteFiles(paths: string[]): Promise<void>;
    listFiles(prefix: string, offset: number, limit: number): Promise<{ files: FileInfo[]; more: boolean }>;
    fileUrls(paths: string[]): Promise<{ path: string; url: string }[]>;
    uploadUrl(path: string): Promise<string | null>;
    moveFile(from: string, to: string): Promise<boolean>;
};

function clone<T>(v: T): T {
    return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

// Same rules as kv_apply in supabase/schema.sql, kept in memory and saved to local-data.json.
function localDriver(): Driver {
    const file = resolve(process.cwd(), 'local-data.json');
    const filesDir = resolve(process.cwd(), 'local-files');
    let store: Record<string, Record<string, Rec>> = {};
    if (existsSync(file)) {
        try {
            store = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            store = {};
        }
    }
    const save = () => writeFileSync(file, JSON.stringify(store));
    const table = (t: string) => (store[t] ??= {});
    const filePath = (p: string) => {
        const full = resolve(filesDir, p);
        if (!full.startsWith(filesDir + sep)) {
            throw new Error('Bad file path');
        }
        return full;
    };

    function run(op: WireOp, atomic: boolean): unknown[] {
        const t = table(op.tbl);
        if (op.kind === 'add') {
            return op.items.map((it) => {
                const id = String(it.id);
                if (t[id]) {
                    if (atomic) {
                        throw translateError('KV_DUPLICATE:' + op.tbl + ':' + id);
                    }
                    return null;
                }
                t[id] = clone((it.record as Rec) ?? {});
                return id;
            });
        }
        if (op.kind === 'update') {
            return op.items.map((it) => {
                const id = String(it.id);
                const cur = t[id];
                let ok = !(op.patch && !cur);
                const cond = it.if as Rec | undefined;
                if (ok && cond) {
                    for (const [k, v] of Object.entries(cond)) {
                        const absent = typeof v === 'object' && v !== null && '$absent' in v;
                        if (absent ? cur && k in cur : !cur || !(k in cur) || JSON.stringify(cur[k]) !== JSON.stringify(v)) {
                            ok = false;
                        }
                    }
                }
                if (!ok) {
                    if (atomic) {
                        throw translateError('KV_CONDITION:' + op.tbl + ':' + id);
                    }
                    return false;
                }
                const next: Rec = op.patch && cur ? { ...cur } : {};
                for (const [k, v] of Object.entries((it.record as Rec) ?? {})) {
                    if (k === 'id') {
                        continue;
                    }
                    if (typeof v === 'object' && v !== null && '$inc' in v) {
                        next[k] = (typeof next[k] === 'number' ? (next[k] as number) : 0) + Number((v as Rec).$inc);
                    } else if (typeof v === 'object' && v !== null && '$unset' in v) {
                        delete next[k];
                    } else {
                        next[k] = clone(v);
                    }
                }
                t[id] = next;
                return true;
            });
        }
        return op.items.map((it) => {
            const id = String(it.id);
            const had = !!t[id];
            delete t[id];
            return had;
        });
    }

    function walk(dir: string, out: string[]) {
        if (!existsSync(dir)) {
            return;
        }
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            if (statSync(full).isDirectory()) {
                walk(full, out);
            } else {
                out.push(full.slice(filesDir.length + 1).split(sep).join('/'));
            }
        }
    }

    return {
        async apply(ops, atomic) {
            const backup = atomic ? clone(store) : null;
            try {
                const out = ops.map((op) => run(op, atomic));
                save();
                return out;
            } catch (e) {
                if (backup) {
                    store = backup;
                }
                throw e;
            }
        },
        async get(tbl, ids) {
            const t = table(tbl);
            const m = new Map<string, Rec>();
            ids.forEach((id) => t[id] && m.set(id, clone(t[id])));
            return m;
        },
        async list(tbl, offset, limit) {
            const t = table(tbl);
            const ids = Object.keys(t).sort();
            return { rows: ids.slice(offset, offset + limit).map((id) => ({ id, data: clone(t[id]) })), more: offset + limit < ids.length };
        },
        // Local test sign-in: the browser sends "local:<email>".
        async verifyToken(token) {
            if (!token.startsWith('local:')) {
                return null;
            }
            const email = decodeURIComponent(token.slice(6)).trim().toLowerCase();
            return email ? { email, name: email.split('@')[0] } : null;
        },
        async putFile(path, bytes) {
            const full = filePath(path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, bytes);
            return true;
        },
        async getFile(path) {
            const full = filePath(path);
            return existsSync(full) ? readFileSync(full) : null;
        },
        async deleteFiles(paths) {
            paths.forEach((p) => rmSync(filePath(p), { force: true }));
        },
        async listFiles(prefix, offset, limit) {
            const all: string[] = [];
            walk(filesDir, all);
            const hits = all.filter((p) => p.startsWith(prefix)).sort();
            return {
                files: hits.slice(offset, offset + limit).map((p) => ({ path: p, size: statSync(filePath(p)).size })),
                more: offset + limit < hits.length,
            };
        },
        async fileUrls(paths) {
            return paths.map((p) => ({ path: p, url: '/api/_local/file?path=' + encodeURIComponent(p) }));
        },
        async uploadUrl() {
            return null;
        },
        async moveFile(from, to) {
            const a = filePath(from);
            if (!existsSync(a)) {
                return false;
            }
            const b = filePath(to);
            mkdirSync(dirname(b), { recursive: true });
            renameSync(a, b);
            return true;
        },
    };
}

function supabaseDriver(url: string, key: string): Driver {
    const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const tokenCache = new Map<string, { at: number; user: { email: string; name: string } }>();
    const bucket = () => sb.storage.from(BUCKET);

    return {
        async apply(ops, atomic) {
            const { data, error } = await sb.rpc('kv_apply', { ops, atomic });
            if (error) {
                throw translateError(error.message);
            }
            return data as unknown[][];
        },
        async get(tbl, ids) {
            const m = new Map<string, Rec>();
            for (let i = 0; i < ids.length; i += 100) {
                const chunk = ids.slice(i, i + 100);
                const { data, error } = await sb.from('kv').select('id,data').eq('tbl', tbl).in('id', chunk);
                if (error) {
                    throw new Error(error.message);
                }
                (data ?? []).forEach((r: { id: string; data: Rec }) => m.set(r.id, r.data));
            }
            return m;
        },
        async list(tbl, offset, limit) {
            const { data, error } = await sb
                .from('kv')
                .select('id,data')
                .eq('tbl', tbl)
                .order('id')
                .range(offset, offset + limit);
            if (error) {
                throw new Error(error.message);
            }
            const rows = (data ?? []) as { id: string; data: Rec }[];
            return { rows: rows.slice(0, limit), more: rows.length > limit };
        },
        async verifyToken(token) {
            const hit = tokenCache.get(token);
            if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
                return hit.user;
            }
            const { data, error } = await sb.auth.getUser(token);
            if (error || !data.user || !data.user.email) {
                return null;
            }
            const meta = (data.user.user_metadata ?? {}) as Rec;
            const user = {
                email: data.user.email.toLowerCase(),
                name: String(meta.full_name || meta.name || data.user.email.split('@')[0]),
            };
            if (tokenCache.size > 500) {
                tokenCache.clear();
            }
            tokenCache.set(token, { at: Date.now(), user });
            return user;
        },
        async putFile(path, bytes, contentType) {
            const { error } = await bucket().upload(path, bytes, { contentType, upsert: true });
            if (error) {
                console.error('file upload failed', path, error.message);
                return false;
            }
            return true;
        },
        async getFile(path) {
            const { data, error } = await bucket().download(path);
            if (error || !data) {
                return null;
            }
            return Buffer.from(await data.arrayBuffer());
        },
        async deleteFiles(paths) {
            for (let i = 0; i < paths.length; i += 100) {
                const { error } = await bucket().remove(paths.slice(i, i + 100));
                if (error) {
                    throw new Error(error.message);
                }
            }
        },
        async listFiles(prefix, offset, limit) {
            const { data, error } = await sb.rpc('file_list', { prefix, off: offset, lim: limit + 1 });
            if (error) {
                throw new Error(error.message);
            }
            const rows = ((data ?? []) as { name: string; size: number | string | null }[]).map((r) => ({
                path: r.name,
                size: Number(r.size) || 0,
            }));
            return { files: rows.slice(0, limit), more: rows.length > limit };
        },
        async fileUrls(paths) {
            if (!paths.length) {
                return [];
            }
            const { data, error } = await bucket().createSignedUrls(paths, 6 * 60 * 60);
            if (error) {
                throw new Error(error.message);
            }
            return (data ?? []).map((d, i) => ({ path: d.path || paths[i], url: d.signedUrl || '' }));
        },
        async uploadUrl(path) {
            const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
            if (error || !data) {
                console.error('could not create upload link', error?.message);
                return null;
            }
            return data.signedUrl;
        },
        async moveFile(from, to) {
            await bucket().remove([to]);
            const { error } = await bucket().move(from, to);
            if (error) {
                console.error('file move failed', error.message);
                return false;
            }
            return true;
        },
    };
}

let driverInstance: Driver | null = null;

// True when running on Netlify (or another hosted server) rather than on your own computer.
function isHosted(): boolean {
    return !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SITE_ID || process.env.URL);
}

function serverSettings(): { url: string; key: string } {
    const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    return { url, key };
}

const SETTINGS_MISSING = 'SERVER_SETTINGS_MISSING';

function driver(): Driver {
    if (!driverInstance) {
        const { url, key } = serverSettings();
        if (url && key) {
            driverInstance = supabaseDriver(url, key);
        } else if (isHosted()) {
            // Never fall back to test mode on the live site: say clearly what is missing instead.
            throw new Error(SETTINGS_MISSING);
        } else {
            driverInstance = localDriver();
        }
    }
    return driverInstance;
}

// Checks the connection to Supabase step by step. Shows only yes/no answers and error messages, never keys.
export async function setupCheck(): Promise<Record<string, unknown>> {
    const { url, key } = serverSettings();
    const out: Record<string, unknown> = {
        SUPABASE_URL: !url ? 'MISSING' : /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ? 'ok' : 'looks wrong (should be like https://abcd1234.supabase.co)',
        SUPABASE_SECRET_KEY: !key
            ? 'MISSING'
            : key.startsWith('sb_publishable_')
              ? 'WRONG KEY: this is the Publishable key, use the Secret key (sb_secret_...)'
              : key.startsWith('sb_secret_') || key.startsWith('eyJ')
                ? 'ok'
                : 'looks wrong (should start with sb_secret_)',
    };
    if (!url || !key) {
        out.result = 'Add the missing settings in Netlify (Site configuration > Environment variables), then Deploys > Trigger deploy.';
        return out;
    }
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const db1 = await sb.from('kv').select('id').limit(1);
    out.database = db1.error ? 'ERROR: ' + db1.error.message : 'ok';
    const rpc = await sb.rpc('kv_apply', { ops: [], atomic: false });
    out.database_functions = rpc.error ? 'ERROR: ' + rpc.error.message : 'ok';
    const files = await sb.rpc('file_list', { prefix: 'zz-check/', off: 0, lim: 1 });
    out.file_list_function = files.error ? 'ERROR: ' + files.error.message : 'ok';
    const bucket = await sb.storage.getBucket(BUCKET);
    out.file_storage = bucket.error ? 'ERROR: ' + bucket.error.message : 'ok';
    const problems = Object.values(out).filter((v) => typeof v === 'string' && v !== 'ok');
    out.result = problems.length
        ? db1.error || rpc.error || files.error || bucket.error
            ? 'Run supabase/schema.sql again in Supabase > SQL Editor, and check that the Secret key and Project URL belong to the same project.'
            : 'Fix the settings marked above in Netlify, then Deploys > Trigger deploy.'
        : 'All good. The server is connected to Supabase.';
    return out;
}

export const isLocal = () => !(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));

// ---------- db (same interface the app was written for) ----------

type UpdateItem = { id: string; record: Rec; if?: Rec };

class Operation<T> implements PromiseLike<T> {
    wire: WireOp;
    private promise: Promise<T> | null = null;
    constructor(wire: WireOp) {
        this.wire = wire;
    }
    private start(): Promise<T> {
        if (!this.promise) {
            this.promise = driver()
                .apply([this.wire], false)
                .then((r) => r[0] as T);
        }
        return this.promise;
    }
    then<A = T, B = never>(onOk?: ((v: T) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
        return this.start().then(onOk, onErr);
    }
    catch<B = never>(onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
        return this.start().catch(onErr);
    }
    finally(fn?: (() => void) | null): Promise<T> {
        return this.start().finally(fn);
    }
}

function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const db = {
    tx: {
        add(tbl: string, records: Rec[]) {
            return new Operation<(string | null)[]>({
                kind: 'add',
                tbl,
                items: records.map((r) => {
                    const { id, ...rest } = r;
                    return { id: typeof id === 'string' && id ? id : newId(), record: encodeRecord(rest) };
                }),
            });
        },
        update(tbl: string, items: UpdateItem[], options?: { patch?: boolean }) {
            return new Operation<boolean[]>({
                kind: 'update',
                tbl,
                patch: !!options?.patch,
                items: items.map((it) => {
                    const w: Rec = { id: it.id, record: encodeRecord(it.record) };
                    const c = encodeCondition(it.if);
                    if (c) {
                        w.if = c;
                    }
                    return w;
                }),
            });
        },
        delete(tbl: string, ids: string[]) {
            return new Operation<boolean[]>({ kind: 'delete', tbl, items: ids.map((id) => ({ id })) });
        },
    },

    // All operations succeed together or none are kept.
    async transact(ops: readonly Operation<unknown>[]): Promise<unknown[]> {
        return driver().apply(
            ops.map((o) => o.wire),
            true
        );
    },

    async get<T = Rec>(tbl: string, ids: string[], _options?: { consistent?: boolean }): Promise<(T | null)[]> {
        if (!ids.length) {
            return [];
        }
        const m = await driver().get(tbl, ids);
        return ids.map((id) => (m.has(id) ? (m.get(id) as T) : null));
    },

    async list<T = Rec>(tbl: string, options?: { nextToken?: string; limit?: number }): Promise<{ items: (T & { id: string })[]; nextToken?: string }> {
        const offset = options?.nextToken ? Number(options.nextToken) || 0 : 0;
        const limit = Math.min(Math.max(options?.limit ?? 100, 1), 1000);
        const { rows, more } = await driver().list(tbl, offset, limit);
        return {
            items: rows.map((r) => ({ ...(r.data as T), id: r.id })),
            nextToken: more ? String(offset + limit) : undefined,
        };
    },

    async delete(tbl: string, ids: string[]): Promise<boolean[]> {
        if (ids.length === 0) {
            return [];
        }
        return db.tx.delete(tbl, ids);
    },
};

// ---------- file storage (same interface the app was written for) ----------
// Backups are JSON text (contentType application/json). Every other file is passed in and out as base64.

export const storage = {
    async write(items: { path: string; content: string; contentType?: string }[]): Promise<boolean[]> {
        const out: boolean[] = [];
        for (const it of items) {
            const type = it.contentType || 'application/octet-stream';
            const bytes = type === 'application/json' ? Buffer.from(it.content, 'utf8') : Buffer.from(it.content, 'base64');
            out.push(await driver().putFile(it.path, bytes, type));
        }
        return out;
    },
    async writeBytes(path: string, bytes: Buffer, contentType: string): Promise<boolean> {
        return driver().putFile(path, bytes, contentType || 'application/octet-stream');
    },
    // A missing file comes back with empty content.
    async read(paths: string[]): Promise<{ path: string; content: string }[]> {
        return Promise.all(
            paths.map(async (p) => {
                const b = await driver().getFile(p);
                return { path: p, content: b ? b.toString('base64') : '' };
            })
        );
    },
    async url(paths: string[]): Promise<{ path: string; url: string }[]> {
        return driver().fileUrls(paths);
    },
    async delete(paths: string[]): Promise<void> {
        if (paths.length) {
            await driver().deleteFiles(paths);
        }
    },
    async list(options: { prefix?: string; nextToken?: string; limit?: number }): Promise<{ paths: string[]; nextToken?: string }> {
        const offset = options.nextToken ? Number(options.nextToken) || 0 : 0;
        const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
        const { files, more } = await driver().listFiles(options.prefix || '', offset, limit);
        return { paths: files.map((f) => f.path), nextToken: more ? String(offset + limit) : undefined };
    },
    async size(path: string): Promise<number | null> {
        const { files } = await driver().listFiles(path, 0, 5);
        const hit = files.find((f) => f.path === path);
        return hit ? hit.size : null;
    },
    // A link the browser can send a file to directly (faster than sending it through the server).
    async uploadUrl(path: string): Promise<string | null> {
        return driver().uploadUrl(path);
    },
    async move(from: string, to: string): Promise<boolean> {
        return driver().moveFile(from, to);
    },
};

// ---------- matching people to their accounts ----------
// Accounts moved from the old site keep their old ids. After a restore, rebuildUserIds() records which
// email belongs to which old id, so teachers and principals find their accounts when they sign in.

const uidCache = new Map<string, { at: number; id: string }>();

function uidKey(email: string): string {
    return 'e' + sha256(email.trim().toLowerCase()).slice(0, 32);
}

async function userIdFor(email: string): Promise<string> {
    const clean = email.trim().toLowerCase();
    const hit = uidCache.get(clean);
    if (hit && Date.now() - hit.at < 60 * 1000) {
        return hit.id;
    }
    const [m] = await db.get<{ userId: string }>('user_ids', [uidKey(clean)]);
    const id = m && m.userId ? m.userId : userIdForEmail(clean);
    if (uidCache.size > 2000) {
        uidCache.clear();
    }
    uidCache.set(clean, { at: Date.now(), id });
    return id;
}

async function listAll<T>(tbl: string): Promise<(T & { id: string })[]> {
    const out: (T & { id: string })[] = [];
    let nextToken: string | undefined;
    for (let i = 0; i < 200; i++) {
        const page = await db.list<T>(tbl, { limit: 1000, nextToken });
        out.push(...page.items);
        if (!page.nextToken) {
            break;
        }
        nextToken = page.nextToken;
    }
    return out;
}

export async function rebuildUserIds(): Promise<number> {
    const old = await listAll<Rec>('user_ids');
    for (let i = 0; i < old.length; i += 200) {
        await db.tx.delete(
            'user_ids',
            old.slice(i, i + 200).map((r) => r.id)
        );
    }
    const pairs = new Map<string, string>();
    const teachers = await listAll<{ email?: string; userId?: string }>('teachers');
    teachers.forEach((t) => {
        const email = String(t.email || '').trim().toLowerCase();
        const id = String(t.userId || t.id || '');
        if (email && id) {
            pairs.set(email, id);
        }
    });
    const schools = await listAll<{ principalEmail?: string; principalUserId?: string }>('schools');
    schools.forEach((s) => {
        const email = String(s.principalEmail || '').trim().toLowerCase();
        const id = String(s.principalUserId || '');
        if (email && id) {
            pairs.set(email, id);
        }
    });
    const items = [...pairs.entries()]
        .filter(([email, id]) => id !== userIdForEmail(email))
        .map(([email, id]) => ({ id: uidKey(email), record: { userId: id, email } }));
    for (let i = 0; i < items.length; i += 200) {
        await db.tx.update('user_ids', items.slice(i, i + 200));
    }
    uidCache.clear();
    return items.length;
}

// ---------- phone alerts (web push) ----------

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const [saved] = await db.get<{ publicKey: string; privateKey: string }>('meta', ['vapid']);
    if (saved) {
        return saved;
    }
    const keys = webpush.generateVAPIDKeys();
    await db.tx.add('meta', [{ id: 'vapid', ...keys }]);
    const [stored] = await db.get<{ publicKey: string; privateKey: string }>('meta', ['vapid']);
    return stored ?? keys;
}

function subId(endpoint: string): string {
    return sha256(endpoint).slice(0, 32);
}

export const notifications = {
    async send(params: { userIds: string[]; notification?: { title: string; body: string; url?: string }; data?: Record<string, string>; ttlSeconds?: number }) {
        const n = params.notification;
        if (!n) {
            return { sent: 0, failed: 0 };
        }
        if (isLocal()) {
            console.log('[phone alert] ' + n.title + ' | ' + n.body);
            return { sent: 0, failed: 0 };
        }
        const keys = await vapidKeys();
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:linusomwoyo948@gmail.com', keys.publicKey, keys.privateKey);
        const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/' });
        let sent = 0;
        let failed = 0;
        for (const uid of params.userIds) {
            const subs = await db.list<{ sub: webpush.PushSubscription }>('push_' + uid, { limit: 20 });
            for (const s of subs.items) {
                try {
                    await webpush.sendNotification(s.sub, payload, { TTL: params.ttlSeconds ?? 86400 });
                    sent++;
                } catch (e) {
                    failed++;
                    const status = (e as { statusCode?: number }).statusCode;
                    if (status === 404 || status === 410) {
                        await db.delete('push_' + uid, [s.id]);
                    }
                }
            }
        }
        return { sent, failed };
    },
};

// ---------- router ----------

export type AuthUser = { userId: string; email?: string; name?: string; scope: string };

export type LocalEvent = {
    method: string;
    rawPath: string;
    headers: Record<string, string | undefined>;
    query: Record<string, string>;
    body: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [extra: string]: any;
};

export type RouterContext = {
    body: unknown;
    query: Record<string, string>;
    params: Record<string, string>;
    event: LocalEvent;
    user?: AuthUser;
};

export type RouterResponse = { statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded?: boolean };
export type RouterMiddleware = (ctx: RouterContext) => Promise<RouterResponse | void | undefined> | RouterResponse | void | undefined;
export type RouterRoutes = Record<string, RouterMiddleware[]>;

export function json(data: unknown, status = 200): RouterResponse {
    return { statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(data) };
}

export function error(message: string, status = 400): RouterResponse {
    return json({ error: message }, status);
}

export function requireAuth(): RouterMiddleware {
    return async (ctx) => {
        const h = ctx.event.headers.authorization || '';
        const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
        const found = token ? await driver().verifyToken(token) : null;
        if (!found) {
            return error('Please sign in.', 401);
        }
        ctx.user = { userId: await userIdFor(found.email), email: found.email, name: found.name, scope: 'openid email profile' };
        return undefined;
    };
}

// Routes every page needs for phone alerts, added to the app's own routes.
const builtInRoutes: RouterRoutes = {
    'GET /api/push/key': [requireAuth(), async () => json({ publicKey: (await vapidKeys()).publicKey })],
    'POST /api/push/subscribe': [
        requireAuth(),
        async (ctx) => {
            const sub = ((ctx.body ?? {}) as Rec).subscription as { endpoint?: string; keys?: Rec } | undefined;
            if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) {
                return error('Invalid subscription.', 400);
            }
            await db.tx.update('push_' + ctx.user!.userId, [{ id: subId(sub.endpoint), record: { sub, at: Date.now() } }]);
            return json({ ok: true });
        },
    ],
    'POST /api/push/unsubscribe': [
        requireAuth(),
        async (ctx) => {
            const endpoint = String(((ctx.body ?? {}) as Rec).endpoint || '');
            if (endpoint) {
                await db.delete('push_' + ctx.user!.userId, [subId(endpoint)]);
            }
            return json({ ok: true });
        },
    ],
    // Shows whether the server is connected to Supabase (yes/no answers only, never keys).
    'GET /api/_setup-check': [
        async () => {
            try {
                return json(await setupCheck());
            } catch (e) {
                return json({ result: 'ERROR: ' + (e instanceof Error ? e.message : String(e)) }, 500);
            }
        },
    ],
    // Local testing only: serves stored files (the live site uses signed Supabase links instead).
    'GET /api/_local/file': [
        async (ctx) => {
            if (!isLocal()) {
                return error('Not found', 404);
            }
            const path = String(ctx.query.path || '');
            const b = path ? await driver().getFile(path) : null;
            if (!b) {
                return error('Not found', 404);
            }
            return { statusCode: 200, headers: { 'content-type': 'application/octet-stream' }, body: b.toString('base64'), isBase64Encoded: true };
        },
    ],
};

export function router(routes: RouterRoutes) {
    const compiled = Object.entries({ ...builtInRoutes, ...routes }).map(([key, chain]) => {
        const [method, pattern] = key.split(' ');
        const names: string[] = [];
        const re = new RegExp(
            '^' +
                pattern.replace(/:([A-Za-z_]+)/g, (_m, n: string) => {
                    names.push(n);
                    return '([^/]+)';
                }) +
                '$'
        );
        return { method, re, names, chain };
    });

    return async (event: LocalEvent): Promise<RouterResponse> => {
        for (const r of compiled) {
            if (r.method !== event.method) {
                continue;
            }
            const m = event.rawPath.match(r.re);
            if (!m) {
                continue;
            }
            const params: Record<string, string> = {};
            r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
            const ctx: RouterContext = { body: event.body, query: event.query, params, event };
            try {
                for (const mw of r.chain) {
                    const res = await mw(ctx);
                    if (res) {
                        return res;
                    }
                }
                return error('No response', 500);
            } catch (e) {
                console.error(e);
                if (e instanceof Error && e.message === SETTINGS_MISSING) {
                    return error('The server is not connected to its database yet. The site owner needs to finish the setup (open /api/_setup-check).', 503);
                }
                return error('Something went wrong on the server. Please try again.', 500);
            }
        }
        return error('Not found', 404);
    };
}
