-- Listening Lab v2.0 backend foundation
-- Target: Supabase / PostgreSQL
-- Scope: accounts, teacher-student links, content catalog, assignments,
-- sessions, question attempts/responses, material lab, vocabulary, dictionary.
-- This migration intentionally does NOT add classes, billing, or analytics aggregates.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utility
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student'
    check (role in ('student', 'teacher')),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- New self-signups default to student.
-- Teacher promotion should be performed by trusted backend/admin logic later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, role, display_name)
  values (
    new.id,
    'student',
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.teacher_students (
  teacher_id uuid not null references public.profiles(user_id) on delete cascade,
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'active'
    check (status in ('pending', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  primary key (teacher_id, student_id),
  check (teacher_id <> student_id)
);

-- ---------------------------------------------------------------------------
-- Content catalog
-- Mirrors the existing Practice Pack -> Module -> Material -> Question model.
-- ---------------------------------------------------------------------------

create table if not exists public.practice_packs (
  id uuid primary key default gen_random_uuid(),
  set_id text not null unique,
  title text not null default '',
  schema_version text not null default '1',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger practice_packs_set_updated_at
before update on public.practice_packs
for each row execute function public.set_updated_at();

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.practice_packs(id) on delete cascade,
  module_code text not null,
  audio_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (pack_id, module_code)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  material_code text not null,
  material_type text not null
    check (material_type in ('best_response', 'conversation', 'announcement', 'academic_talk')),
  listen_start double precision,
  listen_end double precision,
  transcript text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (module_id, material_code),
  check (
    listen_start is null
    or listen_end is null
    or listen_end >= listen_start
  )
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  question_code text not null,
  question_number integer not null,
  stem text not null default '',
  options jsonb not null default '[]'::jsonb,
  timer_sec integer not null default 20 check (timer_sec > 0),
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (material_id, question_code)
);

-- Correct answers are deliberately isolated from student-readable question data.
create table if not exists public.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_answer text not null,
  explanation text,
  official_evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create trigger question_keys_set_updated_at
before update on public.question_keys
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(user_id) on delete cascade,
  pack_id uuid not null references public.practice_packs(id) on delete restrict,
  mode text not null default 'assignment',
  settings jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'assigned', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assignments_set_updated_at
before update on public.assignments
for each row execute function public.set_updated_at();

create table if not exists public.assignment_students (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'assigned'
    check (status in ('assigned', 'started', 'completed', 'late', 'excused')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (assignment_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Sessions and question records
-- ---------------------------------------------------------------------------

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  pack_id uuid not null references public.practice_packs(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete set null,
  mode text not null,
  route text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'paused', 'completed', 'abandoned')),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

create table if not exists public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  confidence text,
  error_reasons jsonb not null default '[]'::jsonb,
  analysis_skipped boolean not null default false,
  resolution_stage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, question_id)
);

create trigger question_attempts_set_updated_at
before update on public.question_attempts
for each row execute function public.set_updated_at();

-- A single QUESTION_ATTEMPT can have multiple answer stages:
-- first / second / post_transcript.
create table if not exists public.question_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.question_attempts(id) on delete cascade,
  stage text not null
    check (stage in ('first', 'second', 'post_transcript')),
  answer text,
  time_limit_sec integer check (time_limit_sec is null or time_limit_sec > 0),
  time_used_ms integer check (time_used_ms is null or time_used_ms >= 0),
  submit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, stage)
);

create trigger question_responses_set_updated_at
before update on public.question_responses
for each row execute function public.set_updated_at();

create table if not exists public.evidence_marks (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.question_attempts(id) on delete cascade,
  stage text not null default 'second',
  point_sec double precision,
  start_sec double precision,
  end_sec double precision,
  note text,
  created_at timestamptz not null default now(),
  check (
    point_sec is not null
    or start_sec is not null
    or end_sec is not null
  ),
  check (
    start_sec is null
    or end_sec is null
    or end_sec >= start_sec
  )
);

-- Immutable-ish event stream used for timing, playback and mock-exam diagnostics.
create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  event_type text not null,
  material_id uuid references public.materials(id) on delete set null,
  question_id uuid references public.questions(id) on delete set null,
  audio_sec double precision,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Single Material Lab
-- Shared shell for Academic Talk now; Conversation/Announcement can reuse later.
-- ---------------------------------------------------------------------------

create table if not exists public.material_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  analyzer_type text not null,
  comprehension_before jsonb not null default '{}'::jsonb,
  comprehension_after jsonb not null default '{}'::jsonb,
  direct_transcript_skip boolean not null default false,
  post_unchanged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, material_id)
);

create trigger material_lab_sessions_set_updated_at
before update on public.material_lab_sessions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Dictionary and student vocabulary
-- ---------------------------------------------------------------------------

create table if not exists public.vocab_items (
  id uuid primary key default gen_random_uuid(),
  lemma text not null,
  display_text text not null,
  part_of_speech text,
  created_at timestamptz not null default now()
);

create index if not exists vocab_items_lemma_lower_idx
on public.vocab_items (lower(lemma));

create table if not exists public.dictionary_entries (
  id uuid primary key default gen_random_uuid(),
  vocab_id uuid not null references public.vocab_items(id) on delete cascade,
  language text not null default 'zh-CN',
  sense_key text not null default 'default',
  definition text not null,
  example text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vocab_id, language, sense_key)
);

create trigger dictionary_entries_set_updated_at
before update on public.dictionary_entries
for each row execute function public.set_updated_at();

create table if not exists public.vocab_occurrences (
  id uuid primary key default gen_random_uuid(),
  vocab_id uuid not null references public.vocab_items(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  start_sec double precision,
  end_sec double precision,
  context text,
  created_at timestamptz not null default now(),
  check (
    start_sec is null
    or end_sec is null
    or end_sec >= start_sec
  )
);

create table if not exists public.vocab_mark_events (
  id uuid primary key default gen_random_uuid(),
  material_lab_session_id uuid not null references public.material_lab_sessions(id) on delete cascade,
  vocab_id uuid references public.vocab_items(id) on delete set null,
  start_sec double precision,
  end_sec double precision,
  heard_text text,
  actual_text text,
  issue_type text,
  note text,
  created_at timestamptz not null default now(),
  check (
    start_sec is null
    or end_sec is null
    or end_sec >= start_sec
  )
);

create table if not exists public.student_vocab (
  student_id uuid not null references public.profiles(user_id) on delete cascade,
  vocab_id uuid not null references public.vocab_items(id) on delete cascade,
  status text not null default 'learning'
    check (status in ('new', 'learning', 'review', 'mastered', 'ignored')),
  dominant_issue_type text,
  times_seen integer not null default 1 check (times_seen >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  note text,
  primary key (student_id, vocab_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists teacher_students_student_idx
on public.teacher_students (student_id);

create index if not exists modules_pack_idx
on public.modules (pack_id);

create index if not exists materials_module_idx
on public.materials (module_id);

create index if not exists questions_material_idx
on public.questions (material_id);

create index if not exists assignments_teacher_idx
on public.assignments (teacher_id);

create index if not exists assignment_students_student_idx
on public.assignment_students (student_id);

create index if not exists sessions_student_started_idx
on public.sessions (student_id, started_at desc);

create index if not exists sessions_assignment_idx
on public.sessions (assignment_id);

create index if not exists question_attempts_session_idx
on public.question_attempts (session_id);

create index if not exists question_responses_attempt_idx
on public.question_responses (attempt_id);

create index if not exists evidence_marks_attempt_idx
on public.evidence_marks (attempt_id);

create index if not exists session_events_session_created_idx
on public.session_events (session_id, created_at);

create index if not exists material_lab_sessions_session_idx
on public.material_lab_sessions (session_id);

create index if not exists vocab_occurrences_material_idx
on public.vocab_occurrences (material_id);

create index if not exists student_vocab_student_status_idx
on public.student_vocab (student_id, status);

-- ---------------------------------------------------------------------------
-- Authorization helper functions
-- ---------------------------------------------------------------------------

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'teacher'
  );
$$;

create or replace function public.teacher_can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_students ts
    where ts.teacher_id = auth.uid()
      and ts.student_id = target_student_id
      and ts.status = 'active'
  );
$$;

create or replace function public.owns_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = target_session_id
      and s.student_id = auth.uid()
  );
$$;

create or replace function public.teacher_can_access_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = target_session_id
      and public.teacher_can_access_student(s.student_id)
  );
$$;

create or replace function public.owns_attempt(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.question_attempts qa
    join public.sessions s on s.id = qa.session_id
    where qa.id = target_attempt_id
      and s.student_id = auth.uid()
  );
$$;

create or replace function public.teacher_can_access_attempt(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.question_attempts qa
    join public.sessions s on s.id = qa.session_id
    where qa.id = target_attempt_id
      and public.teacher_can_access_student(s.student_id)
  );
$$;

create or replace function public.owns_material_lab(target_material_lab_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.material_lab_sessions ml
    join public.sessions s on s.id = ml.session_id
    where ml.id = target_material_lab_id
      and s.student_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.teacher_students enable row level security;
alter table public.practice_packs enable row level security;
alter table public.modules enable row level security;
alter table public.materials enable row level security;
alter table public.questions enable row level security;
alter table public.question_keys enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_students enable row level security;
alter table public.sessions enable row level security;
alter table public.question_attempts enable row level security;
alter table public.question_responses enable row level security;
alter table public.evidence_marks enable row level security;
alter table public.session_events enable row level security;
alter table public.material_lab_sessions enable row level security;
alter table public.vocab_items enable row level security;
alter table public.dictionary_entries enable row level security;
alter table public.vocab_occurrences enable row level security;
alter table public.vocab_mark_events enable row level security;
alter table public.student_vocab enable row level security;

-- Profiles: users see themselves; teachers can also see linked students.
create policy profiles_select_self_or_linked
on public.profiles for select
to authenticated
using (
  user_id = auth.uid()
  or public.teacher_can_access_student(user_id)
);

-- Teacher/student relationship creation is intentionally service-managed for now.
create policy teacher_students_select_participant
on public.teacher_students for select
to authenticated
using (
  teacher_id = auth.uid()
  or student_id = auth.uid()
);

-- Published content is readable by authenticated users.
create policy practice_packs_select_authenticated
on public.practice_packs for select
to authenticated
using (status = 'published' or public.is_teacher());

create policy modules_select_authenticated
on public.modules for select
to authenticated
using (true);

create policy materials_select_authenticated
on public.materials for select
to authenticated
using (true);

create policy questions_select_authenticated
on public.questions for select
to authenticated
using (true);

-- Students must never receive answer keys directly.
create policy question_keys_select_teacher
on public.question_keys for select
to authenticated
using (public.is_teacher());

-- Assignments.
create policy assignments_teacher_all
on public.assignments for all
to authenticated
using (teacher_id = auth.uid() and public.is_teacher())
with check (teacher_id = auth.uid() and public.is_teacher());

create policy assignments_student_select
on public.assignments for select
to authenticated
using (
  exists (
    select 1
    from public.assignment_students ast
    where ast.assignment_id = assignments.id
      and ast.student_id = auth.uid()
  )
);

create policy assignment_students_teacher_all
on public.assignment_students for all
to authenticated
using (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_students.assignment_id
      and a.teacher_id = auth.uid()
      and public.is_teacher()
  )
)
with check (
  exists (
    select 1
    from public.assignments a
    where a.id = assignment_students.assignment_id
      and a.teacher_id = auth.uid()
      and public.is_teacher()
  )
);

create policy assignment_students_student_select
on public.assignment_students for select
to authenticated
using (student_id = auth.uid());

-- Sessions.
create policy sessions_student_select
on public.sessions for select
to authenticated
using (student_id = auth.uid());

create policy sessions_student_insert
on public.sessions for insert
to authenticated
with check (student_id = auth.uid());

create policy sessions_student_update
on public.sessions for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create policy sessions_teacher_select
on public.sessions for select
to authenticated
using (public.teacher_can_access_student(student_id));

-- Question attempts.
create policy question_attempts_student_select
on public.question_attempts for select
to authenticated
using (public.owns_session(session_id));

create policy question_attempts_student_insert
on public.question_attempts for insert
to authenticated
with check (public.owns_session(session_id));

create policy question_attempts_student_update
on public.question_attempts for update
to authenticated
using (public.owns_session(session_id))
with check (public.owns_session(session_id));

create policy question_attempts_teacher_select
on public.question_attempts for select
to authenticated
using (public.teacher_can_access_session(session_id));

-- Responses.
create policy question_responses_student_select
on public.question_responses for select
to authenticated
using (public.owns_attempt(attempt_id));

create policy question_responses_student_insert
on public.question_responses for insert
to authenticated
with check (public.owns_attempt(attempt_id));

create policy question_responses_student_update
on public.question_responses for update
to authenticated
using (public.owns_attempt(attempt_id))
with check (public.owns_attempt(attempt_id));

create policy question_responses_teacher_select
on public.question_responses for select
to authenticated
using (public.teacher_can_access_attempt(attempt_id));

-- Evidence.
create policy evidence_marks_student_all
on public.evidence_marks for all
to authenticated
using (public.owns_attempt(attempt_id))
with check (public.owns_attempt(attempt_id));

create policy evidence_marks_teacher_select
on public.evidence_marks for select
to authenticated
using (public.teacher_can_access_attempt(attempt_id));

-- Session events: students can append/read their own; teachers can read linked.
create policy session_events_student_select
on public.session_events for select
to authenticated
using (public.owns_session(session_id));

create policy session_events_student_insert
on public.session_events for insert
to authenticated
with check (public.owns_session(session_id));

create policy session_events_teacher_select
on public.session_events for select
to authenticated
using (public.teacher_can_access_session(session_id));

-- Material lab.
create policy material_lab_sessions_student_all
on public.material_lab_sessions for all
to authenticated
using (public.owns_session(session_id))
with check (public.owns_session(session_id));

create policy material_lab_sessions_teacher_select
on public.material_lab_sessions for select
to authenticated
using (public.teacher_can_access_session(session_id));

-- Dictionary base data can be read by authenticated users.
create policy vocab_items_select_authenticated
on public.vocab_items for select
to authenticated
using (true);

create policy dictionary_entries_select_authenticated
on public.dictionary_entries for select
to authenticated
using (true);

create policy vocab_occurrences_select_authenticated
on public.vocab_occurrences for select
to authenticated
using (true);

-- Vocabulary marks produced inside a material lab.
create policy vocab_mark_events_student_all
on public.vocab_mark_events for all
to authenticated
using (public.owns_material_lab(material_lab_session_id))
with check (public.owns_material_lab(material_lab_session_id));

-- Personal vocabulary book.
create policy student_vocab_student_select
on public.student_vocab for select
to authenticated
using (student_id = auth.uid());

create policy student_vocab_student_insert
on public.student_vocab for insert
to authenticated
with check (student_id = auth.uid());

create policy student_vocab_student_update
on public.student_vocab for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create policy student_vocab_student_delete
on public.student_vocab for delete
to authenticated
using (student_id = auth.uid());

create policy student_vocab_teacher_select
on public.student_vocab for select
to authenticated
using (public.teacher_can_access_student(student_id));

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
-- 1. Content writes and question key writes are intentionally service-managed.
-- 2. teacher_students writes are intentionally service-managed until the invite/link flow exists.
-- 3. Student-visible scoring should be implemented through a trusted RPC/server path;
--    do not expose question_keys to student clients.
-- 4. localStorage remains the offline cache; these tables become the cloud source of truth.
