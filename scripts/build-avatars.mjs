import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Explicit opt-in for this build only; never rewrite .env or the parent environment.
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url)),
    'build'
  ],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, VITE_AVATAR_STORAGE_ENABLED: 'true' },
    stdio: 'inherit'
  }
)
if (result.error) throw new Error('Не удалось запустить сборку аватаров.')
process.exitCode = result.status ?? 1
