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
    // The timeout wrapper exposes raw Playwright expect too. Importing other
    // Playwright APIs (e.g. request) does not imply a direct assertion import.
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](@playwright\/test|\.\/support\/environment-timeouts\.mjs)['"]/g)) {
      const assertionImport = match[1].split(',').map(item => item.trim()).find(item => /^expect\b/.test(item))
      if (assertionImport) assert.equal(assertionImport, 'expect as flowExpect',
        `${config.id} 的原生断言必须明确标记为流程阻塞保护`)
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
