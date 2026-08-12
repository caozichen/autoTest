import type {
  AppendRunLogDraft,
  CompleteRunRecordDraft,
  FailRunRecordDraft,
  RunRecord,
  StartRunRecordDraft,
} from '@/domain/run-record'

export interface RunRecordService {
  list(): Promise<RunRecord[]>
  get(id: string): Promise<RunRecord | null>
  start(draft: StartRunRecordDraft): Promise<RunRecord>
  appendLog(id: string, draft: AppendRunLogDraft): Promise<RunRecord>
  complete(id: string, draft: CompleteRunRecordDraft): Promise<RunRecord>
  fail(id: string, draft: FailRunRecordDraft): Promise<RunRecord>
}
