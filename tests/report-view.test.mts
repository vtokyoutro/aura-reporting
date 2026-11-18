import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReportRow, Staff } from '../src/renderer/src/lib/report-data.ts'
import {
  createReportsCsv,
  filterReports,
  indexReportsByDate,
  revenue,
  shiftLabels,
  sum
} from '../src/renderer/src/lib/report-view.ts'

function report(id: string, date: string, fields: Partial<ReportRow> = {}): ReportRow {
  return {
    id,
    staff_id: 'anna',
    report_date: date,
    shift_type: 'day',
    created_at: date + 'T12:00:00Z',
    updated_at: date + 'T12:00:00Z',
    alice_start_balance: null,
    alice_end_balance: null,
    alice_sales: null,
    alice_customers: null,
    alice_leads: null,
    alexa_start_balance: null,
    alexa_end_balance: null,
    alexa_sales: null,
    alexa_customers: null,
    alexa_leads: null,
    ...fields
  }
}

const first = report('first', '2026-11-11', {
  alice_start_balance: 100,
  alice_end_balance: 130,
  alice_sales: 2,
  alice_customers: 1,
  alice_leads: 5,
  alexa_start_balance: 200,
  alexa_end_balance: 240,
  alexa_sales: 4,
  alexa_customers: 3,
  alexa_leads: 7
})
const second = report('second', '2026-11-17', {
  alice_start_balance: 130,
  alice_end_balance: 120,
  alice_sales: 1,
  alice_customers: 1,
  alice_leads: 3,
  alexa_start_balance: 240,
  alexa_end_balance: 260,
  alexa_sales: 2,
  alexa_customers: 1,
  alexa_leads: 4
})

function metrics(reports: ReportRow[], model: 'alice' | 'alexa'): number[] {
  return [
    reports.reduce((total, row) => total + revenue(row, model), 0),
    sum(reports, model === 'alice' ? 'alice_sales' : 'alexa_sales'),
    sum(reports, model === 'alice' ? 'alice_customers' : 'alexa_customers'),
    sum(reports, model === 'alice' ? 'alice_leads' : 'alexa_leads')
  ]
}

test('calculates Alice and Alexa independently, including a balance decrease', () => {
  assert.deepEqual(metrics([first, second], 'alice'), [20, 3, 2, 8])
  assert.deepEqual(metrics([first, second], 'alexa'), [60, 6, 4, 11])
  assert.equal(revenue(second, 'alice'), -10)

  const aliceEdit = { ...second, alice_end_balance: 140, alice_sales: 8 }
  assert.deepEqual(metrics([first, aliceEdit], 'alice'), [40, 10, 2, 8])
  assert.deepEqual(metrics([first, aliceEdit], 'alexa'), [60, 6, 4, 11])

  const alexaEdit = { ...second, alexa_end_balance: 230, alexa_leads: 1 }
  assert.deepEqual(metrics([first, alexaEdit], 'alice'), [20, 3, 2, 8])
  assert.deepEqual(metrics([first, alexaEdit], 'alexa'), [30, 6, 4, 8])

  assert.deepEqual(metrics([], 'alice'), [0, 0, 0, 0])
  assert.deepEqual(metrics([report('empty', '2026-11-10')], 'alexa'), [0, 0, 0, 0])
})

const staffById = new Map<string, Staff>([
  ['anna', { id: 'anna', display_name: 'Анна Иванова', role: 'chatter' }],
  ['boris', { id: 'boris', display_name: 'Борис Волков', role: 'chatter' }]
])
const today = new Date(2026, 10, 17, 12)
const all = { period: 'all', person: 'all', shift: 'all', search: '' } as const

test('includes the first local day of each history period and preserves input order', () => {
  const history = [
    second,
    first,
    report('before-week', '2026-11-10'),
    report('start-of-month', '2026-11-01'),
    report('before-month', '2026-10-31'),
    report('start-of-30-days', '2026-10-19'),
    report('before-30-days', '2026-10-18')
  ]
  assert.deepEqual(filterReports(history, { ...all, period: '7' }, staffById, today), [
    second,
    first
  ])
  assert.deepEqual(
    filterReports(history, { ...all, period: 'month' }, staffById, today),
    history.slice(0, 4)
  )
  assert.deepEqual(
    filterReports(history, { ...all, period: '30' }, staffById, today),
    history.slice(0, 6)
  )
  assert.deepEqual(filterReports(history, all, staffById, today), history)
})

test('applies person, shift, date and case-insensitive Cyrillic search to history', () => {
  const night = report('night', second.report_date, { shift_type: 'night' })
  const other = report('other', second.report_date, { staff_id: 'boris', shift_type: 'night' })
  const history = [second, night, other, first]

  assert.deepEqual(
    filterReports(
      history,
      { ...all, person: 'anna', shift: 'night', search: 'ИВАНОВА' },
      staffById,
      today
    ),
    [night]
  )
  assert.deepEqual(filterReports(history, { ...all, search: '2026-11-17' }, staffById, today), [
    second,
    night,
    other
  ])
  assert.deepEqual(
    filterReports(history, { ...all, search: shiftLabels.night }, staffById, today),
    [night, other]
  )
  assert.deepEqual(
    filterReports(history, { ...all, person: 'boris', shift: 'day' }, staffById, today),
    []
  )
})

test('indexes multiple reports on the same calendar date and retains adjacent months', () => {
  const other = report('other', second.report_date, { staff_id: 'boris', shift_type: 'night' })
  const previous = report('previous', '2026-10-31')
  const next = report('next', '2026-11-01')
  const reports = [second, previous, next, other]
  assert.deepEqual(
    [...indexReportsByDate(reports, 'all')],
    [
      ['2026-11-17', [second, other]],
      ['2026-10-31', [previous]],
      ['2026-11-01', [next]]
    ]
  )
  assert.deepEqual([...indexReportsByDate(reports, 'boris')], [['2026-11-17', [other]]])
  assert.equal(indexReportsByDate(reports, 'unknown').size, 0)
})

test('exports selected history rows with separate model columns and escaped Cyrillic names', () => {
  const other = report('other', second.report_date, { staff_id: 'boris' })
  const blank = report('blank', '2026-11-12')
  const selected = filterReports(
    [other, second, blank],
    { ...all, person: 'anna', period: '7' },
    staffById,
    today
  )
  const header =
    '\uFEFFДата,Смена,Сотрудник,Alice начало,Alice конец,Alice продажи,Alice покупатели,Alice лиды,Alexa начало,Alexa конец,Alexa продажи,Alexa покупатели,Alexa лиды'
  const expected = [
    header,
    '"2026-11-17","day","Анна, ""Аня""\nИванова","130","120","1","1","3","240","260","2","1","4"',
    '"2026-11-12","day","Анна, ""Аня""\nИванова","","","","","","","","","",""'
  ].join('\r\n')
  assert.equal(
    createReportsCsv(selected, () => 'Анна, "Аня"\nИванова'),
    expected
  )
  assert.equal(
    createReportsCsv([], () => ''),
    header
  )
})

test('neutralizes formula-like staff names and preserves numeric fields', () => {
  const row = { ...second, alice_end_balance: -10 }
  const expectedMetrics = '"130","-10","1","1","3","240","260","2","1","4"'
  const firstRow = (name: string): string =>
    createReportsCsv([row], () => name).slice(createReportsCsv([], () => '').length + 2)

  for (const name of [
    '=1+1',
    '+2',
    '-3',
    '@SUM(1)',
    '＝1+1',
    '＋2',
    '－3',
    '＠SUM(1)',
    '  =1+1',
    '  ＝1+1',
    '\tИмя',
    '\rИмя',
    '\nИмя'
  ]) {
    assert.equal(
      firstRow(name),
      ['"2026-11-17"', '"day"', '"\'' + name + '"', expectedMetrics].join(',')
    )
  }

  assert.equal(firstRow('Анна - Аня'), '"2026-11-17","day","Анна - Аня",' + expectedMetrics)
})

test('neutralizes formula-like dates and shifts from malformed historical rows', () => {
  const historical = {
    ...second,
    report_date: '  ＋1',
    // A historical API response may contain a value outside the current Shift type.
    shift_type: '@SUM(1)' as ReportRow['shift_type'],
    alice_end_balance: -10
  }
  const csv = createReportsCsv([historical], () => 'Анна')
  const [, exportedRow] = csv.split('\r\n')

  assert.equal(
    exportedRow,
    '"\'  ＋1","\'@SUM(1)","Анна","130","-10","1","1","3","240","260","2","1","4"'
  )
})
