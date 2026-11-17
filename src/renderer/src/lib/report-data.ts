import type { SupabaseClient } from '@supabase/supabase-js'

export type Shift = 'morning' | 'day' | 'night'
export type Staff = { id: string; display_name: string; role: string }

export type ReportRow = {
  id: string
  staff_id: string
  report_date: string
  shift_type: Shift
  created_at: string
  updated_at: string
  alice_start_balance: number | null
  alice_end_balance: number | null
  alice_sales: number | null
  alice_customers: number | null
  alice_leads: number | null
  alexa_start_balance: number | null
  alexa_end_balance: number | null
  alexa_sales: number | null
  alexa_customers: number | null
  alexa_leads: number | null
}

type DataLoadScope = {
  userId: string
  accessToken: string
  controller: AbortController
}

type PageQuery = {
  table: 'shift_reports' | 'staff'
  columns: string
  staffId?: string
}

const PAGE_SIZE = 500

async function loadRows<Row extends { id: string }>(
  client: SupabaseClient,
  scope: DataLoadScope,
  { table, columns, staffId }: PageQuery,
  requestSignal?: AbortSignal
): Promise<Row[]> {
  const sessionSignal = scope.controller.signal
  const signal = requestSignal ? AbortSignal.any([sessionSignal, requestSignal]) : sessionSignal
  const rows: Row[] = []
  let cursor: string | undefined

  while (true) {
    signal.throwIfAborted()
    const query = client
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)

    if (staffId !== undefined) query.eq('staff_id', staffId)
    if (cursor !== undefined) query.gt('id', cursor)

    const { data, error } = await query
      .setHeader('Authorization', `Bearer ${scope.accessToken}`)
      .abortSignal(signal)
      .overrideTypes<Row[], { merge: false }>()

    signal.throwIfAborted()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Не удалось загрузить данные.')

    // PostgREST may return fewer rows than requested when the project has a lower limit.
    if (data.length === 0) break
    const lastId = data[data.length - 1].id
    if (lastId == null || lastId === cursor) {
      throw new Error('Не удалось перейти к следующей странице.')
    }

    rows.push(...data)
    cursor = lastId
  }

  return rows
}

export async function loadReports(
  client: SupabaseClient,
  scope: DataLoadScope,
  isLeader: boolean,
  requestSignal?: AbortSignal
): Promise<ReportRow[]> {
  const reports = await loadRows<ReportRow>(
    client,
    scope,
    { table: 'shift_reports', columns: '*', staffId: isLeader ? undefined : scope.userId },
    requestSignal
  )
  return reports.sort((left, right) => right.report_date.localeCompare(left.report_date))
}

export async function loadTeam(
  client: SupabaseClient,
  scope: DataLoadScope,
  requestSignal?: AbortSignal
): Promise<Staff[]> {
  const staff = await loadRows<Staff>(
    client,
    scope,
    { table: 'staff', columns: 'id,display_name,role' },
    requestSignal
  )
  return staff.sort((left, right) => left.display_name.localeCompare(right.display_name))
}
