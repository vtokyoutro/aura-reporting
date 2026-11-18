/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Synchronous CommonJS bootstrap configures isolation before importing Electron application code. */
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

function fail() {
  throw new Error('Avatar preview blocked: an isolated local test build is required.')
}

if (
  app.isPackaged ||
  !process.defaultApp ||
  app.isReady() ||
  process.env.AURA_AVATAR_UI_PREVIEW !== '1' ||
  process.env.ELECTRON_RENDERER_URL
)
  fail()

const root = path.resolve(__dirname, '../..')
const profile = path.join(root, 'out/avatar-ui-preview-profile')
const main = path.join(root, 'out/avatar-ui-build/main/index.js')
const renderer = path.join(root, 'out/avatar-ui-build/renderer/index.html')
const previous = [app.getPath('userData'), app.getPath('sessionData')]
const directories = {
  userData: path.join(profile, 'userData'),
  sessionData: path.join(profile, 'sessionData'),
  logs: path.join(profile, 'logs'),
  crashDumps: path.join(profile, 'crashDumps')
}

// No dev server or installed entry is accepted. Reject redirected build files as well.
for (const file of [main, renderer]) {
  if (
    !fs.existsSync(file) ||
    path.resolve(fs.realpathSync(file)).toLowerCase() !== file.toLowerCase()
  )
    fail()
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
for (const directory of [path.join(root, 'out'), profile, ...Object.values(directories)]) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) fail()
  fs.mkdirSync(directory, { recursive: true })
  if (path.resolve(fs.realpathSync(directory)).toLowerCase() !== directory.toLowerCase()) fail()
}
app.setPath('userData', directories.userData)
app.setPath('sessionData', directories.sessionData)
app.setAppLogsPath(directories.logs)
app.setPath('crashDumps', directories.crashDumps)
for (const [name, directory] of Object.entries(directories)) {
  if (path.resolve(app.getPath(name)).toLowerCase() !== directory.toLowerCase()) fail()
}
require(main)
