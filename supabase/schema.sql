-- Holiday Learning Portal database and file storage setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run. Running it again is safe.

-- One private table holds all records. Each record belongs to a named collection (tbl) and has an id.
create table if not exists public.kv (
    tbl text not null,
    id text not null,
    data jsonb not null default '{}'::jsonb,
    primary key (tbl, id)
);

-- Row level security with no policies: browsers can never read or write this table directly.
-- Only the site's server functions (using the secret key) can.
alter table public.kv enable row level security;
revoke all on table public.kv from anon, authenticated;

-- Applies a list of writes. When atomic is true, all writes succeed together or none are kept.
-- ops: [{ "kind": "add" | "update" | "delete", "tbl": "...", "patch": true|false, "items": [...] }]
--   add items:    { "id": "...", "record": {...} }               -> id, or null if it already exists
--   update items: { "id": "...", "record": {...}, "if": {...} }  -> true, or false if missing (patch) or condition fails
--   delete items: { "id": "..." }                                -> true if it existed
-- Special values inside record: {"$inc": n} adds n, {"$unset": true} removes the field.
-- Special value inside if: {"$absent": true} requires the field to be missing.
create or replace function public.kv_apply(ops jsonb, atomic boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    op jsonb;
    it jsonb;
    results jsonb := '[]'::jsonb;
    r jsonb;
    cur jsonb;
    ok boolean;
    k text;
    v jsonb;
    newdata jsonb;
    is_patch boolean;
    n integer;
begin
    for op in select * from jsonb_array_elements(ops) loop
        r := '[]'::jsonb;
        is_patch := coalesce((op->>'patch')::boolean, false);

        if op->>'kind' = 'add' then
            for it in select * from jsonb_array_elements(op->'items') loop
                insert into kv (tbl, id, data)
                values (op->>'tbl', it->>'id', coalesce(it->'record', '{}'::jsonb))
                on conflict do nothing;
                get diagnostics n = row_count;
                if n > 0 then
                    r := r || to_jsonb(it->>'id');
                else
                    if atomic then
                        raise exception 'KV_DUPLICATE:%:%', op->>'tbl', it->>'id';
                    end if;
                    r := r || 'null'::jsonb;
                end if;
            end loop;

        elsif op->>'kind' = 'update' then
            for it in select * from jsonb_array_elements(op->'items') loop
                select data into cur from kv where tbl = op->>'tbl' and id = it->>'id' for update;
                ok := not (is_patch and cur is null);
                if ok and it ? 'if' and jsonb_typeof(it->'if') = 'object' then
                    for k, v in select * from jsonb_each(it->'if') loop
                        if v = '{"$absent": true}'::jsonb then
                            if cur is not null and cur ? k then
                                ok := false;
                            end if;
                        elsif cur is null or not (cur ? k) or (cur->k) <> v then
                            ok := false;
                        end if;
                    end loop;
                end if;
                if not ok then
                    if atomic then
                        raise exception 'KV_CONDITION:%:%', op->>'tbl', it->>'id';
                    end if;
                    r := r || 'false'::jsonb;
                    continue;
                end if;
                newdata := case when is_patch then coalesce(cur, '{}'::jsonb) else '{}'::jsonb end;
                for k, v in select * from jsonb_each(coalesce(it->'record', '{}'::jsonb)) loop
                    if k = 'id' then
                        continue;
                    end if;
                    if jsonb_typeof(v) = 'object' and v ? '$inc' then
                        newdata := newdata || jsonb_build_object(
                            k,
                            coalesce(case when jsonb_typeof(newdata->k) = 'number' then (newdata->>k)::numeric end, 0) + (v->>'$inc')::numeric
                        );
                    elsif jsonb_typeof(v) = 'object' and v ? '$unset' then
                        newdata := newdata - k;
                    else
                        newdata := newdata || jsonb_build_object(k, v);
                    end if;
                end loop;
                insert into kv (tbl, id, data) values (op->>'tbl', it->>'id', newdata)
                on conflict (tbl, id) do update set data = excluded.data;
                r := r || 'true'::jsonb;
            end loop;

        elsif op->>'kind' = 'delete' then
            for it in select * from jsonb_array_elements(op->'items') loop
                delete from kv where tbl = op->>'tbl' and id = it->>'id';
                get diagnostics n = row_count;
                r := r || to_jsonb(n > 0);
            end loop;
        end if;

        results := results || jsonb_build_array(r);
    end loop;
    return results;
end;
$$;

-- Replaces everything with the contents of a backup: { "collection": [ {"id": "...", ...fields }, ... ], ... }
-- Only the server (secret key) may call these functions.
revoke execute on function public.kv_apply(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.kv_apply(jsonb, boolean) to service_role;
grant all on table public.kv to service_role;

-- Lists stored files whose path starts with a prefix (used to tidy up unfinished uploads and to check sizes).
create or replace function public.file_list(prefix text, off integer, lim integer)
returns table (name text, size bigint)
language sql
security definer
set search_path = public, storage
as $$
    select o.name, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
    where o.bucket_id = 'files' and o.name like replace(replace(prefix, '%', '\%'), '_', '\_') || '%'
    order by o.name
    offset off limit lim;
$$;
revoke execute on function public.file_list(text, integer, integer) from public, anon, authenticated;
grant execute on function public.file_list(text, integer, integer) to service_role;

-- Private storage for learning materials, assignments, students' work and backups (files up to 25 MB).
-- Browsers only reach files through short-lived links made by the server.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;
