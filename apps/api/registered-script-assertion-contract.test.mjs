import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const scriptConfigDirectory = resolve(repositoryRoot, 'config/scripts')

test('registered scripts reserve direct Playwright assertions for flow blockers', async () => {
  const configFiles = (await readdir(scriptConfigDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort()
  assert.ok(configFiles.length > 0)

  for (const configFile of configFiles) {
    const config = JSON.parse(await readFile(resolve(scriptConfigDirectory, configFile), 'utf8'))
    const sourcePath = resolve(repositoryRoot, config.directory, config.entryFile)
    const source = await readFile(sourcePath, 'utf8')

    assert.doesNotMatch(source, /\bhardExpect\b/, `${config.id} 不应使用含义不明的硬断言`)
    assert.doesNotMatch(
      source,
      /if\s*\([^\n]*\.ok\(\)[^\n]*\)\s*(?:\{\s*)?throw\b/,
      `${config.id} 不应因接口 HTTP 状态断言直接终止`,
    )
    const directInterfaceThrows = source.split('\n').filter((line) => (
      /throw\s+new\s+Error/.test(line)
      && /(接口|业务码|HTTP)/.test(line)
    ))
    assert.deepEqual(
      directInterfaceThrows,
      [],
      `${config.id} 的接口和业务码检查必须记录断言并继续`,
    )
    assert.doesNotMatch(
      source,
      /import\s*\{\s*expect\s*\}\s*from\s*['"]@playwright\/test['"]/,
      `${config.id} 的业务断言必须使用 recorded-expect`,
    )
    if (source.includes("from '@playwright/test'")) {
      assert.match(
        source,
        /import\s*\{\s*expect\s+as\s+flowExpect\s*\}\s*from\s*'@playwright\/test'/,
        `${config.id} 的原生断言必须明确标记为流程阻塞保护`,
      )
    }
    if (/\bexpect\s*\(/.test(source)) {
      assert.match(
        source,
        /from\s*['"]\.\/support\/recorded-expect\.mjs['"]/,
        `${config.id} 的业务断言必须接入断言记录器`,
      )
    }
  }
})
