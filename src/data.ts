import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Account, Budget, Category, FinanceData, Goal, GoalEntry, OpeningBalanceChange, RecurringRule, Transaction,
} from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export const isCloudMode = Boolean(supabase)

const storageKey = 'aturuang.local.v1'

export const defaultCategories: Category[] = [
  { id: crypto.randomUUID(), name: 'Makanan', type: 'expense', color: '#e9a06d', archived: false },
  { id: crypto.randomUUID(), name: 'Transportasi', type: 'expense', color: '#7ca8a1', archived: false },
  { id: crypto.randomUUID(), name: 'Tagihan', type: 'expense', color: '#aa8eb5', archived: false },
  { id: crypto.randomUUID(), name: 'Belanja', type: 'expense', color: '#d88888', archived: false },
  { id: crypto.randomUUID(), name: 'Kesehatan', type: 'expense', color: '#8daa75', archived: false },
  { id: crypto.randomUUID(), name: 'Hiburan', type: 'expense', color: '#d5b35b', archived: false },
  { id: crypto.randomUUID(), name: 'Lainnya', type: 'expense', color: '#98a0a0', archived: false },
  { id: crypto.randomUUID(), name: 'Gaji', type: 'income', color: '#6ba88b', archived: false },
  { id: crypto.randomUUID(), name: 'Pemasukan lain', type: 'income', color: '#7597bd', archived: false },
]

export const emptyData = (): FinanceData => ({
  accounts: [],
  categories: defaultCategories.map((category) => ({ ...category })),
  transactions: [],
  budgets: [],
  goals: [],
  goalEntries: [],
  recurringRules: [],
  openingBalanceHistory: [],
  displayName: '',
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  aiEnabled: false,
  remindersEnabled: true,
  onboardingComplete: false,
})

export const loadLocalData = (): FinanceData => {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return emptyData()
    const parsed = JSON.parse(stored) as Partial<FinanceData>
    return {
      accounts: parsed.accounts ?? [],
      categories: parsed.categories?.length ? parsed.categories : emptyData().categories,
      transactions: parsed.transactions ?? [],
      budgets: parsed.budgets ?? [],
      goals: parsed.goals ?? [],
      goalEntries: parsed.goalEntries ?? [],
      recurringRules: parsed.recurringRules ?? [],
      openingBalanceHistory: parsed.openingBalanceHistory ?? [],
      displayName: parsed.displayName ?? '',
      currency: parsed.currency ?? 'IDR',
      timezone: parsed.timezone ?? 'Asia/Jakarta',
      aiEnabled: parsed.aiEnabled ?? false,
      remindersEnabled: parsed.remindersEnabled ?? true,
      onboardingComplete: parsed.onboardingComplete ?? false,
    }
  } catch (error) {
    console.error('Tidak dapat membaca data lokal AturUang.', error)
    return emptyData()
  }
}

export const persistFinanceData = async (
  next: FinanceData,
  previous: FinanceData,
  userId: string | null,
) => {
  if (!supabase || !userId) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    return
  }

  const client = supabase
  const removeMissing = async (table: string, oldIds: string[], newIds: string[]) => {
    const removed = oldIds.filter((item) => !newIds.includes(item))
    if (!removed.length) return
    const { error } = await client.from(table).delete().eq('user_id', userId).in('id', removed)
    if (error) throw error
  }
  const saveRows = async (table: string, rows: object[]) => {
    if (!rows.length) return
    const { error } = await client.from(table).upsert(rows)
    if (error) throw error
  }
  const ids = (rows: Array<{ id: string }>) => rows.map(({ id }) => id)

  await removeMissing('goal_entries', ids(previous.goalEntries), ids(next.goalEntries))
  await removeMissing('goals', ids(previous.goals), ids(next.goals))
  await removeMissing('recurring_rules', ids(previous.recurringRules), ids(next.recurringRules))
  await removeMissing('transactions', ids(previous.transactions), ids(next.transactions))
  await removeMissing('budgets', ids(previous.budgets), ids(next.budgets))
  await removeMissing('categories', ids(previous.categories), ids(next.categories))
  await removeMissing('accounts', ids(previous.accounts), ids(next.accounts))

  const accountRows = next.accounts.map((row: Account) => ({
    id: row.id, user_id: userId, name: row.name, opening_balance: row.opening_balance,
    currency: 'IDR', archived: row.archived,
  }))
  const categoryRows = next.categories.map((row: Category) => ({
    id: row.id, user_id: userId, name: row.name, type: row.type, color: row.color, archived: row.archived,
  }))
  const transactionRows = next.transactions.map((row: Transaction) => ({
    id: row.id, user_id: userId, type: row.type, amount: row.amount, occurred_on: row.occurred_on,
    description: row.description, account_id: row.account_id, category_id: row.category_id,
    destination_account_id: row.destination_account_id, note: row.note, tags: row.tags,
  }))
  const budgetRows = next.budgets.map((row: Budget) => ({
    id: row.id, user_id: userId, category_id: row.category_id, month: `${row.month}-01`, amount: row.amount,
  }))
  const goalRows = next.goals.map((row: Goal) => ({
    id: row.id, user_id: userId, name: row.name, target_amount: row.target_amount,
    due_date: row.due_date, icon: row.icon, status: row.status,
  }))
  const goalEntryRows = next.goalEntries.map((row: GoalEntry) => ({
    id: row.id, user_id: userId, goal_id: row.goal_id, type: row.type, amount: row.amount,
    occurred_on: row.occurred_on, note: row.note,
  }))
  const recurringRows = next.recurringRules.map((row: RecurringRule) => ({
    id: row.id, user_id: userId, type: row.type, amount: row.amount, description: row.description,
    account_id: row.account_id, category_id: row.category_id, frequency: row.frequency,
    next_due: row.next_due, ends_on: row.ends_on, auto_record: row.auto_record, active: row.active,
  }))

  await saveRows('accounts', accountRows)
  await saveRows('categories', categoryRows)
  await saveRows('goals', goalRows)
  await saveRows('goal_entries', goalEntryRows)
  await saveRows('recurring_rules', recurringRows)
  await saveRows('transactions', transactionRows)
  await saveRows('budgets', budgetRows)
  const { error: profileError } = await client.from('profiles')
    .upsert({
      id: userId, display_name: next.displayName, currency: next.currency, timezone: next.timezone,
      ai_enabled: next.aiEnabled, reminders_enabled: next.remindersEnabled,
      onboarding_complete: next.onboardingComplete,
    })
  if (profileError) throw profileError
}

export const loadCloudData = async (userId: string): Promise<FinanceData> => {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.')

  const [profileResult, accountResult, categoryResult, transactionResult, budgetResult, goalsResult, goalEntriesResult, recurringResult, historyResult] = await Promise.all([
    supabase.from('profiles').select('display_name,currency,timezone,ai_enabled,reminders_enabled,onboarding_complete').eq('id', userId).maybeSingle(),
    supabase.from('accounts').select('id,name,opening_balance,archived').eq('user_id', userId).order('created_at'),
    supabase.from('categories').select('id,name,type,color,archived').eq('user_id', userId).order('name'),
    supabase.from('transactions').select('id,type,amount,occurred_on,description,account_id,category_id,destination_account_id,note,tags').eq('user_id', userId).order('occurred_on', { ascending: false }),
    supabase.from('budgets').select('id,category_id,month,amount').eq('user_id', userId),
    supabase.from('goals').select('id,name,target_amount,due_date,icon,status').eq('user_id', userId),
    supabase.from('goal_entries').select('id,goal_id,type,amount,occurred_on,note').eq('user_id', userId),
    supabase.from('recurring_rules').select('id,type,amount,description,account_id,category_id,frequency,next_due,ends_on,auto_record,active').eq('user_id', userId),
    supabase.from('account_balance_changes').select('id,account_id,old_balance,new_balance,changed_at').eq('user_id', userId).order('changed_at', { ascending: false }),
  ])
  const firstError = [
    profileResult.error, accountResult.error, categoryResult.error, transactionResult.error,
    budgetResult.error, goalsResult.error, goalEntriesResult.error, recurringResult.error, historyResult.error,
  ].find(Boolean)
  if (firstError) throw firstError

  let categories = (categoryResult.data ?? []) as Category[]
  if (!categories.length) {
    const initial = defaultCategories.map(({ id, name, type, color }) => ({
      id, user_id: userId, name, type, color, archived: false,
    }))
    const { data, error } = await supabase.from('categories').insert(initial).select('id,name,type,color,archived')
    if (error) throw error
    categories = (data ?? []) as Category[]
  }
  return {
    displayName: profileResult.data?.display_name ?? '',
    currency: profileResult.data?.currency ?? 'IDR',
    timezone: profileResult.data?.timezone ?? 'Asia/Jakarta',
    aiEnabled: profileResult.data?.ai_enabled ?? false,
    remindersEnabled: profileResult.data?.reminders_enabled ?? true,
    onboardingComplete: profileResult.data?.onboarding_complete ?? Boolean(accountResult.data?.length),
    accounts: ((accountResult.data ?? []) as Array<Omit<Account, 'opening_balance'> & { opening_balance: number }>).map((row) => ({
      ...row, opening_balance: Number(row.opening_balance),
    })),
    categories,
    transactions: ((transactionResult.data ?? []) as Array<Transaction & { amount: number }>).map((row) => ({
      ...row, amount: Number(row.amount), tags: row.tags ?? [],
    })),
    budgets: ((budgetResult.data ?? []) as Array<Budget & { amount: number; month: string }>).map((row) => ({
      ...row, amount: Number(row.amount), month: row.month.slice(0, 7),
    })),
    goals: ((goalsResult.data ?? []) as Array<Goal & { target_amount: number }>).map((row) => ({
      ...row, target_amount: Number(row.target_amount),
    })),
    goalEntries: ((goalEntriesResult.data ?? []) as Array<GoalEntry & { amount: number }>).map((row) => ({
      ...row, amount: Number(row.amount),
    })),
    recurringRules: ((recurringResult.data ?? []) as Array<RecurringRule & { amount: number }>).map((row) => ({
      ...row, amount: Number(row.amount),
    })),
    openingBalanceHistory: ((historyResult.data ?? []) as Array<OpeningBalanceChange & { old_balance: number; new_balance: number }>).map((row) => ({
      ...row, old_balance: Number(row.old_balance), new_balance: Number(row.new_balance),
    })),
  }
}
