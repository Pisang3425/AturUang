import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CreditCard, Download, Ellipsis,
  Eye, EyeOff, FileText, LayoutDashboard, Lightbulb, LogOut, Menu, MoreHorizontal,
  Pencil, Plus, Search, Settings, Sparkles, Target, Trash2, TrendingDown, TrendingUp,
  Wallet, X,
} from 'lucide-react'
import { currentMonth, formatDate, formatIDR, id, today } from './format'
import {
  emptyData, isCloudMode, loadCloudData, loadLocalData, persistFinanceData, supabase,
} from './data'
import type {
  Account, Budget, Category, FinanceData, Goal, GoalEntry, RecurringRule, Transaction,
  TransactionType,
} from './types'

type Page = 'dashboard' | 'transactions' | 'budgets' | 'goals' | 'bills' | 'reports' | 'insights' | 'settings'

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transaksi', icon: ArrowLeftRight },
  { id: 'budgets', label: 'Anggaran', icon: Wallet },
  { id: 'goals', label: 'Target tabungan', icon: Target },
  { id: 'bills', label: 'Tagihan & rutin', icon: CalendarDays },
  { id: 'reports', label: 'Laporan', icon: FileText },
  { id: 'insights', label: 'Insight AI', icon: Sparkles },
  { id: 'settings', label: 'Pengaturan', icon: Settings },
]

const monthLabel = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })
    .format(new Date(Date.UTC(year, number - 1, 1, 12)))
}

const monthDays = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(year, number, 0).getDate()
}

function advanceDueDate(value: string, frequency: RecurringRule['frequency']) {
  const [year, month, day] = value.split('-').map(Number)
  if (frequency === 'weekly') {
    const date = new Date(Date.UTC(year, month - 1, day + 7, 12))
    return date.toISOString().slice(0, 10)
  }
  const targetMonth = frequency === 'yearly' ? month : month % 12 + 1
  const targetYear = frequency === 'yearly' ? year + 1 : year + Math.floor(month / 12)
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0, 12)).getUTCDate()
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function App() {
  const [data, setData] = useState<FinanceData>(() => isCloudMode ? emptyData() : loadLocalData())
  const [page, setPage] = useState<Page>('dashboard')
  const [month, setMonth] = useState(currentMonth())
  const [showAmounts, setShowAmounts] = useState(true)
  const [modal, setModal] = useState<'transaction' | 'account' | 'budget' | 'goal' | 'goal-entry' | 'recurring' | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(isCloudMode)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [sortMode, setSortMode] = useState('newest')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAccount, setFilterAccount] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedGoalId, setSelectedGoalId] = useState('')
  const [deleteUndo, setDeleteUndo] = useState<{ transaction: Transaction; previous: FinanceData } | null>(null)
  const processedAutoDue = useRef(new Set<string>())

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let mounted = true
    supabase.auth.getSession().then(async ({ data: sessionData, error }) => {
      if (error) {
        notify('Tidak dapat memeriksa sesi. Muat ulang atau periksa koneksi Anda.')
        setLoading(false)
        return
      }
      const user = sessionData.session?.user
      if (!user) {
        if (mounted) { setUserId(null); setLoading(false) }
        return
      }
      try {
        const loaded = await loadCloudData(user.id)
        if (mounted) { setUserId(user.id); setData(loaded); setLoading(false) }
      } catch (loadError) {
        console.error('Gagal memuat data AturUang.', loadError)
        if (mounted) { notify('Data belum bisa dimuat. Periksa koneksi dan konfigurasi Supabase.'); setLoading(false) }
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
      if (!user) { setUserId(null); setData(emptyData()); setLoading(false); return }
      setLoading(true)
      window.setTimeout(() => {
        void loadCloudData(user.id).then((loaded) => {
          if (mounted) { setUserId(user.id); setData(loaded); setLoading(false) }
        }).catch((error: unknown) => {
          console.error('Gagal memuat data AturUang.', error)
          if (mounted) { notify('Data akun gagal dimuat. Periksa koneksi Anda.'); setLoading(false) }
        })
      }, 0)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [notify])

  const saveData = async (next: FinanceData, message = 'Perubahan berhasil disimpan.') => {
    const previous = data
    const changedBalances = next.accounts.flatMap((account) => {
      const old = previous.accounts.find((item) => item.id === account.id)
      return old && old.opening_balance !== account.opening_balance ? [{
        id: id(), account_id: account.id, old_balance: old.opening_balance,
        new_balance: account.opening_balance, changed_at: new Date().toISOString(),
      }] : []
    })
    const persistedNext = !isCloudMode && changedBalances.length
      ? { ...next, openingBalanceHistory: [...changedBalances, ...next.openingBalanceHistory] }
      : next
    setData(persistedNext)
    setSaving(true)
    try {
      await persistFinanceData(persistedNext, previous, userId)
      notify(message)
    } catch (error) {
      console.error('Gagal menyimpan data AturUang.', error)
      setData(previous)
      notify(isCloudMode ? 'Gagal menyimpan. Periksa koneksi dan kebijakan database Anda.' : 'Gagal menyimpan data di perangkat ini.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const currentDate = today(data.timezone)
    const generated: Transaction[] = []
    let autoDisabled = false
    const updatedRules = data.recurringRules.map((rule) => {
      if (!rule.auto_record || !rule.active || rule.next_due > currentDate) return rule
      const dueKey = `${rule.id}:${rule.next_due}`
      if (processedAutoDue.current.has(dueKey)) return rule
      processedAutoDue.current.add(dueKey)
      const account = data.accounts.find((item) => item.id === rule.account_id && !item.archived)
      const category = data.categories.find((item) =>
        item.id === rule.category_id && !item.archived && item.type === rule.type)
      if (!account || !category) {
        autoDisabled = true
        return { ...rule, auto_record: false }
      }
      let dueDate = rule.next_due
      let count = 0
      while (dueDate <= currentDate && (!rule.ends_on || dueDate <= rule.ends_on) && count < 100) {
        generated.push({
          id: id(), type: rule.type, amount: rule.amount, occurred_on: dueDate,
          description: rule.description, account_id: rule.account_id, category_id: rule.category_id,
          destination_account_id: null, note: 'Dicatat otomatis dari jadwal yang disetujui.', tags: [],
        })
        dueDate = advanceDueDate(dueDate, rule.frequency)
        count += 1
      }
      if (count === 100 && dueDate <= currentDate) {
        autoDisabled = true
        return { ...rule, auto_record: false, next_due: dueDate }
      }
      return { ...rule, next_due: dueDate }
    })
    if (!generated.length && updatedRules.every((rule, index) => rule === data.recurringRules[index])) return
    const suffix = autoDisabled ? ' Beberapa auto-catat dijeda karena akun/kategori nonaktif atau terlalu banyak jadwal tertunda.' : ''
    void persistFinanceData(
      { ...data, recurringRules: updatedRules, transactions: [...generated, ...data.transactions] },
      data,
      userId,
    ).then(() => {
      setData((current) => current === data
        ? { ...data, recurringRules: updatedRules, transactions: [...generated, ...data.transactions] }
        : current)
      if (generated.length) notify(`${generated.length} transaksi rutin dicatat otomatis sesuai persetujuanmu.${suffix}`)
      else if (autoDisabled) notify(`Auto-catat dijeda.${suffix}`)
    }).catch((error: unknown) => {
      console.error('Gagal memproses jadwal rutin otomatis.', error)
      if (generated.length) notify('Transaksi auto-catat gagal disimpan. Jadwal tetap tersimpan dan dapat dicatat manual.')
    })
  }, [data, userId, notify])

  const monthTransactions = useMemo(
    () => data.transactions.filter((transaction) => transaction.occurred_on.startsWith(month)),
    [data.transactions, month],
  )
  const totals = useMemo(() => {
    const income = monthTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
    const expense = monthTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
    const balance = data.accounts.filter((account) => !account.archived).reduce((sum, account) => {
      const movement = data.transactions.filter((transaction) => transaction.occurred_on <= today(data.timezone)).reduce((value, transaction) => {
        if (transaction.account_id === account.id) {
          if (transaction.type === 'income') return value + transaction.amount
          return value - transaction.amount
        }
        return transaction.destination_account_id === account.id ? value + transaction.amount : value
      }, 0)
      return sum + account.opening_balance + movement
    }, 0)
    return { income, expense, net: income - expense, balance }
  }, [data.accounts, data.transactions, data.timezone, monthTransactions])

  const shownTransactions = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase('id-ID')
    return [...data.transactions]
      .filter((transaction) => !query || transaction.description.toLocaleLowerCase('id-ID').includes(query))
      .filter((transaction) => filterType === 'all' || transaction.type === filterType)
      .filter((transaction) => filterCategory === 'all' || transaction.category_id === filterCategory)
      .filter((transaction) => filterAccount === 'all' || transaction.account_id === filterAccount || transaction.destination_account_id === filterAccount)
      .filter((transaction) => !dateFrom || transaction.occurred_on >= dateFrom)
      .filter((transaction) => !dateTo || transaction.occurred_on <= dateTo)
      .sort((a, b) => sortMode === 'oldest'
        ? a.occurred_on.localeCompare(b.occurred_on)
        : sortMode === 'amount-high'
          ? b.amount - a.amount
          : sortMode === 'amount-low'
            ? a.amount - b.amount
            : b.occurred_on.localeCompare(a.occurred_on))
  }, [data.transactions, searchText, filterType, sortMode, filterCategory, filterAccount, dateFrom, dateTo])

  const categorySpending = useMemo(() => data.categories
    .filter((category) => category.type === 'expense' && !category.archived)
    .map((category) => ({
      ...category,
      spent: monthTransactions.filter((item) => item.type === 'expense' && item.category_id === category.id)
        .reduce((sum, item) => sum + item.amount, 0),
    }))
    .filter((category) => category.spent > 0)
    .sort((a, b) => b.spent - a.spent), [data.categories, monthTransactions])

  const monthBudgets = data.budgets.filter((budget) => budget.month === month)
  const budgetSummary = monthBudgets.map((budget) => {
    const category = data.categories.find((item) => item.id === budget.category_id)
    const spent = monthTransactions.filter((item) => item.type === 'expense' && item.category_id === budget.category_id)
      .reduce((sum, item) => sum + item.amount, 0)
    return { ...budget, category, spent, percent: budget.amount ? spent / budget.amount * 100 : 0 }
  })

  const goMonth = (direction: -1 | 1) => {
    const [year, number] = month.split('-').map(Number)
    const date = new Date(Date.UTC(year, number - 1 + direction, 1, 12))
    setMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  const deleteTransaction = async (transaction: Transaction) => {
    if (!window.confirm(`Hapus transaksi “${transaction.description}”? Tindakan ini dapat dibatalkan segera setelah dihapus.`)) return
    const previous = data
    const next = { ...data, transactions: data.transactions.filter((item) => item.id !== transaction.id) }
    setDeleteUndo({ transaction, previous })
    setData(next)
    try {
      await persistFinanceData(next, previous, userId)
      notify('Transaksi dihapus. Pilih Urungkan untuk memulihkannya.')
      window.setTimeout(() => setDeleteUndo(null), 3200)
    } catch (error) {
      console.error('Gagal menghapus transaksi.', error)
      setData(previous)
      setDeleteUndo(null)
      notify('Transaksi gagal dihapus. Periksa koneksi Anda.')
    }
  }

  const undoDelete = async () => {
    if (!deleteUndo) return
    const next = deleteUndo.previous
    await saveData(next, 'Transaksi dipulihkan.')
    setDeleteUndo(null)
  }

  const downloadCSV = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const rows = [
      ['Tanggal', 'Jenis', 'Deskripsi', 'Kategori', 'Akun', 'Akun tujuan', 'Jumlah IDR', 'Catatan'],
      ...data.transactions.map((item) => [
        item.occurred_on,
        item.type === 'income' ? 'Pemasukan' : item.type === 'expense' ? 'Pengeluaran' : 'Transfer',
        item.description,
        data.categories.find((category) => category.id === item.category_id)?.name ?? '',
        data.accounts.find((account) => account.id === item.account_id)?.name ?? '',
        data.accounts.find((account) => account.id === item.destination_account_id)?.name ?? '',
        String(item.amount), item.note,
      ]),
    ]
    const dates = data.transactions.map((item) => item.occurred_on).sort()
    const latest = dates[dates.length - 1] ?? today()
    const earliest = dates[0] ?? today()
    const csv = `# AturUang; mata uang IDR; rentang ${earliest} sampai ${latest}\n${rows.map((row) => row.map(escape).join(',')).join('\n')}`
    downloadFile(csv, 'text/csv;charset=utf-8', `aturuang-transaksi-${today()}.csv`)
  }

  const downloadBackup = () => downloadFile(
    JSON.stringify({ ...data, exported_at: new Date().toISOString() }, null, 2),
    'application/json',
    `aturuang-cadangan-${today()}.json`,
  )

  const chartDays = Array.from({ length: monthDays(month) }, (_, index) => String(index + 1).padStart(2, '0'))
  const chartData = chartDays.map((day) => {
    const date = `${month}-${day}`
    const dayTx = monthTransactions.filter((item) => item.occurred_on === date)
    return {
      label: day,
      income: dayTx.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
      expense: dayTx.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
    }
  })
  const chartMax = Math.max(1, ...chartData.flatMap((day) => [day.income, day.expense]))

  if (loading) return <main className="loading-screen"><div className="loading-mark"><Wallet size={26} /></div><span>Menyiapkan ruang keuanganmu…</span></main>
  if (isCloudMode && !userId) return <LoginScreen onLogin={notify} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('dashboard') }}>
          <span className="brand-icon"><Wallet size={20} strokeWidth={2.4} /></span>
          <span className="brand-name">atur<span>uang</span></span>
        </a>
        <div className="workspace-label">RUANG PRIBADI</div>
        <nav className="side-nav" aria-label="Navigasi utama">
          {navItems.map(({ id: itemId, label, icon: Icon }) => (
            <button key={itemId} className={`nav-link ${page === itemId ? 'active' : ''}`} onClick={() => setPage(itemId)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {itemId === 'bills' && <span className="nav-dot" aria-label="Ada pengingat" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note"><span className="privacy-lock">✦</span><div><strong>Ruangmu, aturannya.</strong><small>Data keuanganmu milikmu.</small></div></div>
          <div className="profile-row">
            <span className="avatar">{(data.displayName || 'S').charAt(0).toLocaleUpperCase('id-ID')}</span>
            <div className="profile-name"><strong>{data.displayName || 'Keuangan saya'}</strong><small>{isCloudMode ? 'Akun pribadi' : 'Tersimpan di perangkat ini'}</small></div>
            <button className="icon-button tiny" aria-label="Buka pengaturan" onClick={() => setPage('settings')}><MoreHorizontal size={18} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Buka beranda" onClick={() => setPage('dashboard')}><Menu size={20} /></button><span>Keuangan pribadi</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === page)?.label}</strong></div>
          <div className="top-actions">
            <span className={`sync-status ${saving ? 'is-saving' : ''}`}><span />{saving ? 'Menyimpan' : isCloudMode ? 'Tersinkron' : 'Tersimpan lokal'}</span>
            <button className="icon-button notification-button" aria-label="Pengingat" onClick={() => setPage('bills')}><Bell size={18} /><i /></button>
            <span className="avatar top-avatar">{(data.displayName || 'S').charAt(0).toLocaleUpperCase('id-ID')}</span>
          </div>
        </header>

        <div className="page-content">
          {page === 'dashboard' && <Dashboard
            data={data} month={month} setMonth={setMonth} goMonth={goMonth} totals={totals}
            showAmounts={showAmounts} setShowAmounts={setShowAmounts} categorySpending={categorySpending}
            budgetSummary={budgetSummary} chartData={chartData} chartMax={chartMax}
            openTransaction={() => { setEditing(null); setModal('transaction') }}
            openAccount={() => setModal('account')}
            dismissOnboarding={() => void saveData({ ...data, onboardingComplete: true }, 'Panduan awal selesai.')}
            setPage={setPage} setFilterType={setFilterType} monthTransactions={monthTransactions}
          />}
          {page === 'transactions' && <TransactionsPage
            transactions={shownTransactions} data={data} searchText={searchText} setSearchText={setSearchText}
            filterType={filterType} setFilterType={setFilterType} sortMode={sortMode} setSortMode={setSortMode}
            filterCategory={filterCategory} setFilterCategory={setFilterCategory}
            filterAccount={filterAccount} setFilterAccount={setFilterAccount}
            dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
            add={() => { setEditing(null); setModal('transaction') }} edit={(item) => { setEditing(item); setModal('transaction') }}
            remove={deleteTransaction}
          />}
          {page === 'budgets' && <BudgetsPage month={month} goMonth={goMonth} items={budgetSummary}
            currency={data.currency}
            budgets={data.budgets} saveBudgets={(budgets) => void saveData({ ...data, budgets }, 'Anggaran bulan sebelumnya disalin.')}
            add={() => setModal('budget')} />}
          {page === 'goals' && <GoalsPage data={data} saveData={saveData}
            add={() => { setEditingGoal(null); setModal('goal') }}
            edit={(goal) => { setEditingGoal(goal); setModal('goal') }}
            addEntry={(goalId) => { setSelectedGoalId(goalId); setModal('goal-entry') }}
            remove={(goal) => {
              if (!window.confirm(`Hapus target “${goal.name}” beserta riwayat alokasinya?`)) return
              void saveData({ ...data, goals: data.goals.filter((item) => item.id !== goal.id), goalEntries: data.goalEntries.filter((entry) => entry.goal_id !== goal.id) }, 'Target dan riwayat alokasinya dihapus.')
            }}
            toggleStatus={(goal) => void saveData({ ...data, goals: data.goals.map((item) => item.id === goal.id ? { ...item, status: item.status === 'active' ? 'paused' : 'active' } : item) }, goal.status === 'active' ? 'Target dijeda.' : 'Target dilanjutkan.')}
          />}
          {page === 'bills' && <BillsPage data={data} saveData={saveData}
            add={() => { setEditingRule(null); setModal('recurring') }}
            edit={(rule) => { setEditingRule(rule); setModal('recurring') }}
            remove={(rule) => {
              if (!window.confirm(`Hapus jadwal “${rule.description}”?`)) return
              void saveData({ ...data, recurringRules: data.recurringRules.filter((item) => item.id !== rule.id) }, 'Jadwal rutin dihapus.')
            }}
            recordDue={(rule) => {
              const occurrence = rule.next_due
              if (!window.confirm(`Catat ${rule.type === 'income' ? 'pemasukan' : 'pengeluaran'} “${rule.description}” sebesar ${formatIDR(rule.amount, data.currency)} untuk ${formatDate(occurrence, data.timezone)}?`)) return
              const nextRule = { ...rule, next_due: advanceDueDate(rule.next_due, rule.frequency) }
              const transaction: Transaction = {
                id: id(), type: rule.type, amount: rule.amount, occurred_on: occurrence,
                description: rule.description, account_id: rule.account_id, category_id: rule.category_id,
                destination_account_id: null, note: 'Dicatat dari jadwal rutin.', tags: [],
              }
              void saveData({ ...data, recurringRules: data.recurringRules.map((item) => item.id === rule.id ? nextRule : item), transactions: [transaction, ...data.transactions] }, 'Transaksi rutin dikonfirmasi dan dicatat.')
            }}
          />}
          {page === 'reports' && <ReportsPage month={month} setMonth={setMonth} goMonth={goMonth} totals={totals}
            categories={categorySpending} data={data} csv={downloadCSV} backup={downloadBackup} />}
          {page === 'insights' && <InsightsPage month={month} goMonth={goMonth} monthTransactions={monthTransactions} totals={totals} data={data} openSettings={() => setPage('settings')} />}
          {page === 'settings' && <SettingsPage data={data} saveData={saveData} notify={notify} csv={downloadCSV}
            backup={downloadBackup} onAccount={() => { setEditingAccount(null); setModal('account') }}
            editAccount={(account) => { setEditingAccount(account); setModal('account') }}
            userId={userId} />}
        </div>
        <footer className="page-footer"><span>AturUang · Keuangan lebih tertata, satu langkah setiap hari.</span><span>Privat sejak awal <span className="footer-heart">♥</span></span></footer>
      </main>

      <nav className="mobile-nav" aria-label="Navigasi seluler">
        <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}><LayoutDashboard size={19} /><span>Beranda</span></button>
        <button className={page === 'transactions' ? 'active' : ''} onClick={() => setPage('transactions')}><ArrowLeftRight size={19} /><span>Transaksi</span></button>
        <button className="mobile-add" onClick={() => { setEditing(null); setModal('transaction') }} aria-label="Tambah transaksi"><Plus size={24} /></button>
        <button className={page === 'budgets' ? 'active' : ''} onClick={() => setPage('budgets')}><Wallet size={19} /><span>Anggaran</span></button>
        <button className={['goals', 'bills', 'reports', 'insights', 'settings'].includes(page) ? 'active' : ''} onClick={() => setPage('settings')}><Ellipsis size={19} /><span>Lainnya</span></button>
      </nav>

      {modal === 'transaction' && <TransactionModal data={data} editing={editing} aiEnabled={data.aiEnabled} close={() => setModal(null)}
        submit={(item) => {
          const next = editing
            ? { ...data, transactions: data.transactions.map((existing) => existing.id === item.id ? item : existing) }
            : { ...data, transactions: [item, ...data.transactions] }
          void saveData(next, editing ? 'Transaksi diperbarui.' : 'Transaksi berhasil dicatat.')
          setModal(null)
        }} />}
      {modal === 'account' && <AccountModal account={editingAccount} close={() => setModal(null)} submit={(account) => {
        const accounts = editingAccount
          ? data.accounts.map((item) => item.id === account.id ? account : item)
          : [...data.accounts, account]
        void saveData({ ...data, accounts }, editingAccount ? 'Akun berhasil diperbarui.' : 'Akun berhasil ditambahkan.')
        setModal(null)
      }} />}
      {modal === 'budget' && <BudgetModal categories={data.categories} month={month} budgets={data.budgets}
        close={() => setModal(null)} submit={(budget) => {
          const withoutDuplicate = data.budgets.filter((item) => !(item.month === budget.month && item.category_id === budget.category_id))
          void saveData({ ...data, budgets: [...withoutDuplicate, budget] }, 'Anggaran berhasil disimpan.')
          setModal(null)
        }} />}
      {modal === 'goal' && <GoalModal goal={editingGoal} close={() => setModal(null)} submit={(goal) => {
        const goals = editingGoal ? data.goals.map((item) => item.id === goal.id ? goal : item) : [...data.goals, goal]
        void saveData({ ...data, goals }, editingGoal ? 'Target berhasil diperbarui.' : 'Target tabungan dibuat.')
        setModal(null)
      }} />}
      {modal === 'goal-entry' && <GoalEntryModal goal={data.goals.find((item) => item.id === selectedGoalId)}
        available={goalBalance(selectedGoalId, data.goalEntries)} close={() => setModal(null)} submit={(entry) => {
        void saveData({ ...data, goalEntries: [...data.goalEntries, entry] }, 'Alokasi target berhasil dicatat.')
        setModal(null)
      }} />}
      {modal === 'recurring' && <RecurringModal data={data} rule={editingRule} close={() => setModal(null)} submit={(rule) => {
        const recurringRules = editingRule ? data.recurringRules.map((item) => item.id === rule.id ? rule : item) : [...data.recurringRules, rule]
        void saveData({ ...data, recurringRules }, editingRule ? 'Jadwal rutin diperbarui.' : 'Jadwal rutin dibuat.')
        setModal(null)
      }} />}
      {toast && <div role="status" className="toast"><Check size={17} /><span>{toast}</span>{deleteUndo && <button onClick={() => void undoDelete()}>Urungkan</button>}<button className="toast-close" aria-label="Tutup pesan" onClick={() => { setToast(''); setDeleteUndo(null) }}><X size={15} /></button></div>}
    </div>
  )
}

export default App

function downloadFile(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

type Totals = { income: number; expense: number; net: number; balance: number }

function MonthPicker({ month, goMonth }: { month: string; goMonth: (direction: -1 | 1) => void }) {
  return <div className="month-picker">
    <button aria-label="Bulan sebelumnya" onClick={() => goMonth(-1)}><ChevronLeft size={17} /></button>
    <span>{monthLabel(month)}</span>
    <button aria-label="Bulan berikutnya" onClick={() => goMonth(1)}><ChevronRight size={17} /></button>
  </div>
}

function Dashboard(props: {
  data: FinanceData; month: string; setMonth: (month: string) => void; goMonth: (direction: -1 | 1) => void
  totals: Totals; showAmounts: boolean; setShowAmounts: (show: boolean) => void
  categorySpending: Array<Category & { spent: number }>; budgetSummary: Array<Budget & { category?: Category; spent: number; percent: number }>
  chartData: Array<{ label: string; income: number; expense: number }>; chartMax: number
  openTransaction: () => void; setPage: (page: Page) => void; setFilterType: (type: string) => void
  monthTransactions: Transaction[]; openAccount: () => void; dismissOnboarding: () => void
}) {
  const { data, month, setMonth, goMonth, totals, showAmounts, setShowAmounts, categorySpending, budgetSummary,
    chartData, chartMax, openTransaction, openAccount, dismissOnboarding, setPage, setFilterType, monthTransactions } = props
  const showMoney = (value: number) => showAmounts ? formatIDR(value, data.currency) : `${data.currency} ••••••`
  const hasActivity = monthTransactions.length > 0
  return <>
    <div className="page-heading dashboard-heading">
      <div><div className="eyebrow"><span className="eyebrow-mark" /> RUANG KEUANGANMU</div><h1>Selamat pagi{data.displayName ? `, ${data.displayName}` : ''} <span className="wave">✳</span></h1><p>Pelan-pelan, semua hal baik dimulai dari catatan yang sederhana.</p></div>
      <div className="heading-actions"><MonthPicker month={month} goMonth={goMonth} /><button className="button-primary" onClick={openTransaction}><Plus size={17} /> Catat transaksi</button></div>
    </div>
    {!data.onboardingComplete && <div className="onboarding-banner"><div className="onboarding-icon"><Wallet size={21} /></div><div><strong>{data.accounts.length ? 'Akun pertama sudah siap!' : 'Mulai dari satu langkah kecil'}</strong><p>{data.accounts.length ? 'Tambahkan nama, catat transaksi, dan atur target kapan pun kamu siap.' : 'Tambahkan akun dan saldo awal. Kamu bisa melewati panduan ini dan melengkapinya nanti.'}</p><div className="onboarding-steps"><span className={data.displayName ? 'done' : ''}><Check size={12} /> Nama tampilan</span><span className={data.accounts.length ? 'done' : ''}><Check size={12} /> Akun & saldo awal</span><span className={data.categories.length ? 'done' : ''}><Check size={12} /> Kategori bawaan</span><span className={data.budgets.length || data.goals.length ? 'done' : ''}><Check size={12} /> Anggaran / target (opsional)</span></div></div><div className="onboarding-actions">{!data.accounts.length && <button className="button-dark" onClick={openAccount}>Tambah akun <ArrowRight size={15} /></button>}<button className="onboarding-skip" onClick={dismissOnboarding}>Selesai / lewati</button></div></div>}
    <div className="section-kicker"><span>RINGKASAN BULANAN</span><button className="privacy-toggle" onClick={() => setShowAmounts(!showAmounts)} aria-label={showAmounts ? 'Sembunyikan nominal' : 'Tampilkan nominal'}>{showAmounts ? <Eye size={15} /> : <EyeOff size={15} />}{showAmounts ? 'Sembunyikan nominal' : 'Tampilkan nominal'}</button></div>
    <div className="summary-grid">
      <article className="balance-card"><div className="card-top"><span>Total saldo</span><span className="balance-wallet"><Wallet size={16} /></span></div><strong className="balance-value">{showMoney(totals.balance)}</strong><div className="balance-bottom"><span className="balance-badge"><span /> {data.accounts.filter((account) => !account.archived).length} akun aktif</span><span>Posisi hari ini</span></div><div className="balance-decoration decor-one" /><div className="balance-decoration decor-two" /></article>
      <MetricCard label="Pemasukan" amount={showMoney(totals.income)} icon={ArrowDownLeft} trend="Bulan ini" tone="green" onClick={() => { setFilterType('income'); setPage('transactions') }} />
      <MetricCard label="Pengeluaran" amount={showMoney(totals.expense)} icon={ArrowUpRight} trend="Bulan ini" tone="coral" onClick={() => { setFilterType('expense'); setPage('transactions') }} />
      <MetricCard label="Arus kas bersih" amount={showMoney(totals.net)} icon={ArrowLeftRight} trend={totals.net >= 0 ? 'Lebih banyak masuk' : 'Lebih banyak keluar'} tone="blue" onClick={() => { setFilterType('all'); setPage('transactions') }} />
    </div>

    <div className="content-grid">
      <section className="panel chart-panel">
        <div className="panel-heading"><div><div className="panel-title">Arus kas</div><div className="panel-subtitle">Uang masuk dan keluar sepanjang bulan</div></div><button className="period-button" onClick={() => setMonth(currentMonth())}>Bulan ini <ChevronDown size={14} /></button></div>
        {hasActivity ? <div className="chart-wrap">
          <div className="chart-ylabels"><span>{compactMoney(chartMax)}</span><span>{compactMoney(chartMax * .66)}</span><span>{compactMoney(chartMax * .33)}</span><span>Rp0</span></div>
          <div className="chart-area"><div className="chart-gridline line-one" /><div className="chart-gridline line-two" /><div className="chart-gridline line-three" />
            <div className="chart-bars">{chartData.filter((item, index) => index % (chartData.length > 20 ? 3 : 2) === 0 || item.income + item.expense > 0).map((item) => (
              <div className="bar-pair" key={item.label} title={`${item.label}: pemasukan ${formatIDR(item.income)}, pengeluaran ${formatIDR(item.expense)}`}>
                <span className="chart-bar income-bar" style={{ height: `${Math.max(item.income ? 3 : 0, item.income / chartMax * 100)}%` }} />
                <span className="chart-bar expense-bar" style={{ height: `${Math.max(item.expense ? 3 : 0, item.expense / chartMax * 100)}%` }} />
              </div>
            ))}</div><div className="chart-xlabels"><span>01</span><span>07</span><span>14</span><span>21</span><span>{chartData[chartData.length - 1]?.label}</span></div>
          </div>
        </div> : <div className="chart-empty"><div className="empty-illustration"><TrendingUp size={22} /></div><strong>Grafikmu akan tumbuh di sini</strong><span>Catat transaksi pertamamu untuk melihat arus kas bulan ini.</span><button onClick={openTransaction}>Catat transaksi <ArrowRight size={14} /></button></div>}
        <div className="chart-legend"><span><i className="legend-dot income-dot" /> Pemasukan</span><span><i className="legend-dot expense-dot" /> Pengeluaran</span><button onClick={() => { setFilterType('all'); setPage('transactions') }}>Lihat transaksi <ArrowRight size={13} /></button></div>
      </section>
      <section className="panel spending-panel">
        <div className="panel-heading"><div><div className="panel-title">Ke mana uangmu pergi?</div><div className="panel-subtitle">Pengeluaran berdasarkan kategori</div></div><button className="text-link" onClick={() => setPage('reports')}>Lihat semua <ArrowRight size={13} /></button></div>
        {categorySpending.length ? <><div className="donut-layout"><div className="donut" style={{ background: donutGradient(categorySpending.map((item) => ({ color: item.color, value: item.spent }))) }}><div className="donut-hole"><strong>{categorySpending.length}</strong><span>kategori</span></div></div><div className="donut-legend">{categorySpending.slice(0, 5).map((item) => <button key={item.id} onClick={() => setPage('transactions')}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{showMoney(item.spent)}</strong></button>)}</div></div><button className="panel-bottom-link" onClick={() => setPage('reports')}>Lihat rincian pengeluaran <ArrowRight size={14} /></button></> :
          <div className="compact-empty"><span className="empty-mini-icon"><TrendingDown size={18} /></span><strong>Belum ada pengeluaran</strong><small>Semua pengeluaran yang kamu catat akan muncul di sini.</small></div>}
      </section>
    </div>

    <div className="content-grid lower-grid">
      <section className="panel budget-panel"><div className="panel-heading"><div><div className="panel-title">Anggaran bulan ini</div><div className="panel-subtitle">Jaga rencana tetap di jalurnya</div></div><button className="text-link" onClick={() => setPage('budgets')}>Kelola <ArrowRight size={13} /></button></div>
        {budgetSummary.length ? <div className="budget-list">{budgetSummary.slice(0, 4).map((item) => <BudgetProgress key={item.id} item={item} hidden={!showAmounts} currency={data.currency} />)}</div> :
          <div className="budget-empty"><div className="budget-empty-icon"><Wallet size={19} /></div><div><strong>Anggaran bikin lebih tenang</strong><span>Tentukan batas nyaman untuk kategori pengeluaranmu.</span></div><button aria-label="Tambah anggaran" onClick={() => setPage('budgets')}><Plus size={17} /></button></div>}
      </section>
      <section className="panel activity-panel"><div className="panel-heading"><div><div className="panel-title">Aktivitas terbaru</div><div className="panel-subtitle">Catatan keuangan terakhirmu</div></div><button className="text-link" onClick={() => setPage('transactions')}>Semua <ArrowRight size={13} /></button></div>
        {data.transactions.length ? <div className="activity-list">{[...data.transactions].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)).slice(0, 4).map((item) => <TransactionRow key={item.id} item={item} data={data} compact hidden={!showAmounts} />)}</div> :
          <div className="activity-empty"><span className="activity-empty-icon"><FileText size={18} /></span><div><strong>Belum ada catatan</strong><small>Mulai dengan mencatat transaksi pertamamu.</small></div><button aria-label="Catat transaksi" onClick={openTransaction}><Plus size={16} /></button></div>}
      </section>
    </div>
    <div className="insight-banner"><div className="insight-sparkle"><Sparkles size={19} /></div><div><strong>Keuangan yang baik dimulai dari memahami kebiasaanmu.</strong><span>{hasActivity ? 'Data dihitung dari transaksi yang kamu catat. Insight AI belum diaktifkan.' : 'Setiap catatan kecil membantumu melihat gambaran yang lebih besar.'}</span></div><button onClick={() => setPage('insights')}>Jelajahi insight <ArrowRight size={14} /></button></div>
  </>
}

function MetricCard({ label, amount, icon: Icon, trend, tone, onClick }: { label: string; amount: string; icon: typeof Wallet; trend: string; tone: string; onClick: () => void }) {
  return <button className={`metric-card tone-${tone}`} onClick={onClick}><span className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} /></span></span><strong className="metric-value">{amount}</strong><span className="metric-trend"><span className="trend-mark">{tone === 'coral' ? '↗' : tone === 'green' ? '↘' : '↔'}</span>{trend}</span></button>
}

function compactMoney(value: number) {
  if (value >= 1_000_000) return `Rp${(value / 1_000_000).toFixed(1).replace('.', ',')}jt`
  if (value >= 1_000) return `Rp${Math.round(value / 1000)}rb`
  return `Rp${Math.round(value)}`
}

function donutGradient(items: Array<{ color: string; value: number }>) {
  const sum = items.reduce((total, item) => total + item.value, 0) || 1
  let current = 0
  const stops = items.map((item) => {
    const start = current
    current += item.value / sum * 100
    return `${item.color} ${start}% ${current}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function BudgetProgress({ item, hidden, currency }: { item: Budget & { category?: Category; spent: number; percent: number }; hidden: boolean; currency: string }) {
  const percent = Math.min(100, item.percent)
  const state = item.percent >= 100 ? 'over' : item.percent >= 80 ? 'warning' : 'safe'
  return <div className="budget-row"><div className="budget-row-top"><span className="budget-category"><i style={{ background: item.category?.color ?? '#7a927f' }} />{item.category?.name ?? 'Kategori'}</span><strong>{hidden ? `${currency} ••••` : `${formatIDR(item.spent, currency)} / ${formatIDR(item.amount, currency)}`}</strong></div><div className={`progress-track ${state}`}><span style={{ width: `${percent}%` }} /></div><div className={`budget-status ${state}`}>{state === 'safe' ? 'Masih sesuai rencana' : state === 'warning' ? 'Mendekati batas · 80%+' : 'Anggaran tercapai atau terlewati'}<span>{hidden ? '••%' : `${Math.round(item.percent)}%`}</span></div></div>
}

function TransactionRow({ item, data, compact = false, hidden = false, edit, remove }: {
  item: Transaction; data: FinanceData; compact?: boolean; hidden?: boolean
  edit?: (item: Transaction) => void; remove?: (item: Transaction) => void
}) {
  const category = data.categories.find((entry) => entry.id === item.category_id)
  const account = data.accounts.find((entry) => entry.id === item.account_id)
  const isIncome = item.type === 'income'
  const Icon = item.type === 'transfer' ? ArrowLeftRight : isIncome ? ArrowDownLeft : ArrowUpRight
  const title = item.type === 'transfer' ? `${account?.name ?? 'Akun'} → ${data.accounts.find((entry) => entry.id === item.destination_account_id)?.name ?? 'Akun tujuan'}` : item.description
  return <div className={`transaction-row ${compact ? 'compact' : ''}`}>
    <span className={`transaction-icon ${item.type}`}><Icon size={17} /></span>
    <div className="transaction-main"><strong>{title}</strong><span>{item.type === 'transfer' ? 'Transfer antar-akun' : category?.name ?? 'Tanpa kategori'} <i /> {formatDate(item.occurred_on, data.timezone)}</span></div>
    <div className={`transaction-amount ${item.type}`}>{item.type === 'income' ? '+' : item.type === 'expense' ? '−' : ''}{hidden ? `${data.currency} •••••` : formatIDR(item.amount, data.currency)}<small>{item.type === 'income' ? 'Pemasukan' : item.type === 'expense' ? 'Pengeluaran' : 'Transfer'}</small></div>
    {(edit || remove) && <div className="transaction-actions">{edit && <button className="icon-button" aria-label="Edit transaksi" onClick={() => edit(item)}><Pencil size={15} /></button>}{remove && <button className="icon-button danger-icon" aria-label="Hapus transaksi" onClick={() => remove(item)}><Trash2 size={15} /></button>}</div>}
    {!compact && <div className="transaction-account">{account?.name ?? 'Akun'}</div>}
  </div>
}

function TransactionsPage(props: {
  transactions: Transaction[]; data: FinanceData; searchText: string; setSearchText: (text: string) => void
  filterType: string; setFilterType: (type: string) => void; sortMode: string; setSortMode: (mode: string) => void
  filterCategory: string; setFilterCategory: (value: string) => void
  filterAccount: string; setFilterAccount: (value: string) => void
  dateFrom: string; setDateFrom: (value: string) => void; dateTo: string; setDateTo: (value: string) => void
  add: () => void; edit: (item: Transaction) => void; remove: (item: Transaction) => void
}) {
  const { transactions, data, searchText, setSearchText, filterType, setFilterType, sortMode, setSortMode,
    filterCategory, setFilterCategory, filterAccount, setFilterAccount, dateFrom, setDateFrom, dateTo, setDateTo,
    add, edit, remove } = props
  return <>
    <PageHeading eyebrow="CATATAN KEUANGAN" title="Transaksi" subtitle="Semua pemasukan dan pengeluaranmu, tercatat rapi." action={<button className="button-primary" onClick={add}><Plus size={17} /> Catat transaksi</button>} />
    <div className="panel list-panel"><div className="list-toolbar">
      <label className="search-box"><Search size={17} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Cari transaksi…" aria-label="Cari deskripsi transaksi" /></label>
      <label className="select-wrap"><span>Jenis:</span><select value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="all">Semua</option><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option><option value="transfer">Transfer</option></select><ChevronDown size={13} /></label>
      <label className="select-wrap"><span>Kategori:</span><select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}><option value="all">Semua kategori</option>{data.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><ChevronDown size={13} /></label>
      <label className="select-wrap"><span>Akun:</span><select value={filterAccount} onChange={(event) => setFilterAccount(event.target.value)}><option value="all">Semua akun</option>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select><ChevronDown size={13} /></label>
      <label className="date-filter">Dari<input type="date" aria-label="Tanggal awal filter" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="date-filter">Sampai<input type="date" aria-label="Tanggal akhir filter" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <label className="select-wrap"><span>Urutkan:</span><select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="newest">Terbaru</option><option value="oldest">Terlama</option><option value="amount-high">Nominal terbesar</option><option value="amount-low">Nominal terkecil</option></select><ChevronDown size={13} /></label>
      <button className="filter-button" onClick={() => { setSearchText(''); setFilterType('all'); setFilterCategory('all'); setFilterAccount('all'); setDateFrom(''); setDateTo(''); setSortMode('newest') }}>Reset</button></div>
      <div className="list-summary"><span>{transactions.length} transaksi</span><span>Jumlah dihitung dari catatan yang tersimpan</span></div>
      {transactions.length ? <div className="transaction-list">{transactions.map((item) => <TransactionRow key={item.id} item={item} data={data} edit={edit} remove={remove} />)}</div> : <div className="large-empty"><div className="empty-illustration"><Search size={22} /></div><strong>{searchText || filterType !== 'all' ? 'Transaksi tidak ditemukan' : 'Belum ada transaksi'}</strong><span>{searchText || filterType !== 'all' ? 'Coba kata kunci atau filter lainnya.' : 'Catat pemasukan, pengeluaran, atau transfer pertamamu.'}</span>{!searchText && filterType === 'all' && <button className="button-primary" onClick={add}><Plus size={16} /> Catat transaksi</button>}</div>}
    </div>
  </>
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> {eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="heading-actions">{action}</div>}</div>
}

function BudgetsPage(props: { month: string; goMonth: (direction: -1 | 1) => void; items: Array<Budget & { category?: Category; spent: number; percent: number }>; budgets: Budget[]; saveBudgets: (items: Budget[]) => void; add: () => void; currency: string }) {
  const { month, goMonth, items, budgets, saveBudgets, add, currency } = props
  const totalLimit = items.reduce((sum, item) => sum + item.amount, 0)
  const totalSpent = items.reduce((sum, item) => sum + item.spent, 0)
  const [year, monthNumber] = month.split('-').map(Number)
  const previousDate = new Date(Date.UTC(year, monthNumber - 2, 1, 12))
  const previousMonth = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`
  const previousBudgets = budgets.filter((budget) => budget.month === previousMonth)
  return <>
    <PageHeading eyebrow="RENCANA BULANAN" title="Anggaran" subtitle="Beri setiap rupiah arah yang lebih jelas." action={<><MonthPicker month={month} goMonth={goMonth} />{previousBudgets.length > 0 && <button className="button-secondary" onClick={() => { const current = new Set(items.map((item) => item.category_id)); saveBudgets([...budgets, ...previousBudgets.filter((budget) => !current.has(budget.category_id)).map((budget) => ({ ...budget, id: id(), month }))]) }}>Salin bulan lalu</button>}<button className="button-primary" onClick={add}><Plus size={17} /> Buat anggaran</button></>} />
    <div className="report-summary-grid"><SummaryTile label="Total anggaran" value={formatIDR(totalLimit, currency)} icon={Wallet} /><SummaryTile label="Sudah digunakan" value={formatIDR(totalSpent, currency)} icon={ArrowUpRight} /><SummaryTile label="Sisa anggaran" value={formatIDR(totalLimit - totalSpent, currency)} icon={TrendingDown} /></div>
    <div className="panel budget-page-panel"><div className="panel-heading"><div><div className="panel-title">Rincian per kategori</div><div className="panel-subtitle">{monthLabel(month)} · hanya pengeluaran aktual</div></div></div>
      {items.length ? <div className="budget-page-list">{items.map((item) => <div className="budget-page-row" key={item.id}><span className="budget-category"><i style={{ background: item.category?.color ?? '#7a927f' }} />{item.category?.name}</span><div className="budget-page-meter"><div className={`progress-track ${item.percent >= 100 ? 'over' : item.percent >= 80 ? 'warning' : 'safe'}`}><span style={{ width: `${Math.min(item.percent, 100)}%` }} /></div><div className="budget-status">{item.percent >= 100 ? 'Batas terlewati' : item.percent >= 80 ? 'Mendekati batas' : 'Sesuai rencana'}<span>{Math.round(item.percent)}%</span></div></div><div className="budget-page-figures"><strong>{formatIDR(item.spent, currency)}</strong><span>dari {formatIDR(item.amount, currency)}</span></div><strong className="budget-remaining">{formatIDR(item.amount - item.spent, currency)}<small>tersisa</small></strong></div>)}</div> : <div className="large-empty"><div className="empty-illustration"><Wallet size={22} /></div><strong>Belum ada anggaran untuk {monthLabel(month)}</strong><span>Pilih kategori dan tentukan batas pengeluaran bulanan yang nyaman buatmu.</span><button className="button-primary" onClick={add}><Plus size={16} /> Buat anggaran</button></div>}
      <div className="budget-footnote"><CircleHelp size={16} /><span>Anggaran menghitung transaksi pengeluaran dengan kategori yang sama. Transfer dan pemasukan tidak dihitung.</span></div>
    </div>
    <div className="soft-note"><Lightbulb size={17} /><span><strong>Mulai sederhana.</strong> Kamu bisa sesuaikan anggaran kapan saja. Peringatan muncul saat penggunaan mencapai 80% dan 100%.</span></div>
  </>
}

function SummaryTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Wallet }) {
  return <div className="summary-tile"><span className="summary-tile-icon"><Icon size={17} /></span><span>{label}</span><strong>{value}</strong></div>
}

function ReportsPage(props: { month: string; setMonth: (month: string) => void; goMonth: (direction: -1 | 1) => void; totals: Totals; categories: Array<Category & { spent: number }>; data: FinanceData; csv: () => void; backup: () => void }) {
  const { month, goMonth, totals, categories, data, csv, backup } = props
  const [compare, setCompare] = useState(false)
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1, 12))
  const previousMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
  const previousTransactions = data.transactions.filter((item) => item.occurred_on.startsWith(previousMonth))
  const previousIncome = previousTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
  const previousExpense = previousTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
  return <>
    <PageHeading eyebrow="GAMBARAN LEBIH BESAR" title="Laporan" subtitle="Ringkasan yang jernih, berdasarkan catatan aktualmu." action={<><MonthPicker month={month} goMonth={goMonth} /><button className="button-secondary" onClick={() => setCompare(!compare)}>{compare ? 'Sembunyikan perbandingan' : 'Bandingkan bulan'}</button></>} />
    <div className="report-summary-grid"><SummaryTile label="Pemasukan" value={formatIDR(totals.income)} icon={ArrowDownLeft} /><SummaryTile label="Pengeluaran" value={formatIDR(totals.expense)} icon={ArrowUpRight} /><SummaryTile label="Arus kas bersih" value={formatIDR(totals.net)} icon={ArrowLeftRight} /><SummaryTile label="Total saldo" value={formatIDR(totals.balance)} icon={Wallet} /></div>
    {compare && <div className="comparison-strip"><strong>{monthLabel(month)}</strong><span>Pemasukan <b>{formatIDR(totals.income)}</b></span><span>Pengeluaran <b>{formatIDR(totals.expense)}</b></span><i /><strong>{monthLabel(previousMonth)}</strong><span>Pemasukan <b>{formatIDR(previousIncome)}</b></span><span>Pengeluaran <b>{formatIDR(previousExpense)}</b></span></div>}
    <div className="panel report-category-panel"><div className="panel-heading"><div><div className="panel-title">Pengeluaran per kategori</div><div className="panel-subtitle">{monthLabel(month)} · data aktual</div></div></div>
      {categories.length ? <div className="report-category-list">{categories.map((item) => <div key={item.id} className="report-category-row"><span><i style={{ background: item.color }} />{item.name}</span><div className="report-track"><span style={{ width: `${Math.max(3, item.spent / Math.max(1, ...categories.map((category) => category.spent)) * 100)}%`, background: item.color }} /></div><strong>{formatIDR(item.spent)}</strong></div>)}</div> : <div className="compact-empty"><TrendingDown size={18} /><strong>Belum ada pengeluaran</strong><small>Rincian kategori muncul setelah transaksi dicatat.</small></div>}
    </div>
    <div className="export-grid"><div className="export-card"><span className="export-icon"><FileText size={19} /></span><div><strong>Ekspor transaksi CSV</strong><p>File CSV dapat dibuka di spreadsheet. Mata uang dan rentang tanggal disertakan.</p></div><button className="button-secondary" onClick={csv}><Download size={15} /> Unduh CSV</button></div><div className="export-card"><span className="export-icon backup-icon"><Download size={19} /></span><div><strong>Cadangan data lengkap</strong><p>Simpan file JSON di tempat aman. Cadangan berisi data keuangan pribadimu.</p></div><button className="button-secondary" onClick={backup}><Download size={15} /> Unduh JSON</button></div></div>
  </>
}

function GoalsPage(props: {
  data: FinanceData; saveData: (data: FinanceData, message?: string) => Promise<void>; add: () => void
  edit: (goal: Goal) => void; addEntry: (goalId: string) => void; remove: (goal: Goal) => void
  toggleStatus: (goal: Goal) => void
}) {
  const { data, add, edit, addEntry, remove, toggleStatus, saveData } = props
  const activeGoals = data.goals.filter((goal) => goal.status !== 'completed')
  const totalTarget = activeGoals.reduce((sum, goal) => sum + goal.target_amount, 0)
  const totalSaved = activeGoals.reduce((sum, goal) => sum + goalBalance(goal.id, data.goalEntries), 0)
  return <>
    <PageHeading eyebrow="LANGKAH MENUJU IMPIAN" title="Target tabungan" subtitle="Sisihkan sedikit demi sedikit untuk hal yang berarti." action={<button className="button-primary" onClick={add}><Plus size={17} /> Buat target</button>} />
    <div className="report-summary-grid"><SummaryTile label="Target aktif" value={String(activeGoals.length)} icon={Target} /><SummaryTile label="Dana dialokasikan" value={formatIDR(totalSaved, data.currency)} icon={Wallet} /><SummaryTile label="Sisa menuju target" value={formatIDR(Math.max(0, totalTarget - totalSaved), data.currency)} icon={TrendingUp} /></div>
    <div className="allocation-note"><CircleHelp size={16} /><span>Kontribusi adalah alokasi yang kamu catat, bukan pemasukan baru atau bukti bahwa dana berada di akun tertentu.</span></div>
    {data.goals.length ? <div className="goal-grid">{data.goals.map((goal) => {
      const saved = goalBalance(goal.id, data.goalEntries)
      const percent = saved / goal.target_amount * 100
      const remaining = Math.max(0, goal.target_amount - saved)
      const entries = data.goalEntries.filter((entry) => entry.goal_id === goal.id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
      return <article className={`goal-card ${goal.status}`} key={goal.id}>
        <div className="goal-card-top"><span className="goal-icon"><Target size={19} /></span><div className="goal-menu">
          <button className="icon-button" aria-label={`Edit ${goal.name}`} onClick={() => edit(goal)}><Pencil size={15} /></button>
          {goal.status !== 'completed' && <button className="icon-button" aria-label={goal.status === 'active' ? `Jeda ${goal.name}` : `Lanjutkan ${goal.name}`} onClick={() => toggleStatus(goal)}>{goal.status === 'active' ? 'Ⅱ' : '▶'}</button>}
          {goal.status !== 'completed' && <button className="icon-button" aria-label={`Selesaikan ${goal.name}`} onClick={() => void saveData({ ...data, goals: data.goals.map((item) => item.id === goal.id ? { ...item, status: 'completed' } : item) }, 'Target ditandai selesai.')}><Check size={15} /></button>}
          <button className="icon-button danger-icon" aria-label={`Hapus ${goal.name}`} onClick={() => remove(goal)}><Trash2 size={15} /></button>
        </div></div>
        <span className={`goal-state ${goal.status}`}>{goal.status === 'active' ? 'Aktif' : goal.status === 'paused' ? 'Dijeda' : 'Selesai'}</span>
        <h2>{goal.name}</h2><div className="goal-amount">{formatIDR(saved, data.currency)}<span> dari {formatIDR(goal.target_amount, data.currency)}</span></div>
        <div className={`progress-track ${percent >= 100 ? 'safe' : ''}`}><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
        <div className="goal-progress-line"><span>{Math.round(percent)}% tercapai</span><span>{remaining ? `${formatIDR(remaining, data.currency)} lagi` : 'Target tercapai'}</span></div>
        <div className="goal-deadline">{goal.due_date ? `Tenggat ${formatDate(goal.due_date)}` : 'Tanpa tenggat'} · {entries.length} catatan alokasi</div>
        {entries.slice(0, 2).map((entry) => <div className="goal-entry-row" key={entry.id}><span>{entry.type === 'contribution' ? 'Kontribusi' : 'Penarikan'} · {formatDate(entry.occurred_on)}</span><strong className={entry.type}>{entry.type === 'contribution' ? '+' : '−'}{formatIDR(entry.amount, data.currency)}</strong></div>)}
        {goal.status !== 'completed' && <div className="goal-actions"><button className="button-secondary" onClick={() => addEntry(goal.id)}><Plus size={14} /> Catat alokasi</button><button className="button-text" onClick={() => edit(goal)}>Ubah target</button></div>}
      </article>
    })}</div> : <div className="panel feature-placeholder"><span className="feature-placeholder-icon"><Target size={25} /></span><strong>Setiap tujuan dimulai dari niat</strong><p>Buat target, tetapkan tenggat, lalu catat kontribusi atau penarikan. Progres dihitung dari alokasi yang kamu catat.</p><button className="button-primary" onClick={add}><Plus size={16} /> Buat target tabungan</button></div>}
  </>
}

function goalBalance(goalId: string, entries: GoalEntry[]) {
  return entries.filter((entry) => entry.goal_id === goalId).reduce((sum, entry) => sum + (entry.type === 'contribution' ? entry.amount : -entry.amount), 0)
}

function BillsPage(props: {
  data: FinanceData; saveData: (data: FinanceData, message?: string) => Promise<void>; add: () => void
  edit: (rule: RecurringRule) => void; remove: (rule: RecurringRule) => void; recordDue: (rule: RecurringRule) => void
}) {
  const { data, saveData, add, edit, remove, recordDue } = props
  const now = today(data.timezone)
  const soon = new Date(`${now}T12:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + 7)
  const soonDate = soon.toISOString().slice(0, 10)
  const rules = [...data.recurringRules].filter((rule) => rule.active).sort((a, b) => a.next_due.localeCompare(b.next_due))
  const due = rules.filter((rule) => rule.next_due <= soonDate && (!rule.ends_on || rule.next_due <= rule.ends_on))
  const requestNotifications = async () => {
    const notificationApi = Reflect.get(window, 'Notification') as typeof Notification | undefined
    if (!notificationApi) { window.alert('Browser ini tidak mendukung notifikasi. Pengingat tetap tampil di halaman ini.'); return }
    const permission = await notificationApi.requestPermission()
    if (permission === 'granted') {
      new notificationApi('Pengingat AturUang aktif', { body: 'Pengingat tagihan juga tetap tersedia di dalam aplikasi.' })
      return
    }
    if (permission === 'denied') window.alert('Izin notifikasi ditolak. Pengingat tetap tersedia di dalam aplikasi.')
  }
  return <>
    <PageHeading eyebrow="TETAP INGAT, TANPA TERBURU-BURU" title="Tagihan & rutin" subtitle="Jadwal adalah pengingat. Transaksi aktual dicatat sesuai persetujuanmu." action={<><button className="button-secondary" onClick={() => void requestNotifications()}><Bell size={15} /> Notifikasi browser</button><button className="button-primary" onClick={add}><Plus size={17} /> Jadwal baru</button></>} />
    {data.remindersEnabled && due.length > 0 && <section className="due-reminder"><span className="due-reminder-icon"><Bell size={17} /></span><div><strong>{due.length} pengingat jatuh tempo atau mendekat</strong><p>Tinjau di bawah. Tidak ada transaksi yang dibuat tanpa konfirmasi.</p></div></section>}
    <div className="panel recurring-panel"><div className="panel-heading"><div><div className="panel-title">Jadwal berulang</div><div className="panel-subtitle">Mingguan, bulanan, atau tahunan</div></div><span className="record-confirm-label"><Check size={13} /> Catat aktual setelah konfirmasi</span></div>
      {rules.length ? <div className="recurring-list">{rules.map((rule) => {
        const category = data.categories.find((item) => item.id === rule.category_id)
        const account = data.accounts.find((item) => item.id === rule.account_id)
        const isDue = rule.next_due <= soonDate
        const ended = Boolean(rule.ends_on && rule.next_due > rule.ends_on)
        return <article className={`recurring-row ${isDue && !ended ? 'is-due' : ''}`} key={rule.id}>
          <span className={`transaction-icon ${rule.type}`}><CalendarDays size={17} /></span>
          <div className="recurring-main"><strong>{rule.description}</strong><span>{category?.name ?? 'Kategori'} · {account?.name ?? 'Akun'} · {rule.frequency === 'weekly' ? 'Mingguan' : rule.frequency === 'monthly' ? 'Bulanan' : 'Tahunan'}</span></div>
          <div className="recurring-due"><strong>{ended ? 'Jadwal berakhir' : formatDate(rule.next_due)}</strong><span>{ended ? '' : rule.next_due < now ? 'Terlambat' : rule.next_due <= soonDate ? 'Segera jatuh tempo' : 'Berikutnya'}</span></div>
          <strong className={`recurring-amount ${rule.type}`}>{formatIDR(rule.amount, data.currency)}</strong>
          <div className="recurring-actions">{isDue && !ended && <button className="button-primary" onClick={() => recordDue(rule)}>Konfirmasi & catat</button>}<button className="icon-button" aria-label={`Edit jadwal ${rule.description}`} onClick={() => edit(rule)}><Pencil size={15} /></button><button className="icon-button danger-icon" aria-label={`Hapus jadwal ${rule.description}`} onClick={() => remove(rule)}><Trash2 size={15} /></button><button className="button-text" onClick={() => void saveData({ ...data, recurringRules: data.recurringRules.map((item) => item.id === rule.id ? { ...item, active: false } : item) }, 'Jadwal dijeda.')}>Jeda</button></div>
        </article>
      })}</div> : <div className="large-empty"><div className="empty-illustration"><CalendarDays size={22} /></div><strong>Belum ada jadwal rutin</strong><span>Tambahkan pengingat gaji, tagihan, cicilan, atau langganan.</span><button className="button-primary" onClick={add}><Plus size={16} /> Buat jadwal rutin</button></div>}
    </div>
    <div className="soft-note"><CircleHelp size={16} /><span>Jadwal rutin tidak otomatis menjadi transaksi aktual. Auto-catat hanya dapat diaktifkan secara sadar dan akan dijalankan saat aplikasi dibuka.</span></div>
  </>
}

function InsightsPage({ month, goMonth, monthTransactions, totals, data, openSettings }: { month: string; goMonth: (direction: -1 | 1) => void; monthTransactions: Transaction[]; totals: Totals; data: FinanceData; openSettings: () => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const expensesByCategory = monthTransactions.filter((item) => item.type === 'expense').reduce<Record<string, number>>((acc, item) => {
    const name = data.categories.find((category) => category.id === item.category_id)?.name ?? 'Tanpa kategori'
    acc[name] = (acc[name] ?? 0) + item.amount
    return acc
  }, {})
  const top = Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1])[0]
  const respond = async () => {
    const normalized = question.toLocaleLowerCase('id-ID')
    setBusy(true)
    setAnswer('')
    if (data.aiEnabled && supabase) {
      const summary = {
        period: monthLabel(month),
        currency: data.currency,
        transaction_count: monthTransactions.length,
        income: totals.income,
        expense: totals.expense,
        net_cash_flow: totals.net,
        expense_by_category: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })),
      }
      const { data: result, error } = await supabase.functions.invoke('financial-insight', {
        body: { mode: 'ask', question, summary },
      })
      setBusy(false)
      if (error || typeof result?.answer !== 'string') {
        setAnswer(error?.message ?? result?.error ?? 'Insight AI tidak tersedia saat ini. Coba lagi nanti.')
        return
      }
      setAnswer(result.answer)
      return
    }
    if (normalized.includes('makan')) {
      const value = Object.entries(expensesByCategory).find(([name]) => name.toLocaleLowerCase('id-ID').includes('makan'))?.[1] ?? 0
      setAnswer(value ? `Pengeluaran kategori Makanan pada ${monthLabel(month)} adalah ${formatIDR(value)}, berdasarkan transaksi pengeluaran berkategori Makanan yang tercatat.` : `Belum ada pengeluaran kategori Makanan yang tercatat pada ${monthLabel(month)}.`)
    } else if (normalized.includes('pengeluaran')) {
      setAnswer(`Total pengeluaran pada ${monthLabel(month)} adalah ${formatIDR(totals.expense)}, dihitung dari ${monthTransactions.filter((item) => item.type === 'expense').length} transaksi pengeluaran yang tercatat.`)
    } else if (normalized.includes('pemasukan')) {
      setAnswer(`Total pemasukan pada ${monthLabel(month)} adalah ${formatIDR(totals.income)}, dihitung dari ${monthTransactions.filter((item) => item.type === 'income').length} transaksi pemasukan yang tercatat.`)
    } else {
      setAnswer(`Pada ${monthLabel(month)}, ${monthTransactions.length} transaksi tercatat. Pengeluaran berjumlah ${formatIDR(totals.expense)} dan pemasukan ${formatIDR(totals.income)}. Jawaban dihitung hanya dari data aktual aplikasi.`)
    }
    setBusy(false)
  }
  return <>
    <PageHeading eyebrow="BERDASARKAN DATA, BUKAN TEBAKAN" title="Insight keuangan" subtitle={data.aiEnabled ? 'Angka dihitung dari catatanmu; jawaban AI menggunakan ringkasan terhitung.' : 'Ringkasan ini dihitung dari catatanmu. Fitur AI eksternal masih nonaktif.'} action={<MonthPicker month={month} goMonth={goMonth} />} />
    <div className="ai-consent-banner"><span className="ai-consent-icon"><Sparkles size={18} /></span><div><strong>{data.aiEnabled ? 'Insight AI diaktifkan' : 'AI eksternal nonaktif'}</strong><p>{data.aiEnabled ? 'Agregat transaksi dan pertanyaanmu dapat dikirim ke penyedia AI yang telah dikonfigurasi.' : 'Perhitungan dan jawaban di bawah hanya menggunakan kode aplikasi; tidak ada data yang dikirim.'}</p></div><button className="button-secondary" onClick={openSettings}>Pengaturan AI</button></div>
    <div className="insight-cards">{monthTransactions.length ? <><div className="insight-card"><span className="insight-card-label">PENGELUARAN TERBESAR</span><strong>{top?.[0] ?? 'Belum ada pengeluaran'}</strong><span>{top ? formatIDR(top[1], data.currency) : `Data ${monthLabel(month)} belum cukup.`}</span></div><div className="insight-card"><span className="insight-card-label">ARUS KAS BERSIH</span><strong>{formatIDR(totals.net, data.currency)}</strong><span>{monthLabel(month)} · pemasukan dikurangi pengeluaran</span></div><div className="insight-card"><span className="insight-card-label">DASAR RINGKASAN</span><strong>{monthTransactions.length} transaksi</strong><span>Rentang 1–{monthDays(month)} {monthLabel(month)}</span></div></> : <div className="insight-empty"><Lightbulb size={20} /><strong>Belum cukup data untuk insight</strong><span>Catat transaksi pada {monthLabel(month)}. Kami tidak akan mengarang tren atau angka.</span></div>}</div>
    <div className="panel ask-panel"><div className="ask-header"><div><span className="ask-sparkle"><Sparkles size={17} /></span><div><strong>Tanya tentang catatanmu</strong><small>{data.aiEnabled ? 'AI eksternal · agregat minimal ·' : 'Perhitungan di perangkat ini ·'} periode: {monthLabel(month)}</small></div></div></div><div className="ask-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void respond() }} placeholder="Contoh: Berapa pengeluaran makan bulan ini?" aria-label="Tanyakan tentang transaksi" /><button className="button-primary" disabled={!question.trim() || busy} onClick={() => void respond()}>{busy ? 'Menghitung…' : 'Tanyakan'} <ArrowRight size={15} /></button></div>{answer && <div className="answer-box"><span className="answer-badge"><Sparkles size={13} /> {data.aiEnabled ? 'Jawaban AI berbasis agregat' : 'Jawaban berbasis data'}</span><p>{answer}</p><span className="answer-period">Sumber: transaksi tercatat · {monthLabel(month)} · {monthTransactions.length} transaksi</span></div>}<div className="ai-safety-note"><CircleHelp size={15} /><span>Insight bukan nasihat investasi, pinjaman, atau rekomendasi keputusan finansial berisiko.</span></div></div>
  </>
}

function SettingsPage(props: {
  data: FinanceData; saveData: (data: FinanceData, message?: string) => Promise<void>; notify: (message: string) => void
  csv: () => void; backup: () => void; onAccount: () => void; editAccount: (account: Account) => void; userId: string | null
}) {
  const { data, saveData, notify, csv, backup, onAccount, editAccount, userId } = props
  const client = supabase
  const [name, setName] = useState(data.displayName)
  const [newCategory, setNewCategory] = useState('')
  const [categoryType, setCategoryType] = useState<'income' | 'expense'>('expense')
  const [deleteStep, setDeleteStep] = useState(false)
  useEffect(() => setName(data.displayName), [data.displayName])

  const saveProfile = () => void saveData({ ...data, displayName: name.trim() }, 'Nama tampilan berhasil diperbarui.')
  const addCategory = () => {
    const trimmed = newCategory.trim()
    if (!trimmed) return
    if (data.categories.some((category) => category.name.toLocaleLowerCase('id-ID') === trimmed.toLocaleLowerCase('id-ID') && category.type === categoryType)) {
      notify('Kategori dengan nama tersebut sudah ada.')
      return
    }
    void saveData({ ...data, categories: [...data.categories, { id: id(), name: trimmed, type: categoryType, color: '#789584', archived: false }] }, 'Kategori berhasil ditambahkan.')
    setNewCategory('')
  }
  const renameCategory = (category: Category) => {
    const nameInput = window.prompt('Nama kategori baru:', category.name)
    if (nameInput === null) return
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed.length > 60) { notify('Nama kategori harus berisi 1–60 karakter.'); return }
    if (data.categories.some((item) => item.id !== category.id && item.type === category.type && item.name.toLocaleLowerCase('id-ID') === trimmed.toLocaleLowerCase('id-ID'))) {
      notify('Kategori dengan nama tersebut sudah ada.')
      return
    }
    void saveData({ ...data, categories: data.categories.map((item) => item.id === category.id ? { ...item, name: trimmed } : item) }, 'Nama kategori diperbarui.')
  }
  const archiveCategory = (category: Category) => void saveData({
    ...data, categories: data.categories.map((item) => item.id === category.id ? { ...item, archived: !item.archived } : item),
  }, category.archived ? 'Kategori diaktifkan kembali.' : 'Kategori diarsipkan.')
  const archiveAccount = (account: Account) => void saveData({
    ...data, accounts: data.accounts.map((item) => item.id === account.id ? { ...item, archived: !item.archived } : item),
  }, account.archived ? 'Akun diaktifkan kembali.' : 'Akun diarsipkan.')
  const deleteAllData = async () => {
    if (!deleteStep) { setDeleteStep(true); return }
    const confirmation = window.prompt('Ketik HAPUS SEMUA untuk menghapus seluruh akun keuangan, transaksi, anggaran, target, dan jadwal.')
    if (confirmation !== 'HAPUS SEMUA') { setDeleteStep(false); notify('Penghapusan dibatalkan.'); return }
    if (!window.confirm('Ini permanen dan tidak dapat diurungkan. Sudahkah kamu mengunduh cadangan?')) { setDeleteStep(false); return }
    const blank = emptyData()
    blank.displayName = data.displayName
    blank.currency = data.currency
    blank.timezone = data.timezone
    blank.remindersEnabled = data.remindersEnabled
    blank.onboardingComplete = false
    await saveData(blank, 'Data keuangan berhasil dihapus.')
    setDeleteStep(false)
  }
  const updatePreference = (key: 'currency' | 'timezone' | 'remindersEnabled', value: string | boolean) =>
    void saveData({ ...data, [key]: value }, 'Preferensi berhasil diperbarui.')
  const setAIEnabled = (enabled: boolean) => {
    if (enabled && !window.confirm('Pertanyaan, ringkasan angka bulanan, serta deskripsi transaksi dan daftar kategori saat meminta saran kategori dapat dikirim ke penyedia AI. Catatan pribadi dan nama akun tidak dikirim. Aktifkan pemrosesan AI eksternal?')) return
    if (enabled && !client) { notify('Hubungkan Supabase dan konfigurasi Edge Function AI terlebih dahulu.'); return }
    void saveData({ ...data, aiEnabled: enabled }, enabled ? 'Insight AI diaktifkan.' : 'Insight AI dinonaktifkan.')
  }
  return <>
    <PageHeading eyebrow="PENGATURAN PRIBADI" title="Pengaturan" subtitle="Sesuaikan ruang keuanganmu dan kelola data dengan tenang." />
    <section className="settings-section panel">
      <div className="settings-section-heading"><span className="settings-section-icon"><Settings size={18} /></span><div><strong>Profil & preferensi</strong><small>Informasi dan tampilan aplikasi</small></div></div>
      <div className="settings-row"><div><strong>Nama tampilan</strong><small>Untuk sapaan personal di dashboard.</small></div><div className="settings-input"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nama kamu" aria-label="Nama tampilan" /><button className="button-secondary" disabled={name.trim() === data.displayName} onClick={saveProfile}>Simpan</button></div></div>
      <div className="settings-row"><div><strong>Mata uang</strong><small>Mengubah label mata uang saja; nilai transaksi tidak dikonversi.</small></div><select className="preference-select" aria-label="Mata uang" value={data.currency} onChange={(event) => { if (window.confirm('Nilai transaksi tidak dikonversi saat mata uang tampilan diubah. Lanjutkan?')) updatePreference('currency', event.target.value) }}><option value="IDR">Rupiah (IDR)</option><option value="USD">Dolar AS (USD)</option><option value="SGD">Dolar Singapura (SGD)</option><option value="MYR">Ringgit Malaysia (MYR)</option></select></div>
      <div className="settings-row"><div><strong>Zona waktu</strong><small>Digunakan untuk tanggal hari ini dan jadwal pengingat.</small></div><select className="preference-select" aria-label="Zona waktu" value={data.timezone} onChange={(event) => updatePreference('timezone', event.target.value)}><option value="Asia/Jakarta">Asia/Jakarta (WIB)</option><option value="Asia/Makassar">Asia/Makassar (WITA)</option><option value="Asia/Jayapura">Asia/Jayapura (WIT)</option></select></div>
      <div className="settings-row"><div><strong>Pengingat dalam aplikasi</strong><small>Tetap tampil di halaman Tagihan & rutin; notifikasi browser memerlukan izin terpisah.</small></div><label className="toggle-control"><input type="checkbox" aria-label="Aktifkan pengingat dalam aplikasi" checked={data.remindersEnabled} onChange={(event) => updatePreference('remindersEnabled', event.target.checked)} /><span /></label></div>
      <div className="settings-row"><div><strong>Privasi nominal</strong><small>Sembunyikan saldo ketika membuka aplikasi di tempat umum.</small></div><span className="setting-value">Atur lewat tombol mata di Dashboard</span></div>
    </section>
    <section className="settings-section panel">
      <div className="settings-section-heading"><span className="settings-section-icon accounts-settings-icon"><CreditCard size={18} /></span><div><strong>Akun keuangan</strong><small>Saldo dihitung dari saldo awal dan transaksi yang dicatat.</small></div><button className="button-secondary" onClick={onAccount}><Plus size={14} /> Tambah akun</button></div>
      {data.accounts.length ? data.accounts.map((account) => {
        const latestChange = data.openingBalanceHistory.find((entry) => entry.account_id === account.id)
        return <div className={`settings-row ${account.archived ? 'archived-row' : ''}`} key={account.id}>
          <div><strong>{account.name} {account.archived && <span className="archived-tag">Diarsipkan</span>}</strong><small>Saldo awal {formatIDR(account.opening_balance, data.currency)} · saldo sekarang {formatIDR(accountBalance(account, data.transactions, data.timezone), data.currency)}{latestChange ? ` · saldo awal diubah ${formatDate(latestChange.changed_at.slice(0, 10), data.timezone)}` : ''}</small></div>
          <div className="inline-actions"><button className="button-text" onClick={() => editAccount(account)}>Edit / saldo awal</button><button className="button-text" onClick={() => { if (!account.archived && !window.confirm(`Arsipkan akun ${account.name}? Transaksi lama tetap disimpan.`)) return; archiveAccount(account) }}>{account.archived ? 'Aktifkan' : 'Arsipkan'}</button></div>
        </div>
      }) : <div className="settings-empty">Belum ada akun. Tambahkan akun pertama untuk mulai mencatat transaksi.</div>}
    </section>
    <section className="settings-section panel">
      <div className="settings-section-heading"><span className="settings-section-icon category-settings-icon"><FileText size={18} /></span><div><strong>Kategori transaksi</strong><small>Atur kategori yang digunakan untuk mengelompokkan transaksi.</small></div></div>
      <div className="category-chip-list">{data.categories.map((category) => <span className={`category-chip ${category.archived ? 'archived-chip' : ''}`} key={category.id}><i style={{ background: category.color }} />{category.name}<small>{category.type === 'income' ? 'Masuk' : 'Keluar'}</small><button aria-label={`Ubah kategori ${category.name}`} onClick={() => renameCategory(category)}><Pencil size={12} /></button><button aria-label={`${category.archived ? 'Aktifkan' : 'Arsipkan'} kategori ${category.name}`} onClick={() => archiveCategory(category)}>{category.archived ? 'Aktifkan' : <X size={12} />}</button></span>)}</div>
      <div className="category-add-row"><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCategory() }} placeholder="Nama kategori baru" aria-label="Nama kategori baru" /><select value={categoryType} onChange={(event) => setCategoryType(event.target.value as 'income' | 'expense')} aria-label="Jenis kategori"><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select><button className="button-secondary" onClick={addCategory} disabled={!newCategory.trim()}><Plus size={14} /> Tambah</button></div>
    </section>
    <section className="settings-section panel"><div className="settings-section-heading"><span className="settings-section-icon ai-settings-icon"><Sparkles size={18} /></span><div><strong>Insight AI</strong><small>AI dapat menerima pertanyaan, ringkasan angka, serta deskripsi transaksi dan daftar kategori saat diminta. Catatan pribadi dan nama akun tidak dikirim.</small></div></div><div className="settings-row"><div><strong>Izinkan pemrosesan AI eksternal</strong><small>{data.aiEnabled ? 'Aktif. Kamu dapat mematikannya kapan saja.' : 'Nonaktif secara default. Perlu konfigurasi Supabase Edge Function dan kunci provider di server.'}</small></div><label className="toggle-control"><input type="checkbox" checked={data.aiEnabled} onChange={(event) => setAIEnabled(event.target.checked)} /><span /></label></div></section>
    <section className="settings-section panel"><div className="settings-section-heading"><span className="settings-section-icon export-settings-icon"><Download size={18} /></span><div><strong>Data & cadangan</strong><small>Unduh salinan sebelum mengganti perangkat.</small></div></div><div className="settings-actions"><button className="button-secondary" onClick={csv}><FileText size={15} /> Ekspor transaksi CSV</button><button className="button-secondary" onClick={backup}><Download size={15} /> Unduh cadangan JSON</button><p>Simpan file cadangan di tempat aman. File JSON berisi catatan keuangan pribadimu.</p></div></section>
    <section className="settings-section panel danger-settings"><div className="settings-section-heading"><span className="settings-section-icon logout-settings-icon"><Trash2 size={18} /></span><div><strong>Hapus seluruh data keuangan</strong><small>Tindakan permanen; unduh cadangan sebelum melanjutkan.</small></div><button className="button-secondary danger-button" onClick={() => void deleteAllData()}>{deleteStep ? 'Lanjutkan konfirmasi' : 'Hapus semua data'}</button></div>{deleteStep && <p className="form-error">Langkah pertama dipilih. Tekan lagi untuk memasukkan konfirmasi dan menghapus data secara permanen.</p>}</section>
    {client && <section className="settings-section panel danger-settings"><div className="settings-section-heading"><span className="settings-section-icon logout-settings-icon"><LogOut size={18} /></span><div><strong>Sesi akun</strong><small>Keluar dari akun Supabase di perangkat ini.</small></div><button className="button-secondary" onClick={async () => { const { error } = await client.auth.signOut(); if (error) notify('Gagal keluar. Coba lagi.'); else notify('Kamu berhasil keluar.') }}><LogOut size={15} /> Keluar</button></div><small className="user-id-note">ID pengguna: {userId?.slice(0, 8)}…</small></section>}
    <p className="settings-local-note">{isCloudMode ? 'Data disimpan di Supabase dengan perlindungan RLS per pengguna.' : 'Mode lokal: data tersimpan di browser perangkat ini. Siapkan Supabase untuk autentikasi dan sinkronisasi aman.'}</p>
  </>
}

function accountBalance(account: Account, transactions: Transaction[], timezone = 'Asia/Jakarta') {
  return transactions.filter((item) => item.occurred_on <= today(timezone)).reduce((balance, item) => {
    if (item.account_id === account.id) return balance + (item.type === 'income' ? item.amount : -item.amount)
    if (item.destination_account_id === account.id) return balance + item.amount
    return balance
  }, account.opening_balance)
}

function TransactionModal({ data, editing, aiEnabled, close, submit }: { data: FinanceData; editing: Transaction | null; aiEnabled: boolean; close: () => void; submit: (transaction: Transaction) => void }) {
  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [accountId, setAccountId] = useState(editing?.account_id ?? data.accounts.find((account) => !account.archived)?.id ?? '')
  const [destination, setDestination] = useState(editing?.destination_account_id ?? '')
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? '')
  const [date, setDate] = useState(editing?.occurred_on ?? today())
  const [note, setNote] = useState(editing?.note ?? '')
  const [tags, setTags] = useState(editing?.tags.join(', ') ?? '')
  const [error, setError] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [suggestedCategoryId, setSuggestedCategoryId] = useState('')
  const categories = data.categories.filter((category) => !category.archived && category.type === (type === 'income' ? 'income' : 'expense'))
  const accounts = data.accounts.filter((account) => !account.archived)
  const suggestCategory = async () => {
    if (!aiEnabled || !supabase) { setError('Aktifkan pemrosesan AI dan siapkan Supabase terlebih dahulu.'); return }
    if (!description.trim()) { setError('Isi deskripsi transaksi sebelum meminta saran kategori.'); return }
    if (!categories.length) { setError('Tidak ada kategori aktif untuk jenis transaksi ini.'); return }
    setAiBusy(true)
    setError('')
    const { data: result, error: invokeError } = await supabase.functions.invoke('financial-insight', {
      body: { mode: 'categorize', description: description.trim(), categories: categories.map((category) => category.name) },
    })
    setAiBusy(false)
    if (invokeError || typeof result?.category !== 'string') {
      setError(invokeError?.message ?? result?.error ?? 'Saran AI tidak tersedia.')
      return
    }
    const selected = categories.find((category) => category.name === result.category)
    if (!selected) { setError('Saran kategori tidak valid. Pilih kategori secara manual.'); return }
    setSuggestedCategoryId(selected.id)
    setAiReason(typeof result.reason === 'string' ? result.reason : '')
  }
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
      const numericAmount = Number(amount)
    if (!description.trim()) { setError('Isi nama transaksi terlebih dahulu.'); return }
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) { setError('Jumlah harus berupa bilangan rupiah bulat yang lebih besar dari nol.'); return }
    if (!accountId) { setError('Tambahkan akun keuangan sebelum mencatat transaksi.'); return }
    if (type === 'transfer' && (!destination || destination === accountId)) { setError('Pilih akun tujuan yang berbeda dari akun sumber.'); return }
    if (type !== 'transfer' && !categoryId) { setError('Pilih kategori transaksi.'); return }
    submit({
      id: editing?.id ?? id(), type, amount: numericAmount, occurred_on: date, description: description.trim(),
      account_id: accountId, category_id: type === 'transfer' ? null : categoryId,
      destination_account_id: type === 'transfer' ? destination : null, note: note.trim(),
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> CATAT DENGAN MUDAH</div><h2 id="transaction-title">{editing ? 'Edit transaksi' : 'Transaksi baru'}</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={handleSubmit}>
    <div className="type-selector"><button type="button" className={type === 'expense' ? 'selected expense-choice' : ''} onClick={() => { setType('expense'); setCategoryId('') }}><ArrowUpRight size={16} /> Pengeluaran</button><button type="button" className={type === 'income' ? 'selected income-choice' : ''} onClick={() => { setType('income'); setCategoryId('') }}><ArrowDownLeft size={16} /> Pemasukan</button><button type="button" className={type === 'transfer' ? 'selected transfer-choice' : ''} onClick={() => { setType('transfer'); setCategoryId('') }}><ArrowLeftRight size={16} /> Transfer</button></div>
    <label className="form-label">Nama transaksi<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === 'expense' ? 'Contoh: Makan siang' : type === 'income' ? 'Contoh: Gaji bulanan' : 'Contoh: Pindah ke tabungan'} autoFocus /></label>
    <div className="form-two-col"><label className="form-label">Jumlah (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></div></label><label className="form-label">Tanggal<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <label className="form-label">{type === 'transfer' ? 'Dari akun' : 'Akun'}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih akun…</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
    {type === 'transfer' ? <label className="form-label">Ke akun<select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Pilih akun tujuan…</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label> : <><label className="form-label">Kategori<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setAiReason(''); setSuggestedCategoryId('') }}><option value="">Pilih kategori…</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>{aiEnabled && <div className="category-ai-row"><button type="button" className="button-secondary" disabled={aiBusy || !description.trim()} onClick={() => void suggestCategory()}><Sparkles size={14} /> {aiBusy ? 'Meminta saran…' : 'Sarankan kategori dengan AI'}</button>{suggestedCategoryId && <button type="button" className="suggested-category" onClick={() => { setCategoryId(suggestedCategoryId); setSuggestedCategoryId('') }}>Terima “{categories.find((item) => item.id === suggestedCategoryId)?.name}”</button>}{aiReason && <span>{aiReason}</span>}</div>}</>}
    <label className="form-label">Catatan <span className="optional-label">Opsional</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tambahkan detail bila diperlukan" rows={2} /></label>
    <label className="form-label">Tag <span className="optional-label">Opsional · pisahkan dengan koma</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Contoh: rutin, keluarga" /></label>
    {error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={16} />{editing ? 'Simpan perubahan' : 'Simpan transaksi'}</button></div>
    </form></section></div>
}

function AccountModal({ account, close, submit }: { account: Account | null; close: () => void; submit: (account: Account) => void }) {
  const [name, setName] = useState(account?.name ?? '')
  const [balance, setBalance] = useState(String(account?.opening_balance ?? 0))
  const [error, setError] = useState('')
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> {account ? 'KELOLA AKUN' : 'LANGKAH PERTAMA'}</div><h2 id="account-title">{account ? 'Edit akun' : 'Tambah akun'}</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={(event) => { event.preventDefault(); const openingBalance = Number(balance); if (!name.trim()) { setError('Masukkan nama akun.'); return }; if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) { setError('Saldo awal harus berupa bilangan rupiah bulat dan tidak negatif.'); return }; if (account && account.opening_balance !== openingBalance && !window.confirm(`Ubah saldo awal ${account.name} dari ${formatIDR(account.opening_balance)} menjadi ${formatIDR(openingBalance)}? Perubahan saldo awal memengaruhi saldo historis.`)) return; submit({ id: account?.id ?? id(), name: name.trim(), opening_balance: openingBalance, archived: account?.archived ?? false }) }}><p className="modal-intro">{account ? 'Perubahan saldo awal akan dihitung ulang bersama seluruh catatan transaksi.' : 'Akun bisa berupa tunai, rekening bank, atau dompet digital. Tidak ada rekening yang dihubungkan.'}</p><label className="form-label">Nama akun<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Contoh: Tunai, BCA, GoPay" /></label><label className="form-label">Saldo awal (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="0" step="1" value={balance} onChange={(event) => setBalance(event.target.value)} /></div></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={15} /> Simpan akun</button></div></form></section></div>
}

function GoalModal({ goal, close, submit }: { goal: Goal | null; close: () => void; submit: (goal: Goal) => void }) {
  const [name, setName] = useState(goal?.name ?? '')
  const [amount, setAmount] = useState(String(goal?.target_amount ?? ''))
  const [dueDate, setDueDate] = useState(goal?.due_date ?? '')
  const [error, setError] = useState('')
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="goal-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> RENCANA MASA DEPAN</div><h2 id="goal-title">{goal ? 'Edit target' : 'Target baru'}</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={(event) => { event.preventDefault(); const target = Number(amount); if (!name.trim()) { setError('Masukkan nama target.'); return }; if (!Number.isSafeInteger(target) || target <= 0) { setError('Nominal target harus berupa bilangan rupiah bulat di atas nol.'); return }; submit({ id: goal?.id ?? id(), name: name.trim(), target_amount: target, due_date: dueDate || null, icon: goal?.icon ?? 'target', status: goal?.status ?? 'active' }) }}><label className="form-label">Nama target<input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="Contoh: Dana liburan" /></label><label className="form-label">Nominal tujuan (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><label className="form-label">Tenggat <span className="optional-label">Opsional</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><p className="modal-intro">Kontribusi target adalah alokasi dana, bukan pemasukan dan bukan bukti saldo di akun tertentu.</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={15} /> Simpan target</button></div></form></section></div>
}

function GoalEntryModal({ goal, available, close, submit }: { goal?: Goal; available: number; close: () => void; submit: (entry: GoalEntry) => void }) {
  const [type, setType] = useState<GoalEntry['type']>('contribution')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  if (!goal) return null
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isSafeInteger(value) || value <= 0) { setError('Nominal harus berupa bilangan rupiah bulat di atas nol.'); return }
    if (type === 'withdrawal' && value > available) { setError(`Penarikan melebihi dana alokasi saat ini (${formatIDR(available)}).`); return }
    submit({ id: id(), goal_id: goal.id, type, amount: value, occurred_on: date, note: note.trim() })
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="goal-entry-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> {goal.name}</div><h2 id="goal-entry-title">Catat alokasi</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={handleSubmit}><div className="type-selector"><button type="button" className={type === 'contribution' ? 'selected income-choice' : ''} onClick={() => setType('contribution')}><ArrowDownLeft size={15} /> Kontribusi</button><button type="button" className={type === 'withdrawal' ? 'selected expense-choice' : ''} onClick={() => setType('withdrawal')}><ArrowUpRight size={15} /> Penarikan</button></div><label className="form-label">Jumlah (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><label className="form-label">Tanggal<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="form-label">Catatan<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsional" /></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={15} /> Simpan alokasi</button></div></form></section></div>
}

function RecurringModal({ data, rule, close, submit }: { data: FinanceData; rule: RecurringRule | null; close: () => void; submit: (rule: RecurringRule) => void }) {
  const [type, setType] = useState<'income' | 'expense'>(rule?.type ?? 'expense')
  const accounts = data.accounts.filter((account) => !account.archived)
  const categories = data.categories.filter((category) => category.type === type && !category.archived)
  const [description, setDescription] = useState(rule?.description ?? '')
  const [amount, setAmount] = useState(String(rule?.amount ?? ''))
  const [accountId, setAccountId] = useState(rule?.account_id ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? categories[0]?.id ?? '')
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(rule?.frequency ?? 'monthly')
  const [nextDue, setNextDue] = useState(rule?.next_due ?? today())
  const [endsOn, setEndsOn] = useState(rule?.ends_on ?? '')
  const [autoRecord, setAutoRecord] = useState(rule?.auto_record ?? false)
  const [error, setError] = useState('')
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!description.trim()) { setError('Isi nama jadwal.'); return }
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) { setError('Nominal harus berupa bilangan rupiah bulat di atas nol.'); return }
    if (!accountId || !categoryId) { setError('Pilih akun dan kategori aktif.'); return }
    if (endsOn && endsOn < nextDue) { setError('Tanggal akhir tidak boleh sebelum tanggal berikutnya.'); return }
    if (autoRecord && !window.confirm('Izinkan aplikasi mencatat transaksi ini secara otomatis saat aplikasi dibuka setelah tanggal jatuh tempo?')) return
    submit({
      id: rule?.id ?? id(), type, amount: numericAmount, description: description.trim(), account_id: accountId,
      category_id: categoryId, frequency, next_due: nextDue, ends_on: endsOn || null,
      auto_record: autoRecord, active: rule?.active ?? true,
    })
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="recurring-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> JADWAL BERULANG</div><h2 id="recurring-title">{rule ? 'Edit jadwal' : 'Jadwal baru'}</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={handleSubmit}><div className="type-selector"><button type="button" className={type === 'expense' ? 'selected expense-choice' : ''} onClick={() => { setType('expense'); setCategoryId('') }}><ArrowUpRight size={15} /> Pengeluaran</button><button type="button" className={type === 'income' ? 'selected income-choice' : ''} onClick={() => { setType('income'); setCategoryId('') }}><ArrowDownLeft size={15} /> Pemasukan</button></div><label className="form-label">Nama jadwal<input value={description} onChange={(event) => setDescription(event.target.value)} autoFocus placeholder="Contoh: Gaji bulanan, sewa" /></label><div className="form-two-col"><label className="form-label">Nominal (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label><label className="form-label">Frekuensi<select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringRule['frequency'])}><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option><option value="yearly">Tahunan</option></select></label></div><label className="form-label">Akun<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih akun…</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label><label className="form-label">Kategori<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Pilih kategori…</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><div className="form-two-col"><label className="form-label">Jatuh tempo berikutnya<input type="date" value={nextDue} onChange={(event) => setNextDue(event.target.value)} required /></label><label className="form-label">Tanggal akhir <span className="optional-label">Opsional</span><input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><label className="auto-record-choice"><input type="checkbox" checked={autoRecord} onChange={(event) => setAutoRecord(event.target.checked)} /><span><strong>Auto-catat saat aplikasi dibuka</strong><small>Catatan jatuh tempo dibuat otomatis hanya setelah kamu mengaktifkannya. Berjalan ketika aplikasi sedang dibuka/diakses.</small></span></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={15} /> Simpan jadwal</button></div></form></section></div>
}

function BudgetModal({ categories, month, budgets, close, submit }: { categories: Category[]; month: string; budgets: Budget[]; close: () => void; submit: (budget: Budget) => void }) {
  const available = categories.filter((item) => item.type === 'expense' && !item.archived)
  const [categoryId, setCategoryId] = useState(available[0]?.id ?? '')
  const [amount, setAmount] = useState(budgets.find((item) => item.month === month && item.category_id === available[0]?.id)?.amount.toString() ?? '')
  const [budgetMonth, setBudgetMonth] = useState(month)
  const existing = budgets.find((item) => item.month === budgetMonth && item.category_id === categoryId)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="budget-title"><div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-mark" /> RENCANA BULANAN</div><h2 id="budget-title">Anggaran kategori</h2></div><button className="icon-button" onClick={close} aria-label="Tutup"><X size={19} /></button></div><form onSubmit={(event) => { event.preventDefault(); const value = Number(amount); if (!Number.isSafeInteger(value) || value <= 0 || !categoryId) return; submit({ id: existing?.id ?? id(), category_id: categoryId, month: budgetMonth, amount: value }) }}><label className="form-label">Kategori<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{available.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="form-label">Bulan<input type="month" value={budgetMonth} onChange={(event) => setBudgetMonth(event.target.value)} /></label><label className="form-label">Batas anggaran (IDR)<div className="currency-input"><span>Rp</span><input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required /></div></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={close}>Batal</button><button type="submit" className="button-primary"><Check size={15} /> Simpan anggaran</button></div></form></section></div>
}

function LoginScreen({ onLogin }: { onLogin: (message: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const client = supabase
    if (!client) return
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Konfirmasi kata sandi belum sama.')
      return
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Kata sandi harus berisi minimal 8 karakter.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') {
        const { data: result, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (authError) {
          setError(authError.message.toLocaleLowerCase('id-ID').includes('disabled')
            ? 'Pendaftaran belum diaktifkan di pengaturan Supabase Auth.'
            : 'Pendaftaran gagal. Periksa email dan kata sandi, lalu coba lagi.')
        } else if (result.session) {
          onLogin('Akun berhasil dibuat.')
        } else {
          setConfirmationSent(true)
        }
      } else {
        const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) setError('Email atau kata sandi belum cocok. Jika baru mendaftar, periksa email untuk konfirmasi akun.')
        else onLogin('Berhasil masuk.')
      }
    } catch (authError) {
      console.error('Permintaan autentikasi gagal.', authError)
      setError('Tidak dapat terhubung ke layanan akun. Periksa koneksi internet lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="login-screen">
    <div className="login-brand"><span className="brand-icon"><Wallet size={20} /></span><span className="brand-name">atur<span>uang</span></span></div>
    <section className="login-card">
      {confirmationSent ? <>
        <div className="eyebrow"><span className="eyebrow-mark" /> SATU LANGKAH LAGI</div>
        <h1>Periksa emailmu.</h1>
        <p>Jika alamat email dapat didaftarkan, Supabase akan mengirim tautan konfirmasi. Buka tautan itu dari perangkat ini untuk menyelesaikan pendaftaran.</p>
        <button className="button-primary login-submit" onClick={() => { setConfirmationSent(false); setMode('login'); setPassword(''); setConfirmPassword('') }}>Kembali ke halaman masuk</button>
      </> : <>
        <div className="eyebrow"><span className="eyebrow-mark" /> {mode === 'login' ? 'SELAMAT DATANG KEMBALI' : 'BUAT RUANG KEUANGANMU'}</div>
        <h1>{mode === 'login' ? <>Ruang keuanganmu,<br />dalam kendalimu.</> : <>Mulai atur uang,<br />dengan tenang.</>}</h1>
        <p>{mode === 'login'
          ? 'Masuk untuk melihat catatan keuangan pribadimu.'
          : 'Buat akun untuk mulai mencatat. Catatan keuangan hanya dapat dilihat oleh pemilik akun.'}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-label">Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="nama@email.com" /></label>
          <label className="form-label">Kata sandi<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder={mode === 'signup' ? 'Minimal 8 karakter' : 'Masukkan kata sandi'} /></label>
          {mode === 'signup' && <label className="form-label">Ulangi kata sandi<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required placeholder="Masukkan kata sandi sekali lagi" /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button-primary login-submit" type="submit" disabled={busy}>{busy ? (mode === 'login' ? 'Memeriksa…' : 'Membuat akun…') : mode === 'login' ? 'Masuk ke AturUang' : 'Buat akun'} <ArrowRight size={16} /></button>
        </form>
        <div className="login-switch">{mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'} <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'Daftar sekarang' : 'Masuk'}</button></div>
        <div className="login-privacy"><span>✦</span><div><strong>Privat sejak awal</strong><small>Data tiap akun terpisah dan dilindungi kebijakan RLS.</small></div></div>
      </>}
    </section>
    <span className="login-footer">AturUang · Keuangan lebih tertata, satu langkah setiap hari.</span>
  </main>
}
