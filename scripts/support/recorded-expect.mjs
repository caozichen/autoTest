import { AsyncLocalStorage } from 'node:async_hooks'

import { expect as playwrightExpect } from './environment-timeouts.mjs'

const assertionContext = new AsyncLocalStorage()

const FIELD_MODULES = [
  '图片上传',
  '文件上传',
  '单项选择',
  '多项选择',
  '下拉选择',
  '单行文本',
  '多行文本',
  '矩阵选择',
  '矩阵题',
  '级联选择',
  '手写签名',
  '身份证件',
  '固定电话',
  '题组',
  '排序题',
  '评分题',
  '手机号',
  '姓名',
  '邮箱',
  '地址',
  '生日',
  '数字',
  '日期',
  '时间',
  'NPS',
  '描述说明',
  '分割线',
]

const TRANSLATION_SCRIPT_PATTERN = /translation|translate|multilingual|i18n/i

const TRANSLATION_STAGE_MODULES = [
  {
    module: 'AI 一键翻译',
    pattern: /AI.*(?:翻译|翻譯)|(?:翻译|翻譯).*AI/i,
  },
  {
    module: '分享与语言切换',
    pattern: /分享|二维码|二維碼|语言切换|語言切換|切换语言|切換語言/,
  },
  {
    module: '多语言预览',
    pattern: /(?:多语言|多語言).*(?:预览|預覽)|(?:预览|預覽|公开页|公開頁).*(?:语言|語言|翻译|翻譯)/,
  },
  {
    module: '翻译保存与回读',
    pattern: /(?:翻译|翻譯).*(?:保存|儲存|回读|回讀|持久化)|(?:保存|儲存|回读|回讀|持久化).*(?:翻译|翻譯)/,
  },
  {
    module: '完成与发布',
    pattern: /完成(?:并|並|与|與)?(?:发布|發佈|發布)|(?:多语言|多語言|翻译|翻譯).*(?:发布|發佈|發布)|(?:发布|發佈|發布).*(?:多语言|多語言|翻译|翻譯)/,
  },
  {
    module: '多语言设置',
    pattern: /(?:多语言|多語言).*(?:设置|設定|配置)|(?:设置|設定|配置).*(?:多语言|多語言)|(?:源|来源|來源|目标|目標|默认|默認|預設|启用|啟用)?(?:语言|語言)(?:列表|集合|代码|代碼|顺序|順序|数量|數量|配置|设置|設定)/,
  },
]

export function inferAssertionModule(scriptId, name) {
  const text = String(name || '')
  const normalizedScriptId = String(scriptId || '')
  const translationScript = TRANSLATION_SCRIPT_PATTERN.test(normalizedScriptId)
  const explicitTranslationStage = TRANSLATION_STAGE_MODULES.find(({ pattern }) => pattern.test(text))
  if (explicitTranslationStage) return explicitTranslationStage.module
  if (translationScript && /(?:保存|儲存|回读|回讀|持久化)/.test(text)) {
    return '翻译保存与回读'
  }
  if (translationScript && /(?:预览|預覽|公开页|公開頁)/.test(text)) return '多语言预览'
  if (translationScript && /(?:完成|发布|發佈|發布|published)/i.test(text)) return '完成与发布'
  if (translationScript && /(?:翻译|翻譯)/.test(text)) return 'AI 一键翻译'
  if (translationScript && /(?:多语言|多語言|语言|語言|locale)/i.test(text)) return '多语言设置'
  const fieldModule = FIELD_MODULES.find((label) => text.includes(label))
  if (fieldModule) return fieldModule
  if (/提交|结果页|submission|请求体|请求 JSON|提交 JSON/i.test(text)) return '表单提交'
  if (/Token|Authorization|登录|鉴权|同源|域名|请求地址/i.test(text)) return '鉴权与请求安全'
  if (/第\s*1\s*页|联系人/.test(text)) return '第 1 页联系人'
  if (/第\s*2\s*页|通用题/.test(text)) return '第 2 页通用题'
  if (/第\s*3\s*页|高级题/.test(text)) return '第 3 页高级题'
  if (/上一页|下一页|翻页|分页|跨页/.test(text)) return '分页与答案保持'
  if (/公开配置|发布产物|表单配置|表单地址|表单名称|页面标题|设计器|题型|已发布列表|发布响应/.test(text)) {
    return normalizedScriptId.includes('publish') ? '表单创建与发布' : '公开表单契约'
  }
  if (/上传|文件/.test(text)) return '文件与媒体'
  return normalizedScriptId.includes('publish') ? '表单创建与发布' : '基础运行流程'
}

function assertionMessage(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && typeof value.message === 'string' && value.message.trim()) {
    return value.message.trim()
  }
  return fallback
}

function failureMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function reportAssertion(metadata, matcher, status, startedAt, error) {
  const context = assertionContext.getStore()
  if (!context) return
  const name = metadata.message || `断言 ${metadata.chain ? `${metadata.chain}.` : ''}${matcher}`
  const assertion = {
    timestamp: new Date().toISOString(),
    name,
    module: inferAssertionModule(context.scriptId, name),
    matcher: `${metadata.chain ? `${metadata.chain}.` : ''}${matcher}`,
    status,
    durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
    ...(error === undefined ? {} : { error: failureMessage(error) }),
  }
  try {
    context.onAssertion(assertion)
  } catch {
    // 断言结果订阅失败不能改变原始测试行为。
  }
}

function wrapMatchers(matchers, metadata) {
  if (!assertionContext.getStore()) return matchers
  return new Proxy(matchers, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof property !== 'string') return value
      if (typeof value !== 'function') {
        if (value && typeof value === 'object') {
          return wrapMatchers(value, {
            ...metadata,
            chain: metadata.chain ? `${metadata.chain}.${property}` : property,
          })
        }
        return value
      }

      return (...args) => {
        const startedAt = performance.now()
        try {
          const result = Reflect.apply(value, target, args)
          if (result && typeof result.then === 'function') {
            return Promise.resolve(result).then(
              (resolved) => {
                reportAssertion(metadata, property, 'passed', startedAt)
                return resolved
              },
              (error) => {
                reportAssertion(metadata, property, 'failed', startedAt, error)
                return undefined
              },
            )
          }
          reportAssertion(metadata, property, 'passed', startedAt)
          return result
        } catch (error) {
          reportAssertion(metadata, property, 'failed', startedAt, error)
          return undefined
        }
      }
    },
  })
}

export const expect = new Proxy(playwrightExpect, {
  apply(target, thisArgument, args) {
    const matchers = Reflect.apply(target, thisArgument, args)
    if (!assertionContext.getStore()) return matchers
    return wrapMatchers(matchers, { message: assertionMessage(args[1], '') })
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver)
    if (!assertionContext.getStore() || !['poll', 'soft'].includes(String(property)) || typeof value !== 'function') {
      return value
    }
    return (...args) => wrapMatchers(Reflect.apply(value, target, args), {
      message: assertionMessage(args[1], ''),
      chain: String(property),
    })
  },
})

export function runWithAssertionRecorder(scriptId, onAssertion, callback) {
  return assertionContext.run({ scriptId, onAssertion }, callback)
}
