export const formatIDR = (amount: number, currency = 'IDR') =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)

export const formatDate = (date: string, timezone = 'Asia/Jakarta') =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00+07:00`))

export const today = (timezone = 'Asia/Jakarta') =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date())

export const currentMonth = () => today().slice(0, 7)

export const id = () => crypto.randomUUID()
