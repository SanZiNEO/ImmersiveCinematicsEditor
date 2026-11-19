/**
 * 12-08 飞控姿态槽服务装配（插件与文档层之间的唯一桥）。
 *
 * 放在 features 层而不是插件层：插件目录只允许依赖 `workbench/api/*` 的端口面，
 * 而槽库要按 `DocStore` 身份隔离、从 `ScriptDoc` 求值，因此这里做一次结构化读取，
 * 插件只需拿到 `DocumentService` 就能取到同一个 `PoseBankService`。
 */
import type { DocumentService } from '../../workbench/api/documents.ts'
import type { CatalogIndex } from '../../core/schema/index.ts'
import type { DocStore } from '../../core/doc/store.ts'
import { poseBankFor } from './bank.ts'
import { planApply } from './apply.ts'
import { poseFromClip } from './extract.ts'
import type {
  ApplyPlan,
  ApplyTarget,
  PoseBankService,
  PoseExtraction,
  PoseValue,
} from './public.ts'

/** `DocumentServiceImpl` 公开了 `store`；端口面未暴露，这里做结构化读取。 */
interface DocumentServiceWithStore extends DocumentService {
  readonly store: DocStore
}

const UNAVAILABLE_EXTRACTION: PoseExtraction = {
  ok: false,
  pose: null,
  reasons: [{ code: 'flight.service.unavailable', severity: 'error', message: '文档未打开，姿态槽不可用' }],
}

function unavailablePlan(message: string): ApplyPlan {
  return {
    ok: false,
    writes: [],
    diagnostics: [{ code: 'flight.service.unavailable', severity: 'error', message }],
    command: null,
  }
}

/** 按当前文档服务装配姿态槽服务（无文档时各方法给明确不可用，不造假数据）。 */
export function createFlightService(doc: DocumentService | undefined, catalog: CatalogIndex | undefined): PoseBankService {
  const store = doc === undefined ? undefined : (doc as DocumentServiceWithStore).store
  return {
    bank: () => (store === undefined ? null : poseBankFor(store)),
    extract(clipKey: string, time: number): PoseExtraction {
      if (store === undefined || store.doc === null || catalog === undefined) {
        return UNAVAILABLE_EXTRACTION
      }
      return poseFromClip(store.doc, clipKey, time, catalog)
    },
    planApply(target: ApplyTarget, pose: PoseValue): ApplyPlan {
      if (store === undefined || store.doc === null || catalog === undefined) {
        return unavailablePlan('文档未打开，无法计划应用')
      }
      return planApply(store.doc, catalog, target, pose)
    },
  }
}
