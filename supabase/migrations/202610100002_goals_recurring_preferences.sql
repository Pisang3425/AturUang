alter table public.recurring_rules
  alter column category_id set not null;

alter table public.recurring_rules
  add constraint recurring_rules_frequency_dates_check
  check (ends_on is null or ends_on >= next_due);

alter table public.profiles
  add column reminders_enabled boolean not null default true,
  add column onboarding_complete boolean not null default false;

create table public.account_balance_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  old_balance numeric(14,0) not null,
  new_balance numeric(14,0) not null,
  changed_at timestamptz not null default now(),
  foreign key (user_id, account_id) references public.accounts(user_id, id) on delete cascade
);

create index account_balance_changes_user_account_idx
  on public.account_balance_changes(user_id, account_id, changed_at desc);

alter table public.account_balance_changes enable row level security;

create policy "account balance history is private to owner"
  on public.account_balance_changes for select
  using (user_id = (select auth.uid()));

grant select on public.account_balance_changes to authenticated;

create or replace function public.audit_account_opening_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.opening_balance is distinct from new.opening_balance then
    insert into public.account_balance_changes (user_id, account_id, old_balance, new_balance)
    values (new.user_id, new.id, old.opening_balance, new.opening_balance);
  end if;
  return new;
end;
$$;

create trigger account_opening_balance_audit
  after update of opening_balance on public.accounts
  for each row execute function public.audit_account_opening_balance();

create index recurring_rules_user_due_idx
  on public.recurring_rules(user_id, next_due)
  where active = true;

create index goals_user_status_idx
  on public.goals(user_id, status);

create or replace function public.validate_recurring_relations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_archived boolean;
  category_archived boolean;
  category_type text;
begin
  select archived into account_archived
    from public.accounts where id = new.account_id and user_id = new.user_id;
  if account_archived is null or account_archived then
    raise exception 'Akun tidak ditemukan atau telah diarsipkan.';
  end if;
  select archived, type into category_archived, category_type
    from public.categories where id = new.category_id and user_id = new.user_id;
  if category_archived is null or category_archived or category_type <> new.type then
    raise exception 'Kategori tidak ditemukan, diarsipkan, atau jenisnya tidak sesuai.';
  end if;
  return new;
end;
$$;

create trigger recurring_rules_validate_relations
  before insert or update on public.recurring_rules
  for each row execute function public.validate_recurring_relations();

alter table public.recurring_rules enable row level security;
alter table public.goals enable row level security;
alter table public.goal_entries enable row level security;

drop policy if exists "goal entries are private to owner" on public.goal_entries;

create policy "goal entries are private to owner"
  on public.goal_entries for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.goals
      where goals.id = goal_entries.goal_id
        and goals.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.recurring_rules, public.goals, public.goal_entries to authenticated;
