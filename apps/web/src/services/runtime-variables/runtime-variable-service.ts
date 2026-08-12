import type { RuntimeVariable, RuntimeVariableDraft } from '@/domain/runtime-variable'

export interface RuntimeVariableService {
  upsert(draft: RuntimeVariableDraft): RuntimeVariable
  get(key: string): RuntimeVariable | null
  list(): RuntimeVariable[]
  clear(): void
  resolve(template: string): string
  buildAuthorizationHeader(tokenKey: string, tokenType?: string): string | null
}
