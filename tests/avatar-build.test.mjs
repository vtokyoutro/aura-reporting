import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('avatar build enables only its child environment and never packages or publishes', () => {
  const source = readFileSync(new URL('../scripts/build-avatars.mjs', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '')
    .replaceAll('import.meta.url', 'scriptUrl')
  const env = { VITE_AVATAR_STORAGE_ENABLED: 'false' }
  let called = false
  vm.runInNewContext(source, {
    URL,
    fileURLToPath,
    scriptUrl: new URL('../scripts/build-avatars.mjs', import.meta.url).href,
    process: { execPath: 'node-fixture', env },
    spawnSync: (executable, args, options) => {
      called = true
      assert.equal(executable, 'node-fixture')
      assert.equal(args[1], 'build')
      assert.equal(args.length, 2)
      assert.equal(options.env.VITE_AVATAR_STORAGE_ENABLED, 'true')
      assert.notEqual(options.env, env)
      return { status: 0 }
    }
  })
  assert.equal(called, true)
  assert.equal(env.VITE_AVATAR_STORAGE_ENABLED, 'false')
})
