export type TransactionType = 'income' | 'expense' | 'transfer'

export interface Account {
  id: string
  name: string
  opening_balance: number
  archived: boolean
}

export interface Category {
  id: string
  name: string
  type: 'income' | 'expense'
  color: string
  archived: boolean
}

export interface Transaction {
  id: string
  type: TransactionType
  amount: number
  occurred_on: string
  description: string
  account_id: string
  category_id: string | null
  destination_account_id: string | null
  note: string
  tags: string[]
}

export interface Budget {
  id: string
  category_id: string
  month: string
  amount: number
}

export interface Goal {
  id: string
  name: string
  target_amount: number
  due_date: string | null
  icon: string
  status: 'active' | 'paused' | 'completed'
}

export interface GoalEntry {
  id: string
  goal_id: string
  type: 'contribution' | 'withdrawal'
  amount: number
  occurred_on: string
  note: string
}

export interface RecurringRule {
  id: string
  type: 'income' | 'expense'
  amount: number
  description: string
  account_id: string
  category_id: string
  frequency: 'weekly' | 'monthly' | 'yearly'
  next_due: string
  ends_on: string | null
  auto_record: boolean
  active: boolean
}

export interface OpeningBalanceChange {
  id: string
  account_id: string
  old_balance: number
  new_balance: number
  changed_at: string
}

export interface FinanceData {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  goals: Goal[]
  goalEntries: GoalEntry[]
  recurringRules: RecurringRule[]
  openingBalanceHistory: OpeningBalanceChange[]
  displayName: string
  currency: string
  timezone: string
  aiEnabled: boolean
  remindersEnabled: boolean
  onboardingComplete: boolean
}

export interface SaveResult {
  data: FinanceData
  error: string | null
}
