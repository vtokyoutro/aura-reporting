/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixtures. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { cac } from 'cac'

const source = readFileSync(new URL('./avatar-ui/entry.cjs', import.meta.url), 'utf8')
const directory = path.resolve('tests/avatar-ui')

function run(options = {}) {
  const preview = options.preview === true
  const profile = path.resolve(preview ? 'out/avatar-ui-preview-profile' : 'out/avatar-ui-profile')
  const script = preview
    ? readFileSync(new URL('./avatar-ui/preview.cjs', import.meta.url), 'utf8')
    : source
  const events = []
  const paths = {
    userData: options.collision ? profile : path.resolve('original-profile'),
    sessionData: path.resolve('original-profile')
  }
  let loaded = false
  const app = {
    isPackaged: options.packaged ?? false,
    isReady: () => options.ready ?? false,
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      events.push(name)
      if (!options.ignorePaths) paths[name] = value
    },
    setAppLogsPath: (value) => {
      events.push('logs')
      paths.logs = value
    }
  }
  const execute = () =>
    vm.runInNewContext(script, {
      __dirname: directory,
      URL,
      process: {
        defaultApp: options.defaultApp ?? true,
        env: preview
          ? {
              AURA_AVATAR_UI_PREVIEW: options.confirm ?? '1',
              ELECTRON_RENDERER_URL: options.url ?? ''
            }
          : {
              NODE_ENV_ELECTRON_VITE: 'development',
              VITE_AVATAR_STORAGE_ENABLED: 'true',
              ELECTRON_RENDERER_URL: options.url ?? 'http://localhost:5173'
            }
      },
      require: (name) => {
        if (name === 'electron') return { app }
        if (name === 'node:path') return path
        if (name === 'node:fs')
          return {
            existsSync: () => !options.missing,
            lstatSync: () => ({ isSymbolicLink: () => options.symlink ?? false }),
            mkdirSync: () => events.push('mkdir'),
            realpathSync: (value) => (options.redirect ? path.resolve('original-profile') : value)
          }
        assert.equal(
          name,
          path.resolve(preview ? 'out/avatar-ui-build/main/index.js' : 'out/main/index.js')
        )
        for (const key of ['userData', 'sessionData', 'logs', 'crashDumps'])
          assert.equal(paths[key], path.join(profile, key))
        events.push('main')
        loaded = true
      }
    })
  return { execute, events, loaded: () => loaded }
}

test('sets and verifies isolated directories before loading any application code', () => {
  const fixture = run()
  fixture.execute()
  assert.equal(fixture.loaded(), true)
  assert.deepEqual(fixture.events.slice(-5), [
    'userData',
    'sessionData',
    'logs',
    'crashDumps',
    'main'
  ])
})

test('preview sets every isolated path before importing only the test build', () => {
  const fixture = run({ preview: true })
  fixture.execute()
  assert.equal(fixture.loaded(), true)
  assert.deepEqual(fixture.events.slice(-5), [
    'userData',
    'sessionData',
    'logs',
    'crashDumps',
    'main'
  ])
})

test('preview refuses packaged launches, dev servers, missing builds, shared or redirected profiles', () => {
  for (const options of [
    { packaged: true },
    { ready: true },
    { defaultApp: false },
    { confirm: '0' },
    { url: 'http://localhost:5173' },
    { missing: true },
    { collision: true },
    { symlink: true },
    { redirect: true },
    { ignorePaths: true }
  ]) {
    const fixture = run({ preview: true, ...options })
    assert.throws(fixture.execute, /preview blocked/)
    assert.equal(fixture.loaded(), false)
  }
})

test('fails closed for packaged/late launches, remote renderer, redirected profile or rejected paths', () => {
  for (const options of [
    { packaged: true },
    { ready: true },
    { url: 'https://example.com' },
    { symlink: true },
    { ignorePaths: true }
  ]) {
    const fixture = run(options)
    assert.throws(fixture.execute, /launch blocked/)
    assert.equal(fixture.loaded(), false)
  }
})

test('installed electron-vite CLI forwards --entry on the dev command without starting Electron', async () => {
  const cliSource = readFileSync(
    new URL('../node_modules/electron-vite/dist/cli.js', import.meta.url),
    'utf8'
  )
  const start = cliSource.indexOf("const cli = cac('electron-vite')")
  const end = cliSource.indexOf('// build', start)
  assert.ok(start >= 0 && end > start)
  const env = {}
  let invoked = false
  const code = cliSource
    .slice(start, end)
    .replace(
      /const \{ createServer \} = await import\([^\n]+\);/,
      'const createServer = testCreateServer;'
    )
  vm.runInNewContext(
    code + '\ncli.parse(["node", "electron-vite", "dev", "--entry", "tests/avatar-ui/entry.cjs"]);',
    {
      cac,
      process: { env },
      testCreateServer: async () => {
        invoked = true
      },
      createLogger: () => {
        throw new Error('Unexpected CLI error')
      }
    }
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(invoked, true)
  assert.equal(env.ELECTRON_ENTRY, 'tests/avatar-ui/entry.cjs')
})
