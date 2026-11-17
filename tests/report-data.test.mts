import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  loadReports,
  loadTeam,
  type ReportRow,
  type Staff
} from '../src/renderer/src/lib/report-data.ts'

type ReportFixture = Pick<ReportRow, 'id' | 'staff_id' | 'report_date'>
type Scope = Parameters<typeof loadReports>[1]

type PageRequest = {
  path: string
  columns: string | null
  order: string | null
  staff: string | null
  cursor: string | null
  limit: number
  authorization: string | null
  signal?: AbortSignal | null
}

type StubOptions = {
  serverLimit?: number
  onRequest?: (request: PageRequest, number: number, scope: Scope) => Response | void
}

function createReports(count: number): ReportFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1).padStart(5, '0'),
    staff_id: index % 2 === 0 ? 'my-staff' : 'other-staff',
    report_date: index % 3 === 0 ? '2026-11-16' : '2026-11-17'
  })).reverse()
}

function stubRows(
  rows: (ReportFixture | Staff)[],
  { serverLimit = 1000, onRequest }: StubOptions = {}
): { client: SupabaseClient; requests: PageRequest[]; scope: Scope } {
  const scope = {
    userId: 'my-staff',
    accessToken: 'active-token',
    controller: new AbortController()
  }
  const requests: PageRequest[] = []
  const client = createClient('https://aura.test.invalid', 'test-api-key', {
    accessToken: async () => 'sdk-token',
    global: {
      async fetch(input, init) {
        const url = new URL(input instanceof Request ? input.url : input)
        const request: PageRequest = {
          path: url.pathname,
          columns: url.searchParams.get('select'),
          order: url.searchParams.get('order'),
          staff: url.searchParams.get('staff_id'),
          cursor: url.searchParams.get('id'),
          limit: Number(url.searchParams.get('limit')),
          authorization: new Headers(init?.headers).get('authorization'),
          signal: init?.signal
        }
        requests.push(request)
        const response = onRequest?.(request, requests.length, scope)
        if (response) return response

        const after = request.cursor?.slice('gt.'.length)
        const staffId = request.staff?.slice('eq.'.length)
        const page = rows
          .filter(
            (row) =>
              (!after || row.id > after) &&
              (!staffId || ('staff_id' in row && row.staff_id === staffId))
          )
          .sort((left, right) => left.id.localeCompare(right.id))
          .slice(0, Math.min(serverLimit, request.limit))
        return Response.json(page)
      }
    }
  })
  return { client, requests, scope }
}

test('loads every matching report under a lower server limit and preserves date order', async () => {
  const reports = createReports(5007)
  const { client, requests, scope } = stubRows(reports, { serverLimit: 117 })

  const result = await loadReports(client, scope, false)

  const expected = reports
    .filter((report) => report.staff_id === scope.userId)
    .sort(
      (left, right) =>
        right.report_date.localeCompare(left.report_date) || left.id.localeCompare(right.id)
    )
  assert.deepEqual(result, expected)
  assert.equal(result.length, 2504)
  assert.equal(requests[0].cursor, null)
  assert.equal(requests[1].cursor, 'gt.00233')
  assert.equal(requests.at(-1)?.cursor, 'gt.05007')
  assert.ok(requests.every(({ path }) => path === '/rest/v1/shift_reports'))
  assert.ok(requests.every(({ order }) => order === 'id.asc'))
  assert.ok(requests.every(({ staff }) => staff === 'eq.my-staff'))
  assert.ok(requests.every(({ authorization }) => authorization === 'Bearer active-token'))
})

test('loads both staff members for a leader with the current token on each page', async () => {
  const { client, requests, scope } = stubRows(createReports(2), {
    serverLimit: 1,
    onRequest(_request, number, scope) {
      if (number === 1) scope.accessToken = 'refreshed-token'
    }
  })

  const result = await loadReports(client, scope, true)

  assert.deepEqual(
    result.map(({ staff_id }) => staff_id),
    ['other-staff', 'my-staff']
  )
  assert.ok(requests.every(({ staff }) => staff === null))
  assert.deepEqual(
    requests.map(({ authorization }) => authorization),
    ['Bearer active-token', 'Bearer refreshed-token', 'Bearer refreshed-token']
  )
})

test('loads every staff page for the team and sorts by display name', async () => {
  const alpha = { id: '2', display_name: 'Alpha', role: 'chatter' }
  const beta = { id: '1', display_name: 'Beta', role: 'leader' }
  const gamma = { id: '3', display_name: 'Gamma', role: 'chatter' }
  const { client, requests, scope } = stubRows([gamma, alpha, beta], { serverLimit: 1 })

  assert.deepEqual(await loadTeam(client, scope), [alpha, beta, gamma])
  assert.deepEqual(
    requests.map(({ cursor }) => cursor),
    [null, 'gt.1', 'gt.2', 'gt.3']
  )
  assert.ok(requests.every(({ path }) => path === '/rest/v1/staff'))
  assert.ok(requests.every(({ columns }) => columns === 'id,display_name,role'))
  assert.ok(requests.every(({ staff }) => staff === null))
  assert.ok(requests.every(({ authorization }) => authorization === 'Bearer active-token'))
})

test('rejects a later page error instead of returning partial reports', async () => {
  const { client, requests, scope } = stubRows(createReports(3), {
    serverLimit: 1,
    onRequest(_request, number) {
      if (number === 2) return Response.json({ message: 'Page rejected' }, { status: 403 })
    }
  })

  await assert.rejects(loadReports(client, scope, true), /Page rejected/)
  assert.equal(requests.length, 2)
})

test('rejects a repeated cursor instead of requesting the same page indefinitely', async () => {
  const [report] = createReports(1)
  const { client, requests, scope } = stubRows([], {
    onRequest() {
      return Response.json([report])
    }
  })

  await assert.rejects(loadReports(client, scope, true), /следующей странице/)
  assert.equal(requests.length, 2)
})

test('an already closed session sends no page requests', async () => {
  const { client, requests, scope } = stubRows(createReports(1))
  scope.controller.abort()

  await assert.rejects(loadReports(client, scope, false), { name: 'AbortError' })
  assert.equal(requests.length, 0)
})

test('cancellation during a page aborts the fetch and prevents publishing partial reports', async () => {
  const controller = new AbortController()
  const { client, requests, scope } = stubRows(createReports(3), {
    serverLimit: 1,
    onRequest(_request, number) {
      if (number === 2) controller.abort()
    }
  })

  await assert.rejects(loadReports(client, scope, true, controller.signal), { name: 'AbortError' })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].signal?.aborted, true)
  assert.equal(scope.controller.signal.aborted, false)
})
