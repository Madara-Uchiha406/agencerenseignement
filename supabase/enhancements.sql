-- Run once in Supabase SQL Editor on the existing project after schema.sql and chat.sql are installed.
-- Idempotent migration for dossier archiving, private chat attachments and Realtime.

alter table public.dossiers
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

create index if not exists dossiers_archived_level_idx
  on public.dossiers (archived_at, niveau, created_at desc);

drop policy if exists "Public can read non-classified dossiers" on public.dossiers;
create policy "Public can read non-classified dossiers"
on public.dossiers for select to anon, authenticated
using (
  niveau <= case
    when (select auth.uid()) is null then 1
    when (select public.agent_is_active()) then coalesce((select public.current_agent_level()), 0)
    when (select auth.jwt() ->> 'is_anonymous') = 'true' then 1
    else 0
  end
  and (
    archived_at is null
    or (
      (select public.agent_is_active())
      and coalesce((select public.current_agent_level()), 0) >= 4
    )
  )
);

alter table public.chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists attachment_size integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_attachment_metadata_check'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_attachment_metadata_check
      check (
        (attachment_path is null and attachment_name is null and attachment_type is null and attachment_size is null)
        or (
          attachment_path is not null
          and attachment_name is not null
          and char_length(attachment_name) between 1 and 255
          and attachment_type is not null
          and attachment_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
          and attachment_size is not null
          and attachment_size between 1 and 10485760
          and attachment_path like conversation_id::text || '/%'
        )
      );
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Chat participants can read attachments" on storage.objects;
create policy "Chat participants can read attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.can_read_chat(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (storage.foldername(name))[1]::uuid
      else null
    end
  )
);

drop policy if exists "Chat participants can upload attachments" on storage.objects;
create policy "Chat participants can upload attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.can_read_chat(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (storage.foldername(name))[1]::uuid
      else null
    end
  )
);

drop policy if exists "Level five agents can delete chats" on public.chat_conversations;
create policy "Level five agents can delete chats"
on public.chat_conversations for delete to authenticated
using (
  (select public.agent_is_active())
  and coalesce((select public.current_agent_level()), 0) >= 5
);
grant delete on public.chat_conversations to authenticated;

create or replace function public.delete_chat_attachment_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.attachment_path is not null then
    delete from storage.objects
    where bucket_id = 'chat-attachments'
      and name = old.attachment_path;
  end if;
  return old;
end;
$$;

drop trigger if exists chat_message_delete_attachment on public.chat_messages;
create trigger chat_message_delete_attachment
after delete on public.chat_messages
for each row execute function public.delete_chat_attachment_object();

revoke all on function public.delete_chat_attachment_object() from public, anon, authenticated;

create or replace function public.audit_dossier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email_value text;
  target_id_value text;
  old_values jsonb;
  new_values jsonb;
begin
  select p.email into actor_email_value
  from public.agent_profiles as p
  where p.id = (select auth.uid());

  if tg_op = 'INSERT' then
    target_id_value := new.id::text;
    new_values := jsonb_build_object('code', new.code, 'niveau', new.niveau, 'statut', new.statut, 'subject_added', true);
  elsif tg_op = 'UPDATE' then
    if old.archived_at is distinct from new.archived_at then
      return new;
    end if;
    target_id_value := new.id::text;
    old_values := jsonb_build_object('code', old.code, 'niveau', old.niveau, 'statut', old.statut);
    new_values := jsonb_build_object(
      'code', new.code,
      'niveau', new.niveau,
      'statut', new.statut,
      'subject_changed', old.sujet is distinct from new.sujet
    );
  else
    target_id_value := old.id::text;
    old_values := jsonb_build_object('code', old.code, 'niveau', old.niveau, 'statut', old.statut, 'subject_removed', true);
  end if;

  insert into public.activity_logs (actor_id, actor_email, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    coalesce(actor_email_value, 'system'),
    lower(tg_op) || '_dossier',
    'dossier',
    target_id_value,
    jsonb_strip_nulls(jsonb_build_object('before', old_values, 'after', new_values))
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.audit_dossier_archive_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_email_value text;
begin
  if old.archived_at is not distinct from new.archived_at then
    return new;
  end if;

  select p.email into actor_email_value
  from public.agent_profiles as p
  where p.id = (select auth.uid());

  insert into public.activity_logs (actor_id, actor_email, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    coalesce(actor_email_value, 'system'),
    case when new.archived_at is null then 'restore_dossier' else 'archive_dossier' end,
    'dossier',
    new.id::text,
    jsonb_build_object('code', new.code, 'archived_at', new.archived_at)
  );
  return new;
end;
$$;

drop trigger if exists dossiers_archive_audit on public.dossiers;
create trigger dossiers_archive_audit
after update of archived_at on public.dossiers
for each row execute function public.audit_dossier_archive_change();
revoke all on function public.audit_dossier_archive_change() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dossiers'
    ) then
      alter publication supabase_realtime add table public.dossiers;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
    ) then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  end if;
end
$$;
