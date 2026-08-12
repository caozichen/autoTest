import type { AuthService } from './auth/auth-service'
import { LocalAuthService } from './auth/local-auth.service'
import type { DashboardService } from './dashboard/dashboard-service'
import { LocalDashboardService } from './dashboard/local-dashboard.service'
import type { EnvironmentService } from './environments/environment-service'
import type { EnvironmentLoginService } from './environments/environment-login-service'
import { FetchEnvironmentLoginService } from './environments/fetch-environment-login.service'
import { LocalEnvironmentService } from './environments/local-environment.service'
import { LocalScriptService } from './scripts/local-script.service'
import type { ScriptService } from './scripts/script-service'
import type { RuntimeVariableService } from './runtime-variables/runtime-variable-service'
import { SessionRuntimeVariableService } from './runtime-variables/session-runtime-variable.service'
import { LocalRunRecordService } from './run-records/local-run-record.service'
import type { RunRecordService } from './run-records/run-record-service'
import type { AutomationPipelineService } from './automation-pipelines/automation-pipeline-service'
import { LocalAutomationPipelineService } from './automation-pipelines/local-automation-pipeline.service'
import {
  LocalAutomationPipelineExecutionService,
  type AutomationPipelineExecutionService,
} from './automation-pipelines/automation-pipeline-execution-service'

export interface ServiceContainer {
  auth: AuthService
  automationPipelineExecution: AutomationPipelineExecutionService
  automationPipelines: AutomationPipelineService
  dashboard: DashboardService
  environmentLogin: EnvironmentLoginService
  environments: EnvironmentService
  runtimeVariables: RuntimeVariableService
  runRecords: RunRecordService
  scripts: ScriptService
}

const scripts = new LocalScriptService()
const environments = new LocalEnvironmentService()
const runRecords = new LocalRunRecordService()
const automationPipelines = new LocalAutomationPipelineService()
const environmentLogin = new FetchEnvironmentLoginService()
const runtimeVariables = new SessionRuntimeVariableService()
const automationPipelineExecution = new LocalAutomationPipelineExecutionService({
  environments,
  environmentLogin,
  runtimeVariables,
  scripts,
  runRecords,
})

export const services: ServiceContainer = Object.freeze({
  auth: new LocalAuthService(),
  automationPipelineExecution,
  automationPipelines,
  dashboard: new LocalDashboardService(scripts, environments, runRecords),
  environmentLogin,
  environments,
  runtimeVariables,
  runRecords,
  scripts,
})
