/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node test in JavaScript. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const workspace = new URL('../src/renderer/src/', import.meta.url)
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
    const children = [element.props.children].flat()
    return children.some((child) => typeof child === 'string' && child.trim() === label)
  })
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

function setup() {
  const harness = hookHarness()
  const requests = []
  const attempts = []
  const draftReads = []
  const storage = new Map()
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
    react: harness.hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    './lib/supabase': { supabase: client }
  }

  function loadModule(path) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(path, workspace), 'utf8'), {
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
        if (name === './lib/report-data') return loadModule('lib/report-data.ts')
        assert.ok(Object.hasOwn(dependencies, name), 'Unexpected test import: ' + name)
        return dependencies[name]
      },
      AbortController,
      AbortSignal,
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
    return exports
  }

  const { default: App } = loadModule('App.tsx')
  const app = () => harness.render('app', { type: App, props: {} })
  app()

  return {
    app,
    attempts,
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
    dispose() {
      harness.unmount('app')
      assert.equal(unsubscribed, true)
    }
  }
}

function session(userId, token = userId + '-token') {
  return { user: { id: userId, email: userId + '@example.invalid' }, access_token: token }
}

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
  assert.equal(button(app.render(latest), 'Продолжить'), undefined)
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
  button(app.render(workspaceElement), 'Продолжить').props.onClick()
  return form(app.render(workspaceElement))
}

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
