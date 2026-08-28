import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LABEL = 'tech.lingxi.autotest.supervisor'
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..')
const SUPERVISOR_SCRIPT = resolve(SCRIPT_DIRECTORY, 'local-service-supervisor.mjs')
const OUTPUT_DIRECTORY = resolve(WORKSPACE_DIRECTORY, 'outputs')
const LAUNCH_AGENTS_DIRECTORY = resolve(homedir(), 'Library', 'LaunchAgents')
const PLIST_PATH = resolve(LAUNCH_AGENTS_DIRECTORY, `${LABEL}.plist`)

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function waitForSupervisor() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:4311/health')
      if (response.ok && (await response.json())?.ok === true) return
    } catch {
      // LaunchAgent may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Supervisor LaunchAgent 已安装，但健康检查未通过')
}

if (process.platform !== 'darwin' || typeof process.getuid !== 'function') {
  throw new Error('当前安装器仅支持 macOS LaunchAgent')
}

await mkdir(LAUNCH_AGENTS_DIRECTORY, { recursive: true })
await mkdir(OUTPUT_DIRECTORY, { recursive: true })
const pathValue = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(SUPERVISOR_SCRIPT)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(WORKSPACE_DIRECTORY)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathValue)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(resolve(OUTPUT_DIRECTORY, 'local-supervisor.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(resolve(OUTPUT_DIRECTORY, 'local-supervisor.error.log'))}</string>
</dict>
</plist>
`
await writeFile(PLIST_PATH, plist, 'utf8')

const domain = `gui/${process.getuid()}`
await execFileAsync('launchctl', ['bootout', domain, PLIST_PATH]).catch(() => undefined)
await execFileAsync('launchctl', ['bootstrap', domain, PLIST_PATH])
await execFileAsync('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`])
await waitForSupervisor()
console.log(`[supervisor] LaunchAgent 已安装并运行: ${PLIST_PATH}`)
