create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  currency text not null default 'IDR',
  timezone text not null default 'Asia/Jakarta',
  ai_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  opening_balance numeric(14,0) not null default 0 check (opening_balance >= 0),
  currency text not null default 'IDR',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  type text not null check (type in ('income', 'expense')),
  color text not null default '#63836f',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer')),
  amount numeric(14,0) not null check (amount > 0),
  occurred_on date not null,
  description text not null check (length(trim(description)) between 1 and 160),
  account_id uuid not null,
  category_id uuid,
  destination_account_id uuid,
  note text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts(user_id, id),
  foreign key (user_id, destination_account_id) references public.accounts(user_id, id),
  foreign key (user_id, category_id) references public.categories(user_id, id),
  check (
    (type = 'transfer' and category_id is null and destination_account_id is not null and account_id <> destination_account_id)
    or
    (type in ('income', 'expense') and destination_account_id is null and category_id is not null)
  )
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount numeric(14,0) not null check (amount > 0),
  warning_percent integer not null default 80 check (warning_percent between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month),
  foreign key (user_id, category_id) references public.categories(user_id, id)
);

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,0) not null check (amount > 0),
  description text not null check (length(trim(description)) between 1 and 160),
  account_id uuid not null,
  category_id uuid,
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  next_due date not null,
  ends_on date,
  auto_record boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (user_id, account_id) references public.accounts(user_id, id),
  foreign key (user_id, category_id) references public.categories(user_id, id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  target_amount numeric(14,0) not null check (target_amount > 0),
  due_date date,
  icon text not null default 'target',
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.goal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  type text not null check (type in ('contribution', 'withdrawal')),
  amount numeric(14,0) not null check (amount > 0),
  occurred_on date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);

create or replace function public.validate_transaction_relations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_archived boolean;
  destination_archived boolean;
  category_type text;
  category_archived boolean;
begin
  select archived into source_archived
    from public.accounts where id = new.account_id and user_id = new.user_id;
  if source_archived is null or source_archived then
    raise exception 'Akun sumber tidak ditemukan atau telah diarsipkan.';
  end if;

  if new.type = 'transfer' then
    select archived into destination_archived
      from public.accounts where id = new.destination_account_id and user_id = new.user_id;
    if destination_archived is null or destination_archived then
      raise exception 'Akun tujuan tidak ditemukan atau telah diarsipkan.';
    end if;
  elsif new.category_id is not null then
    select type, archived into category_type, category_archived
      from public.categories where id = new.category_id and user_id = new.user_id;
    if category_type is null or category_archived or category_type <> new.type then
      raise exception 'Kategori tidak ditemukan, telah diarsipkan, atau jenisnya tidak sesuai.';
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_validate_relations
  before insert or update on public.transactions
  for each row execute function public.validate_transaction_relations();

create index transactions_user_date_idx on public.transactions(user_id, occurred_on desc);
create index budgets_user_month_idx on public.budgets(user_id, month);
create index goal_entries_user_goal_idx on public.goal_entries(user_id, goal_id, occurred_on);

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();
create trigger budgets_updated_at before update on public.budgets for each row execute function public.set_updated_at();
create trigger goals_updated_at before update on public.goals for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.goals enable row level security;
alter table public.goal_entries enable row level security;

create policy "profiles are private to owner" on public.profiles for all using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "accounts are private to owner" on public.accounts for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "categories are private to owner" on public.categories for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "transactions are private to owner" on public.transactions for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "budgets are private to owner" on public.budgets for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "recurring rules are private to owner" on public.recurring_rules for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "goals are private to owner" on public.goals for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "goal entries are private to owner" on public.goal_entries for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.accounts, public.categories, public.transactions, public.budgets, public.recurring_rules, public.goals, public.goal_entries to authenticated;
