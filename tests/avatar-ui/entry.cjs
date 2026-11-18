/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron's separate CommonJS entry must synchronously configure paths before requiring the application. */
// Local UI acceptance only. Never use this entry in a packaged application.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

function fail() {
  throw new Error('Avatar UI launch blocked: isolated local development profile is required.')
}

const renderer = URL.parse(process.env.ELECTRON_RENDERER_URL || '')
if (
  app.isPackaged ||
  !process.defaultApp ||
  app.isReady() ||
  process.env.NODE_ENV_ELECTRON_VITE !== 'development' ||
  process.env.VITE_AVATAR_STORAGE_ENABLED !== 'true' ||
  !renderer ||
  renderer.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(renderer.hostname)
)
  fail()

const root = path.resolve(__dirname, '../..')
const profile = path.join(root, 'out/avatar-ui-profile')
const main = path.join(root, 'out/main/index.js')
const previous = [app.getPath('userData'), app.getPath('sessionData')]
const directories = {
  userData: path.join(profile, 'userData'),
  sessionData: path.join(profile, 'sessionData'),
  logs: path.join(profile, 'logs'),
  crashDumps: path.join(profile, 'crashDumps')
}

// Refuse junctions/symlinks in test directories rather than follow them into a real profile.
for (const directory of [path.join(root, 'out'), profile, ...Object.values(directories)]) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) fail()
  fs.mkdirSync(directory, { recursive: true })
  if (path.resolve(fs.realpathSync(directory)).toLowerCase() !== directory.toLowerCase()) fail()
}
for (const original of previous) {
  const resolved = path.resolve(original).toLowerCase()
  const isolated = profile.toLowerCase()
  if (
    resolved === isolated ||
    resolved.startsWith(isolated + path.sep) ||
    isolated.startsWith(resolved + path.sep)
  )
    fail()
}
if (!fs.existsSync(main)) fail()

app.setPath('userData', directories.userData)
app.setPath('sessionData', directories.sessionData)
app.setAppLogsPath(directories.logs)
app.setPath('crashDumps', directories.crashDumps)
for (const [name, directory] of Object.entries(directories)) {
  if (path.resolve(app.getPath(name)).toLowerCase() !== directory.toLowerCase()) fail()
}

// Import the application's main process only after all isolation checks succeed.
require(main)
