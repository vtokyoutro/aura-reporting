/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test in JavaScript. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const workspace = new URL('../src/renderer/src/', import.meta.url)
const motionComponents = {
  MotionProvider: 'fragment',
  SectionTransition: 'section',
  MotionCard: 'section',
  MotionButton: 'button',
  MotionDialog: 'dialog'
}
const syntheticDraft = JSON.stringify({
  date: '2026-11-17',
  shift: 'day',
  alice: { startingBalance: '10', endingBalance: '20', sales: '2', customers: '1', leads: '4' },
  alexa: { startingBalance: '30', endingBalance: '60', sales: '3', customers: '2', leads: '5' }
})

function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function turn() {
  return new Promise((resolve) => setImmediate(resolve))
}

function jsx(type, props, key) {
  return { type, props, key }
}

function find(node, matches) {
  if (Array.isArray(node)) return node.map((child) => find(child, matches)).find(Boolean)
  if (!node?.props) return undefined
  return matches(node) ? node : find(node.props.children, matches)
}

function named(node, name) {
  return find(node, (element) => element.type?.name === name)
}

function form(node) {
  return find(node, (element) => element.type === 'form')
}

function button(node, label) {
  return find(node, (element) => {
    if (element.type !== 'button') return false
    if (element.props['aria-label'] === label) return true
    return textOf(element).trim() === label
  })
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node?.props ? textOf(node.props.children) : ''
}

function field(node, label) {
  const wrapper = find(
    node,
    (element) =>
      element.type === 'label' &&
      Boolean(find(element, (child) => child.type === 'span' && child.props.children === label))
  )
  return find(wrapper, (element) => element.type === 'input' || element.type === 'select')
}

// Execute the app's handlers and effects with synchronous hook state and synthetic events.
function hookHarness() {
  const instances = new Map()
  let current

  function useSlot(initializer) {
    const { hooks, index } = current
    current.index += 1
    hooks[index] ??= initializer()
    return hooks[index]
  }

  function useEffect(effect, deps) {
    const slot = useSlot(() => ({}))
    if (!slot.deps || deps.some((value, index) => value !== slot.deps[index])) {
      slot.deps = deps
      current.effects.push(() => {
        slot.cleanup?.()
        slot.cleanup = effect()
      })
    }
  }

  function useMemo(calculate, deps) {
    const slot = useSlot(() => ({}))
    if (!slot.deps || deps.some((value, index) => value !== slot.deps[index])) {
      slot.deps = deps
      slot.value = calculate()
    }
    return slot.value
  }

  return {
    hooks: {
      useCallback: (callback, deps) => useMemo(() => callback, deps),
      useEffect,
      useEffectEvent: (callback) => callback,
      useLayoutEffect: useEffect,
      useMemo,
      useRef: (value) => useSlot(() => ({ current: value })),
      useState(initial) {
        const slot = useSlot(() => ({
          value: typeof initial === 'function' ? initial() : initial
        }))
        return [
          slot.value,
          (update) => {
            slot.value = typeof update === 'function' ? update(slot.value) : update
          }
        ]
      }
    },
    render(id, element) {
      const hooks = instances.get(id) ?? []
      instances.set(id, hooks)
      current = { hooks, index: 0, effects: [] }
      const output = element.type(element.props)
      const { effects } = current
      current = undefined
      effects.forEach((effect) => effect())
      return output
    },
    unmount(id) {
      for (const hook of instances.get(id) ?? []) hook.cleanup?.()
      instances.delete(id)
    }
  }
}

function setup(avatarStorage = null) {
  const harness = hookHarness()
  const requests = []
  const attempts = []
  const draftReads = []
  const storage = new Map()
  const downloads = []
  const downloadUrls = new Map()
  const initialSession = deferred()
  const loginResult = deferred()
  const windowEvents = new EventTarget()
  let authListener
  let confirmation = () => false
  let unsubscribed = false

  const client = {
    auth: {
      onAuthStateChange(listener) {
        authListener = listener
        return {
          data: {
            subscription: {
              unsubscribe() {
                unsubscribed = true
              }
            }
          }
        }
      },
      getSession: () => initialSession.promise,
      signInWithPassword(credentials) {
        attempts.push(credentials)
        return loginResult.promise
      }
    },
    from(table) {
      const result = deferred()
      const request = {
        table,
        operation: 'select',
        filters: {},
        headers: {},
        complete: (data) => result.resolve({ data, error: null })
      }
      return {
        select() {
          return this
        },
        order() {
          return this
        },
        limit() {
          return this
        },
        eq(column, value) {
          request.filters[column] = value
          return this
        },
        gt(column, value) {
          request.filters[column] = value
          return this
        },
        single() {
          return this
        },
        maybeSingle() {
          return this
        },
        overrideTypes() {
          return this
        },
        setHeader(name, value) {
          request.headers[name] = value
          return this
        },
        abortSignal(signal) {
          request.signal = signal
          return this
        },
        insert() {
          request.operation = 'insert'
          return this
        },
        update() {
          request.operation = 'update'
          return this
        },
        then(resolve, reject) {
          requests.push(request)
          return result.promise.then(resolve, reject)
        }
      }
    }
  }

  const dependencies = {
    react: { ...harness.hooks, useId: () => 'test-profile-id' },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    'motion/react': {
      AnimatePresence: 'fragment',
      LayoutGroup: 'fragment',
      LazyMotion: 'fragment',
      domMax: {},
      useReducedMotion: () => true,
      useMotionValue(initial) {
        const state = harness.hooks.useRef(initial)
        return {
          get: () => state.current,
          set: (value) => {
            state.current = value
          }
        }
      },
      useTransform: (value, transform) => ({ get: () => transform(value.get()) }),
      animate(value, target) {
        value.set(target)
        return { stop: () => undefined }
      }
    },
    'motion/react-m': new Proxy({}, { get: (_target, tag) => tag }),
    './lib/supabase': { supabase: client }
  }
  const modules = new Map()

  function loadModule(path) {
    if (modules.has(path.href)) return modules.get(path.href)
    const source = readFileSync(path, 'utf8')
    const content = path.pathname.endsWith('/avatar-client.ts')
      ? source.replaceAll('import.meta.env', '({})')
      : source
    const { outputText } = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022
      }
    })
    const exports = {}
    runInNewContext(outputText, {
      exports,
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        assert.ok(name.startsWith('.'), 'Unexpected test import: ' + name)
        const url = new URL(name, path)
        assert.ok(url.href.startsWith(workspace.href), 'Import outside test workspace: ' + name)
        if (url.pathname.endsWith('.css')) return {}
        if (url.pathname.endsWith('/lib/avatar-client')) return { avatarStorage }
        if (avatarStorage && url.pathname.endsWith('/lib/avatar-image'))
          return {
            prepareAvatar: async (file) => file,
            avatarDataUrl: async (image) => image.source
          }
        if (url.pathname.endsWith('/lib/supabase')) return dependencies['./lib/supabase']
        if (url.pathname.endsWith('/components/WorkspaceMotion')) return motionComponents
        const module = [url, new URL(url.href + '.tsx'), new URL(url.href + '.ts')].find(
          (candidate) => existsSync(candidate)
        )
        assert.ok(module, 'Missing test import: ' + name)
        return loadModule(module)
      },
      AbortController,
      AbortSignal,
      Blob,
      URL: {
        createObjectURL(blob) {
          const url = 'blob:synthetic-' + downloadUrls.size
          downloadUrls.set(url, blob)
          return url
        },
        revokeObjectURL: (url) => downloadUrls.delete(url)
      },
      document: {
        createElement(tag) {
          assert.equal(tag, 'a')
          return {
            click() {
              downloads.push({ name: this.download, blob: downloadUrls.get(this.href) })
            }
          }
        }
      },
      FormData: class {
        constructor(fields) {
          this.fields = fields
        }
        get(name) {
          return this.fields[name]
        }
      },
      localStorage: {
        getItem(key) {
          draftReads.push(key)
          return storage.get(key) ?? null
        },
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key)
      },
      window: {
        confirm: () => confirmation(),
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents)
      }
    })
    modules.set(path.href, exports)
    return exports
  }

  const { default: App } = loadModule(new URL('App.tsx', workspace))
  const app = () => harness.render('app', { type: App, props: {} })
  app()

  return {
    app,
    attempts,
    downloads,
    draftReads,
    initialSession,
    loginResult,
    requests,
    storage,
    prepareConfirmation(callback) {
      confirmation = callback
    },
    emit(event, session = null) {
      authListener(event, session)
    },
    render(element) {
      return harness.render(element.key ?? element.type.name, element)
    },
    unmount(id) {
      harness.unmount(id)
    },
    dispose() {
      harness.unmount('app')
      assert.equal(unsubscribed, true)
    }
  }
}

function session(userId, token = userId + '-token') {
  return { user: { id: userId, email: userId + '@example.invalid' }, access_token: token }
}

test('late avatar GET after sign-out cannot overwrite the next account avatar', async () => {
  const reads = []
  const app = setup({
    load: (scope) => {
      const response = deferred()
      reads.push({ scope, response })
      return response.promise
    }
  })
  const first = await startProfile(app, 'first', 'leader')
  const profileA = named(app.render(first.workspaceElement), 'ProfileMenu')
  app.render({ ...profileA, key: 'profile-a' })
  app.emit('SIGNED_OUT')
  assert.equal(reads[0].scope.controller.signal.aborted, true)
  const second = await startProfile(app, 'second', 'chatter')
  const profileB = named(app.render(second.workspaceElement), 'ProfileMenu')
  app.render({ ...profileB, key: 'profile-b' })
  reads[1].response.resolve({ source: 'data:new-account' })
  await turn()
  reads[0].response.resolve({ source: 'data:old-account' })
  await turn()
  assert.equal(
    named(app.render(second.workspaceElement), 'ProfileMenu').props.avatar,
    'data:new-account'
  )
  app.dispose()
})

for (const action of ['save', 'remove']) {
  test(`late CDN avatar GET cannot undo successful ${action}`, async () => {
    const response = deferred()
    const app = setup({
      load: () => response.promise,
      save: async () => {},
      remove: async () => {}
    })
    const account = await startProfile(app, 'owner', 'leader')
    let value = 'data:original'
    const profile = {
      ...named(app.render(account.workspaceElement), 'ProfileMenu'),
      key: 'race-profile'
    }
    profile.props = {
      ...profile.props,
      avatar: value,
      onAvatarChange: (next) => {
        value = next
      }
    }
    let view = app.render(profile)
    if (action === 'save') {
      find(view, (node) => node.type === 'input' && node.props.type === 'file').props.onChange({
        currentTarget: { files: [{ source: 'data:replacement' }], value: 'fixture' }
      })
      await turn()
      view = app.render(profile)
      button(view, 'Сохранить').props.onClick()
    } else {
      app.prepareConfirmation(() => true)
      button(view, 'Удалить').props.onClick()
    }
    await turn()
    assert.equal(value, action === 'save' ? 'data:replacement' : null)
    response.resolve({ source: 'data:stale-cdn-bytes' })
    await turn()
    assert.equal(value, action === 'save' ? 'data:replacement' : null)
    app.dispose()
  })
}

test('unmounting team directory cancels its reads and discards late results after reopening', async () => {
  const reads = []
  const app = setup({
    load: (scope, target) => {
      const response = deferred()
      reads.push({ scope, target, response })
      return response.promise
    }
  })
  const account = await startProfile(app, 'leader', 'leader')
  account.dataRequests
    .find((entry) => entry.table === 'staff')
    .complete([{ id: 'member', display_name: 'Member', role: 'chatter' }])
  account.dataRequests.find((entry) => entry.table === 'shift_reports').complete([])
  await turn()
  app.requests.at(-1).complete([])
  await turn()
  button(app.render(account.workspaceElement), 'Команда').props.onClick()
  const directory = named(app.render(account.workspaceElement), 'TeamDirectory')
  app.render({ ...directory, key: 'directory' })
  assert.equal(reads.length, 1)
  app.unmount('directory')
  assert.equal(reads[0].scope.controller.signal.aborted, true)
  app.render({ ...directory, key: 'directory-reopened' })
  reads[1].response.resolve({ source: 'data:fresh' })
  await turn()
  reads[0].response.resolve({ source: 'data:stale' })
  await turn()
  const view = app.render({ ...directory, key: 'directory-reopened' })
  assert.equal(named(view, 'UserAvatar').props.avatar, 'data:fresh')
  app.dispose()
})

async function startProfile(app, userId, role) {
  const requestIndex = app.requests.length
  app.emit('SIGNED_IN', session(userId))
  const workspaceElement = named(app.app(), 'Workspace')
  app.render(workspaceElement)
  await turn()

  const profile = app.requests[requestIndex]
  assert.equal(profile.table, 'staff')
  assert.equal(profile.filters.id, userId)
  assert.equal(profile.headers.Authorization, 'Bearer ' + userId + '-token')
  profile.complete({ id: userId, display_name: userId, role })
  await turn()
  return { workspaceElement, dataRequests: app.requests.slice(requestIndex + 1) }
}

function submitEvent(email = '') {
  return { currentTarget: { email }, preventDefault: () => undefined }
}

function syntheticReports(staffId, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: 'report-' + String(index + 1).padStart(3, '0'),
    staff_id: staffId,
    report_date: index === 0 ? '2025-10-31' : '2025-11-01',
    shift_type: 'day'
  }))
}

function reportTable(app, tree) {
  return app.render(named(tree, 'ReportTable'))
}

function dashboard(app, tree) {
  return app.render(named(tree, 'DashboardView'))
}

function modelStats(tree, label) {
  const card = find(
    tree,
    (element) => element.type === 'section' && element.props['aria-label'] === label
  )
  assert.ok(card, 'Expected dashboard model card: ' + label)
  const balance = find(card, (element) => element.type === 'strong')
  const breakdown = find(card, (element) => element.type === 'dl')
  const metrics = [breakdown.props.children].flat().map((entry) => {
    return textOf(find(entry, (element) => element.type === 'dd'))
  })
  return [textOf(balance), ...metrics]
}

function dashboardCount(app, tree) {
  const count = app.render(named(tree, 'ReportCount'))
  return textOf(find(count, (element) => element.props.className === 'sr-only'))
}

function tableRows(tree) {
  const body = find(tree, (element) => element.type === 'tbody')
  assert.ok(body, 'Expected a report table')
  return [body.props.children].flat().filter((element) => element?.type === 'tr')
}

test('updates dashboard reports by period while keeping today activity scoped to today', async () => {
  const app = setup()
  const now = new Date()
  const todayDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  const [current, older] = syntheticReports('chatter', 2)
  const reports = [
    {
      ...current,
      report_date: todayDate,
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
    },
    {
      ...older,
      report_date: '2020-01-01',
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
    }
  ]
  const { workspaceElement, dataRequests } = await startProfile(app, 'chatter', 'chatter')
  dataRequests[0].complete(reports)
  await turn()
  app.requests.at(-1).complete([])
  await turn()

  const screen = () => app.render(workspaceElement)
  const dashboardProps = () => named(screen(), 'DashboardView').props
  assert.equal(dashboardProps().isLeader, false)
  assert.equal(dashboardProps().period, 'month')
  assert.deepEqual(
    Array.from(dashboardProps().rows, (row) => row.id),
    ['report-001']
  )
  assert.deepEqual(
    Array.from(dashboardProps().todayReports, (row) => row.id),
    ['report-001']
  )

  const monthView = dashboard(app, screen())
  assert.equal(button(monthView, 'Месяц').props['aria-pressed'], true)
  assert.equal(field(monthView, 'Сотрудник'), undefined)
  assert.equal(dashboardCount(app, monthView), '1')
  assert.deepEqual(modelStats(monthView, 'Alice'), ['$30.00', '2', '1', '5'])
  assert.deepEqual(modelStats(monthView, 'Alexa'), ['$40.00', '4', '3', '7'])
  button(monthView, 'Всё время').props.onClick()
  assert.equal(dashboardProps().period, 'all')
  assert.deepEqual(
    Array.from(dashboardProps().rows, (row) => row.id),
    ['report-001', 'report-002']
  )
  assert.deepEqual(
    Array.from(dashboardProps().todayReports, (row) => row.id),
    ['report-001']
  )
  const allTimeView = dashboard(app, screen())
  assert.equal(button(allTimeView, 'Всё время').props['aria-pressed'], true)
  assert.equal(dashboardCount(app, allTimeView), '2')
  assert.deepEqual(modelStats(allTimeView, 'Alice'), ['$20.00', '3', '2', '8'])
  assert.deepEqual(modelStats(allTimeView, 'Alexa'), ['$60.00', '6', '4', '11'])

  button(screen(), 'Создать отчёт').props.onClick()
  assert.ok(form(screen()))
  assert.equal(named(screen(), 'DashboardView'), undefined)
  app.dispose()
})

test('paginates filtered history while exporting every matching report', async () => {
  const app = setup()
  const reports = syntheticReports('chatter', 51)
  const { workspaceElement, dataRequests } = await startProfile(app, 'chatter', 'chatter')
  dataRequests[0].complete(reports)
  await turn()
  app.requests.at(-1).complete([])
  await turn()

  const screen = () => app.render(workspaceElement)
  let focuses = 0
  const landmark = find(screen(), (element) => element.type === 'main')
  assert.equal(landmark.props.tabIndex, -1)
  landmark.props.ref.current = {
    focus() {
      focuses += 1
    }
  }
  button(screen(), 'История отчётов').props.onClick()
  field(screen(), 'Период').props.onChange({
    target: { value: 'all' }
  })

  const table = () => reportTable(app, screen())
  const paging = (table, label) => button(app.render(named(table, 'Pagination')), label)
  const previous = 'Предыдущая страница отчётов'
  const next = 'Следующая страница отчётов'
  const firstPage = table()
  assert.equal(focuses, 1)
  assert.equal(tableRows(firstPage).length, 25)
  assert.equal(paging(firstPage, previous).props.disabled, true)
  paging(firstPage, next).props.onClick()

  const secondPage = table()
  assert.equal(tableRows(secondPage).length, 25)
  const pageIds = [...tableRows(firstPage), ...tableRows(secondPage)].map((row) => row.key)
  assert.equal(new Set(pageIds).size, 50)
  paging(secondPage, next).props.onClick()

  const lastPage = table()
  assert.equal(tableRows(lastPage).length, 1)
  assert.equal(paging(lastPage, next).props.disabled, true)
  assert.ok(!pageIds.includes(tableRows(lastPage)[0].key))

  button(screen(), 'Экспорт CSV').props.onClick()
  assert.equal(app.downloads.length, 1)
  const download = app.downloads[0]
  assert.equal(download.name, 'AURA_reports.csv')
  assert.equal((await download.blob.text()).split('\r\n').length, reports.length + 1)

  field(screen(), 'Поиск').props.onChange({
    target: { value: '2025-11-01' }
  })
  const filteredPage = table()
  assert.equal(tableRows(filteredPage).length, 25)
  assert.equal(paging(filteredPage, previous).props.disabled, true)
  assert.equal(focuses, 1)
  button(screen(), 'Экспорт CSV').props.onClick()
  assert.equal((await app.downloads[1].blob.text()).split('\r\n').length, reports.length)

  field(screen(), 'Поиск').props.onChange({
    target: { value: 'nonexistent' }
  })
  const emptyPage = table()
  assert.ok(find(emptyPage, (element) => element.props.role === 'status'))
  assert.equal(named(emptyPage, 'Pagination'), undefined)
  app.dispose()
})

test('gates team navigation by role and follows the last selected section', async () => {
  const app = setup()
  const leader = await startProfile(app, 'lead', 'leader')
  const staff = Array.from({ length: 13 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return { id: 'employee-' + number, display_name: 'Employee ' + number, role: 'chatter' }
  })
  for (const request of leader.dataRequests) {
    request.complete(request.table === 'staff' ? staff : [])
  }
  await turn()
  app.requests.at(-1).complete([])
  await turn()

  const screen = () => app.render(leader.workspaceElement)
  assert.equal(field(dashboard(app, screen()), 'Сотрудник').props.value, 'all')
  button(screen(), 'Команда').props.onClick()
  const directory = () => app.render(named(screen(), 'TeamDirectory'))
  const firstTeamPage = directory()
  assert.ok(button(firstTeamPage, 'Отчёты сотрудника Employee 01'))
  assert.equal(button(firstTeamPage, 'Отчёты сотрудника Employee 13'), undefined)
  const teamPaging = app.render(named(firstTeamPage, 'Pagination'))
  button(teamPaging, 'Следующая страница сотрудников').props.onClick()
  button(directory(), 'Отчёты сотрудника Employee 13').props.onClick()
  const employeeFilter = field(screen(), 'Сотрудник')
  assert.equal(employeeFilter.props.value, 'employee-13')
  assert.ok(button(screen(), 'Экспорт CSV'))

  button(screen(), 'История отчётов').props.onClick()
  button(screen(), 'Календарь').props.onClick()
  button(screen(), 'Аналитика').props.onClick()
  assert.ok(named(screen(), 'ModelAnalytics'))
  assert.equal(button(screen(), 'Аналитика').props['aria-current'], 'page')
  assert.equal(button(screen(), 'Календарь').props['aria-current'], undefined)
  assert.equal(button(screen(), 'Экспорт CSV'), undefined)

  app.emit('SIGNED_OUT')
  assert.ok(named(app.app(), 'LoginForm'))
  assert.equal(named(app.app(), 'Workspace'), undefined)
  const chatter = await startProfile(app, 'chatter', 'chatter')
  chatter.dataRequests[0].complete([])
  await turn()
  assert.equal(button(app.render(chatter.workspaceElement), 'Команда'), undefined)
  assert.equal(named(app.render(chatter.workspaceElement), 'ModelAnalytics'), undefined)
  app.dispose()
})

test('opens all reports of a calendar day despite a previous history shift filter', async () => {
  const app = setup()
  const now = new Date()
  const selectedDate = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  const reports = syntheticReports('lead', 2).map((report, index) => ({
    ...report,
    report_date: selectedDate,
    staff_id: index === 0 ? 'lead' : 'employee',
    shift_type: index === 0 ? 'day' : 'night'
  }))
  const { workspaceElement, dataRequests } = await startProfile(app, 'lead', 'leader')
  for (const request of dataRequests) {
    request.complete(request.table === 'shift_reports' ? reports : [])
  }
  await turn()
  app.requests.at(-1).complete([])
  await turn()

  const screen = () => app.render(workspaceElement)
  button(screen(), 'История отчётов').props.onClick()
  field(screen(), 'Смена').props.onChange({ target: { value: 'morning' } })
  button(screen(), 'Календарь').props.onClick()
  button(screen(), 'Все отчёты дня').props.onClick()
  assert.equal(field(screen(), 'Смена').props.value, 'all')
  assert.equal(field(screen(), 'Поиск').props.value, selectedDate)
  assert.deepEqual(
    tableRows(reportTable(app, screen())).map((row) => row.key),
    reports.map((row) => row.id)
  )
  app.dispose()
})

test('clears the password before sign-in completes and prevents duplicate submission', async () => {
  const app = setup()
  app.emit('INITIAL_SESSION')
  const login = named(app.app(), 'LoginForm')
  const tree = app.render(login)
  const field = find(tree, (element) => element.props.type === 'password')
  const password = { value: 'synthetic-password' }
  field.props.ref.current = password

  const request = form(tree).props.onSubmit(submitEvent(' user@example.invalid '))
  assert.equal(password.value, '')
  assert.equal(app.attempts[0].email, 'user@example.invalid')
  assert.equal(app.attempts[0].password, 'synthetic-password')
  await form(tree).props.onSubmit(submitEvent())
  assert.equal(app.attempts.length, 1)

  app.loginResult.resolve({ error: { message: 'Simulated rejection' } })
  await request
  const rejected = app.render(login)
  assert.ok(find(rejected, (element) => element.props.role === 'alert'))
  assert.equal(find(rejected, (element) => element.props.type === 'password').props.disabled, false)
  assert.equal(password.value, '')
  app.dispose()
})

test('isolates delayed requests, refreshed tokens and drafts across accounts', async () => {
  const app = setup()
  app.storage.set('aura-draft-v05-lead', syntheticDraft)

  const leader = await startProfile(app, 'lead', 'leader')
  assert.deepEqual(leader.dataRequests.map((request) => request.table).sort(), [
    'shift_reports',
    'staff'
  ])
  const leaderScope = leader.workspaceElement.props.scope
  assert.ok(
    leader.dataRequests.every(
      (request) => request.headers.Authorization === 'Bearer lead-token' && !request.signal.aborted
    )
  )

  app.emit('TOKEN_REFRESHED', session('lead', 'lead-refreshed'))
  assert.equal(named(app.app(), 'Workspace').props.scope, leaderScope)
  assert.equal(leaderScope.accessToken, 'lead-refreshed')
  assert.equal(leaderScope.controller.signal.aborted, false)
  app.emit('SIGNED_OUT')
  assert.ok(leader.dataRequests.every((request) => request.signal.aborted))
  assert.ok(named(app.app(), 'LoginForm'))

  const chatter = await startProfile(app, 'chatter', 'chatter')
  assert.notEqual(chatter.workspaceElement.key, leader.workspaceElement.key)
  assert.equal(chatter.dataRequests.length, 1)
  assert.equal(chatter.dataRequests[0].filters.staff_id, 'chatter')
  assert.equal(chatter.dataRequests[0].headers.Authorization, 'Bearer chatter-token')

  app.emit('INITIAL_SESSION', session('lead', 'stale-event'))
  app.initialSession.resolve({
    data: { session: session('lead', 'stale-get-session') },
    error: null
  })
  for (const request of leader.dataRequests) {
    request.complete([{ id: 'stale', display_name: 'Stale leader data' }])
  }
  chatter.dataRequests[0].complete([])
  await turn()

  const latest = named(app.app(), 'Workspace')
  assert.equal(latest.props.scope.userId, 'chatter')
  assert.equal(button(dashboard(app, app.render(latest)), 'Продолжить'), undefined)
  assert.equal(button(app.render(latest), 'Команда'), undefined)
  assert.deepEqual(app.draftReads, ['aura-draft-v05-lead', 'aura-draft-v05-chatter'])
  assert.equal(app.storage.get('aura-draft-v05-lead'), syntheticDraft)
  app.dispose()
})

async function reportForm(app, userId) {
  app.storage.set('aura-draft-v05-' + userId, syntheticDraft)
  const { workspaceElement, dataRequests } = await startProfile(app, userId, 'chatter')
  dataRequests[0].complete([])
  await turn()
  button(dashboard(app, app.render(workspaceElement)), 'Продолжить').props.onClick()
  return form(app.render(workspaceElement))
}

test('keeps a restored report open when navigation is cancelled', async () => {
  const app = setup()
  await reportForm(app, 'chatter')
  const workspaceElement = named(app.app(), 'Workspace')
  const screen = () => app.render(workspaceElement)
  let prompts = 0
  app.prepareConfirmation(() => {
    prompts += 1
    return false
  })
  button(screen(), 'История отчётов').props.onClick()
  assert.ok(form(screen()))
  assert.equal(prompts, 1)

  app.prepareConfirmation(() => true)
  button(screen(), 'История отчётов').props.onClick()
  assert.equal(form(screen()), undefined)
  assert.ok(button(screen(), 'Экспорт CSV'))
  assert.equal(app.storage.get('aura-draft-v05-chatter'), syntheticDraft)
  app.dispose()
})

test('does not write when sign-out interrupts saving or report replacement is declined', async () => {
  const app = setup()
  let report = await reportForm(app, 'first')
  let start = app.requests.length
  let submission = report.props.onSubmit(submitEvent())
  await turn()
  const firstLookup = app.requests[start]
  assert.equal(firstLookup.table, 'staff')
  app.emit('SIGNED_OUT')
  firstLookup.complete({ id: 'first' })
  await submission
  assert.equal(firstLookup.signal.aborted, true)
  assert.equal(app.requests.length, start + 1)

  report = await reportForm(app, 'second')
  start = app.requests.length
  submission = report.props.onSubmit(submitEvent())
  await turn()
  app.requests[start].complete({ id: 'second' })
  await turn()
  const reportLookup = app.requests[start + 1]
  assert.equal(reportLookup.table, 'shift_reports')
  assert.equal(reportLookup.filters.staff_id, 'second')
  app.emit('SIGNED_OUT')
  reportLookup.complete(null)
  await submission
  assert.equal(app.requests.length, start + 2)

  report = await reportForm(app, 'third')
  for (const interrupted of [false, true]) {
    start = app.requests.length
    let confirmed = false
    app.prepareConfirmation(() => {
      confirmed = true
      if (interrupted) app.emit('SIGNED_OUT')
      return interrupted
    })
    submission = report.props.onSubmit(submitEvent())
    await turn()
    app.requests[start].complete({ id: 'third' })
    await turn()
    app.requests[start + 1].complete({ id: 'existing-report' })
    await submission
    assert.equal(confirmed, true)
    assert.equal(app.requests.length, start + 2)
  }
  assert.ok(app.requests.every((request) => request.operation === 'select'))
  app.dispose()
})
