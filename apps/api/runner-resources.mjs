import os from 'node:os'
import v8 from 'node:v8'
import { performance } from 'node:perf_hooks'
import { statfs } from 'node:fs/promises'

// Groups and metrics are additive. No environment, command arguments, task
// payloads or credentials enter this observation-only response.
export function createRunnerResourceSampler({ records, capacity, limits, directory,
  processSource = process, osSource = os, v8Source = v8, diskStat = statfs }) {
  let previousCpu = null
  let previousTime = null
  return async function sample() {
    const started = performance.now()
    const groups = []
    const metric = (id, label, value, unit = 'count', note) => ({ id, label, value: value ?? null, unit, ...(note ? { note } : {}) })
    async function collect(id, title, description, read) {
      try { groups.push({ id, title, description, metrics: await read(), unavailableReason: null }) }
      catch (error) {
        const reason = { ENOENT: '采集目录尚未创建或已不可访问', EACCES: '当前进程没有采集权限', EPERM: '当前进程没有采集权限',
          ENOSYS: '当前平台不支持此采集能力', ENOTSUP: '当前平台不支持此采集能力', SAMPLE_TIMEOUT: '磁盘采集超过 250 ms，已停止等待' }[error?.code]
        groups.push({ id, title, description, metrics: [], unavailableReason: reason ?? '当前运行环境无法采集此组指标' })
      }
    }
    await collect('process', 'Runner 进程', '仅 Node 进程；不包含 Chrome 子进程。CPU 为两次手动采样间隔的单核占用，首次为进程启动以来均值。', () => {
      const memory = processSource.memoryUsage()
      const cpu = processSource.cpuUsage()
      const uptime = processSource.uptime()
      const time = performance.now()
      const elapsed = previousTime === null ? uptime * 1000 : time - previousTime
      const percent = elapsed > 0 ? ((cpu.user + cpu.system - (previousCpu?.user ?? 0) - (previousCpu?.system ?? 0)) / (elapsed * 1000)) * 100 : null
      previousCpu = cpu; previousTime = time
      const usage = processSource.resourceUsage()
      return [metric('rss', '常驻内存 RSS', memory.rss, 'bytes'), metric('cpu', 'CPU / 单核', percent, 'percent'),
        metric('pid', '进程 PID', processSource.pid), metric('uptime', '启动时长', uptime * 1000, 'ms'),
        metric('node', 'Node 版本', processSource.version, 'text'), metric('platform', '平台 / 架构', `${processSource.platform} / ${processSource.arch}`, 'text'),
        metric('maxRss', '峰值 RSS', usage.maxRSS * 1024, 'bytes'),
        metric('cpuUser', '累计用户 CPU 时间', cpu.user / 1000, 'ms'), metric('cpuSystem', '累计内核 CPU 时间', cpu.system / 1000, 'ms'),
        metric('activeResources', '活动资源句柄', processSource.getActiveResourcesInfo().length),
        metric('eventLoop', '事件循环活跃率 / 启动以来', performance.eventLoopUtilization().utilization * 100, 'percent')]
    })
    await collect('v8', 'V8 与原生内存', 'heapTotal 为当前已分配堆，heapLimit 为 V8 上限。ArrayBuffers 属于 external，external 与 RSS 有包含关系，请勿相加。', () => {
      const memory = processSource.memoryUsage()
      const heap = v8Source.getHeapStatistics()
      return [metric('heapUsed', '已使用堆', memory.heapUsed, 'bytes'), metric('heapTotal', '已分配堆', memory.heapTotal, 'bytes'),
        metric('heapLimit', 'V8 堆上限', heap.heap_size_limit, 'bytes'), metric('heapHeadroom', '距堆上限余量', Math.max(0, heap.heap_size_limit - memory.heapUsed), 'bytes'),
        metric('heapPercent', '堆上限使用率', memory.heapUsed / heap.heap_size_limit * 100, 'percent'),
        metric('available', 'V8 可分配估计', heap.total_available_size, 'bytes'), metric('external', 'External', memory.external, 'bytes'),
        metric('arrayBuffers', 'ArrayBuffers', memory.arrayBuffers, 'bytes'), metric('nativeContexts', '原生上下文', heap.number_of_native_contexts),
        metric('detachedContexts', '脱离上下文', heap.number_of_detached_contexts)]
    })
    await collect('system', '操作系统', '系统空闲内存为 OS freemem，包含口径因平台不同，不等于可用内存。负载为系统运行队列均值。', () => {
      const total = osSource.totalmem(), free = osSource.freemem(), load = osSource.loadavg()
      return [metric('total', '物理内存', total, 'bytes'), metric('free', '系统空闲内存', free, 'bytes'),
        metric('used', '非空闲内存', total - free, 'bytes'), metric('memoryPercent', '非空闲比例', (total - free) / total * 100, 'percent'),
        metric('cpuCount', '逻辑 CPU', osSource.cpus().length), metric('parallelism', '可用并行度', osSource.availableParallelism()),
        ...[1, 5, 15].map((minutes, index) => metric(`load${minutes}`, `${minutes} 分钟负载`, processSource.platform === 'win32' ? null : load[index], 'number', processSource.platform === 'win32' ? 'Windows 不支持系统负载' : undefined)),
        metric('uptime', '系统启动时长', osSource.uptime() * 1000, 'ms'), metric('release', '系统版本', osSource.release(), 'text')]
    })
    await collect('capacity', '运行容量与快照', '批次上限沿用现有执行规则；快照包括 TTL 内已结束执行，待保存结果不会提前释放。', () => Object.entries(capacity()).map(([id, item]) => metric(id, item.label, item.value)))
    await collect('storage', '历史、详情缓存与写入', '历史统计来自已索引文件，索引就绪前不可用；采样不读取详情。字节为 JSON 序列化体积，非 JS 堆占用，磁盘统计不含制品和摘要索引。', () => {
      const state = records.diagnostics?.()
      if (!state) throw new Error('Unsupported store')
      const { history: h, cache: c, writes: w, initialization: init } = state
      return [metric('initialization', '历史索引状态', init.status, 'text'), metric('records', '历史记录', init.status === 'ready' ? h.records : null),
        metric('invalid', '跳过的无效记录', init.invalidRecords), metric('diskBytes', '历史文件大小', init.status === 'ready' ? h.diskBytes : null, 'bytes'),
        metric('summaryBytes', '常驻摘要 / JSON 体积', init.status === 'ready' ? h.summaryBytes : null, 'bytes'), metric('legacyReads', '启动详情读取数', init.legacyReads), metric('summaryReads', '启动摘要读取数', init.summaryReads),
        metric('cacheEntries', '详情缓存条数', c.entries), metric('cacheBytes', '详情缓存 / JSON 体积', c.serializedBytes, 'bytes'),
        metric('cacheMaxEntries', '缓存条数上限', c.maxEntries), metric('cacheMaxBytes', '缓存 JSON 体积上限', c.maxSerializedBytes, 'bytes'),
        ...['hits', 'misses', 'evictions', 'oversized'].map((key, index) => metric(key, ['缓存命中', '缓存未命中', '缓存淘汰', '不缓存的大记录'][index], c[key])),
        metric('queued', '待完成存储操作', w.queuedMutations), metric('writing', '正在写入', w.writing ? '是' : '否', 'text'), metric('pendingProgress', '待合并进度', w.pendingProgress),
        metric('pendingTerminalSnapshots', '终态重试保留快照', w.pendingTerminalSnapshots),
        metric('coalesced', '已合并进度更新', w.coalescedProgress), metric('writes', '完整记录成功写入', w.writes), metric('failures', '完整记录写入失败', w.failures),
        metric('indexWrites', '摘要索引成功写入', w.indexWrites), metric('indexFailures', '摘要索引写入失败', w.indexFailures),
        metric('lastIndexFailure', '最近索引写入失败', w.lastIndexFailureAt, 'datetime', '本进程尚无索引写入失败时不可用'),
        metric('bytesWritten', '累计写入 / JSON', w.bytesWritten, 'bytes'), metric('lastWriteDuration', '最近写入耗时', w.lastWriteDurationMs, 'ms', '无写入时不可用'),
        metric('lastSuccess', '最近写入成功', w.lastSuccessAt, 'datetime', '本进程尚无成功写入时不可用'), metric('lastFailure', '最近写入失败', w.lastFailureAt, 'datetime', '本进程尚无失败写入时不可用')]
    })
    await collect('disk', '历史目录所在磁盘', '当前文件系统容量；不遍历历史或制品。', async () => {
      let timer
      let disk
      try {
        disk = await Promise.race([diskStat(directory), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Disk sample timeout'), { code: 'SAMPLE_TIMEOUT' })), 250)
          timer.unref?.()
        })])
      } finally { clearTimeout(timer) }
      return [metric('total', '磁盘总容量', disk.blocks * disk.bsize, 'bytes'), metric('available', '当前用户可用空间', disk.bavail * disk.bsize, 'bytes')]
    })
    await collect('limits', '关键运行参数', '观察现有设置，不会触发执行、恢复运行、取消或重启。', () => [
      ...Object.entries(limits).map(([id, item]) => metric(id, item.label, item.value, item.unit ?? 'ms')),
      ...Object.entries(records.diagnostics?.().limits ?? {}).map(([id, value]) => metric(id, ({ progressFlushIntervalMs: '进度合并间隔', heartbeatIntervalMs: '心跳持久化间隔', staleAfterMs: '普通记录过期时间', recoveryGraceMs: '故障恢复宽限期' })[id] ?? id, value, 'ms')),
    ])
    return { schemaVersion: 1, sampledAt: new Date().toISOString(), collectionDurationMs: performance.now() - started, groups }
  }
}
