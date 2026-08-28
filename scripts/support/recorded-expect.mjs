import { AsyncLocalStorage } from 'node:async_hooks'

import { expect as playwrightExpect } from '@playwright/test'

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

export function inferAssertionModule(scriptId, name) {
  const text = String(name || '')
  const fieldModule = FIELD_MODULES.find((label) => text.includes(label))
  if (fieldModule) return fieldModule
  if (/提交|结果页|submission|请求体|请求 JSON|提交 JSON/i.test(text)) return '表单提交'
  if (/Token|Authorization|登录|鉴权|同源|域名|请求地址/i.test(text)) return '鉴权与请求安全'
  if (/第\s*1\s*页|联系人/.test(text)) return '第 1 页联系人'
  if (/第\s*2\s*页|通用题/.test(text)) return '第 2 页通用题'
  if (/第\s*3\s*页|高级题/.test(text)) return '第 3 页高级题'
  if (/上一页|下一页|翻页|分页|跨页/.test(text)) return '分页与答案保持'
  if (/公开配置|发布产物|表单配置|表单地址|表单名称|页面标题|设计器|题型|已发布列表|发布响应/.test(text)) {
    return scriptId.includes('publish') ? '表单创建与发布' : '公开表单契约'
  }
  if (/上传|文件/.test(text)) return '文件与媒体'
  return scriptId.includes('publish') ? '表单创建与发布' : '基础运行流程'
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
