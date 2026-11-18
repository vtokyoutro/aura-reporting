import type { ReportRow, Shift, Staff } from './report-data'

export type ModelName = 'alice' | 'alexa'
export type ReportPeriod = '7' | '30' | 'month' | 'all'

type ReportFilters = {
  period: ReportPeriod
  person: string
  shift: string
  search: string
}

export const shiftLabels: Record<Shift, string> = {
  morning: '🌅 Утренняя',
  day: '☀️ Дневная',
  night: '🌙 Ночная'
}

export const money = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export const dateLabel = (date: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })

export const sum = (rows: ReportRow[], key: keyof ReportRow): number =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0)

export const revenue = (row: ReportRow, model: ModelName): number =>
  Number(row[`${model}_end_balance`] ?? 0) - Number(row[`${model}_start_balance`] ?? 0)

export function filterReports(
  reports: ReportRow[],
  { period, person, shift, search }: ReportFilters,
  staffById: ReadonlyMap<string, Staff>,
  now: Date
): ReportRow[] {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === '7' || period === '30') {
    start.setTime(now.getTime())
    start.setDate(now.getDate() - Number(period) + 1)
  }
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  const searchTerm = search.toLowerCase()
  return reports.filter(
    (row) =>
      (period === 'all' || row.report_date >= startDate) &&
      (person === 'all' || row.staff_id === person) &&
      (shift === 'all' || row.shift_type === shift) &&
      (!searchTerm ||
        `${row.report_date} ${shiftLabels[row.shift_type]} ${staffById.get(row.staff_id)?.display_name ?? ''}`
          .toLowerCase()
          .includes(searchTerm))
  )
}

export function indexReportsByDate(reports: ReportRow[], person: string): Map<string, ReportRow[]> {
  const reportsByDate = new Map<string, ReportRow[]>()
  for (const row of reports) {
    if (person !== 'all' && row.staff_id !== person) continue
    const dayReports = reportsByDate.get(row.report_date)
    if (dayReports) dayReports.push(row)
    else reportsByDate.set(row.report_date, [row])
  }
  return reportsByDate
}

function escapeSpreadsheetFormula(value: string): string {
  return /^(?:[\t\r\n]|\s*[-=+@－＝＋＠])/.test(value) ? `'${value}` : value
}

export function createReportsCsv(rows: ReportRow[], nameOf: (staffId: string) => string): string {
  const headers = [
    'Дата',
    'Смена',
    'Сотрудник',
    'Alice начало',
    'Alice конец',
    'Alice продажи',
    'Alice покупатели',
    'Alice лиды',
    'Alexa начало',
    'Alexa конец',
    'Alexa продажи',
    'Alexa покупатели',
    'Alexa лиды'
  ]
  const lines = rows.map((row) =>
    [
      escapeSpreadsheetFormula(row.report_date),
      escapeSpreadsheetFormula(row.shift_type),
      escapeSpreadsheetFormula(nameOf(row.staff_id)),
      row.alice_start_balance,
      row.alice_end_balance,
      row.alice_sales,
      row.alice_customers,
      row.alice_leads,
      row.alexa_start_balance,
      row.alexa_end_balance,
      row.alexa_sales,
      row.alexa_customers,
      row.alexa_leads
    ]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(',')
  )
  return '\uFEFF' + [headers.join(','), ...lines].join('\r\n')
}
