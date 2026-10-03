import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { GraphNode, Mapping, Receipt, ReviewItem } from './seed'
import { seedState } from './seed'
import { receiptItemSchema } from './schema'

type CurriculumState = {
  nodes: GraphNode[]
  mappings: Mapping[]
  reviewItems: ReviewItem[]
  receipts: Receipt[]
  revision: string
  locked: boolean
  draft: string
}

export type ImportConflict = {
  itemId: string
  reason: '版本已过期' | '超出负责范围'
  incoming: { relation: Mapping['relation']; weight: number }
  live: { relation: Mapping['relation']; weight: number } | null
}

export type ImportResult = {
  ok: boolean
  merged: string[]
  skipped: string[]
  conflicts: ImportConflict[]
  failures: Array<{ itemId: string; message: string }>
  newRevision?: string
  error?: string
}

const STORAGE_KEY = 'curriculum-map-draft-v1'
const defaultDraft = 'C-308 对 GR-06 的案例证据不足，需补充评分记录。'

// 旧草稿升级：补齐回执来源、回执列表与锁定状态，重开后仍能继续合并
function upgradeDraft(raw: string | null): CurriculumState {
  const base = structuredClone(seedState)
  if (!raw) return { ...base, draft: defaultDraft }
  try {
    const saved = JSON.parse(raw) as Partial<CurriculumState>
    return {
      nodes: saved.nodes ?? base.nodes,
      mappings: saved.mappings ?? base.mappings,
      reviewItems: (saved.reviewItems ?? base.reviewItems).map((item) => ({ ...item, source: item.source ?? '站内提交' })),
      receipts: (saved.receipts ?? base.receipts).map((receipt) => ({
        ...receipt,
        items: (receipt.items ?? []).map((item) => ({ ...item, merged: item.merged ?? false })),
      })),
      revision: saved.revision ?? base.revision,
      locked: saved.locked ?? false,
      draft: saved.draft ?? defaultDraft,
    }
  } catch {
    return { ...base, draft: defaultDraft }
  }
}

function nextRevision(revision: string) {
  const match = /^R(\d+)$/.exec(revision)
  return match ? `R${Number(match[1]) + 1}` : `${revision}-next`
}

const initial = upgradeDraft(browser ? localStorage.getItem(STORAGE_KEY) : null)

function createCurriculumStore() {
  const { subscribe, update, set } = writable<CurriculumState>(initial)
  return {
    subscribe,
    set,
    update,
    moveNode(id: string, x: number, y: number) {
      update((state) => ({ ...state, nodes: state.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)) }))
    },
    addMapping(source: string, target: string, relation: Mapping['relation'], weight: number) {
      update((state) => ({ ...state, mappings: [...state.mappings, { id: `M-${Date.now()}`, source, target, relation, weight }] }))
    },
    updateReview(id: string, status: ReviewItem['status'], comment: string) {
      update((state) => ({ ...state, reviewItems: state.reviewItems.map((item) => (item.id === id ? { ...item, status, comment } : item)) }))
    },
    saveDraft(draft: string) {
      update((state) => ({ ...state, draft }))
    },
    lock(revision: string) {
      update((state) => ({ ...state, revision, locked: true }))
    },
    importReceipt(receiptId: string): ImportResult {
      const result: ImportResult = { ok: false, merged: [], skipped: [], conflicts: [], failures: [] }
      update((state) => {
        const receipt = state.receipts.find((entry) => entry.id === receiptId)
        if (!receipt) {
          result.error = '未找到对应回执。'
          return state
        }
        const stale = receipt.baseRevision !== state.revision
        let mappings = state.mappings
        let reviewItems = state.reviewItems
        const items = receipt.items.map((item) => {
          // 重试只处理尚未并入的回执项
          if (item.merged) {
            result.skipped.push(item.id)
            return item
          }
          const parsed = receiptItemSchema.safeParse(item)
          const courseKnown = state.nodes.some((node) => node.id === item.courseId && node.type === '课程')
          const requirementKnown = state.nodes.some((node) => node.id === item.requirementId && node.type === '毕业要求')
          if (!parsed.success || !courseKnown || !requirementKnown) {
            result.failures.push({
              itemId: item.id,
              message: parsed.success ? '回执项引用了不存在的课程或毕业要求。' : (parsed.error.issues[0]?.message ?? '回执项未通过校验。'),
            })
            return item
          }
          const live = state.mappings.find((mapping) => mapping.source === item.requirementId && mapping.target === item.courseId && mapping.relation === item.relation)
          const incoming = { relation: item.relation, weight: item.weight }
          // 已过期或超出负责范围的映射不覆盖，仅记录冲突与现场值
          if (stale) {
            result.conflicts.push({ itemId: item.id, reason: '版本已过期', incoming, live: live ? { relation: live.relation, weight: live.weight } : null })
            return item
          }
          if (!receipt.requirements.includes(item.requirementId)) {
            result.conflicts.push({ itemId: item.id, reason: '超出负责范围', incoming, live: live ? { relation: live.relation, weight: live.weight } : null })
            return item
          }
          mappings = live
            ? mappings.map((mapping) => (mapping.id === live.id ? { ...mapping, weight: item.weight } : mapping))
            : [...mappings, { id: `M-${item.id}`, source: item.requirementId, target: item.courseId, relation: item.relation, weight: item.weight }]
          reviewItems = [
            {
              id: `REV-${item.id}`,
              courseId: item.courseId,
              requirementId: item.requirementId,
              evidence: `离线回执 ${receipt.id} 并入：${item.note}`,
              submitter: receipt.teacher,
              status: '待审阅' as const,
              comment: '',
              source: receipt.id,
            },
            ...reviewItems,
          ]
          result.merged.push(item.id)
          return { ...item, merged: true }
        })
        // 导入失败保留原修订；无冲突项全部并入后才生成新修订
        const ok = result.failures.length === 0
        const revision = ok && result.merged.length > 0 ? nextRevision(state.revision) : state.revision
        result.ok = ok
        if (revision !== state.revision) result.newRevision = revision
        return {
          ...state,
          mappings,
          reviewItems,
          revision,
          receipts: state.receipts.map((entry) => (entry.id === receiptId ? { ...receipt, items } : entry)),
        }
      })
      return result
    },
    fixReceiptItem(receiptId: string, itemId: string, weight: number) {
      update((state) => ({
        ...state,
        receipts: state.receipts.map((receipt) =>
          receipt.id === receiptId
            ? { ...receipt, items: receipt.items.map((item) => (item.id === itemId && !item.merged ? { ...item, weight } : item)) }
            : receipt,
        ),
      }))
    },
  }
}

export const curriculumStore = createCurriculumStore()

if (browser) {
  curriculumStore.subscribe((state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)))
}

export function validateCurriculum(state: CurriculumState) {
  const issues: Array<{ id: string; severity: '错误' | '警告'; title: string; detail: string }> = []
  const outgoing = new Map<string, Mapping[]>()
  state.mappings.forEach((mapping) => outgoing.set(mapping.source, [...(outgoing.get(mapping.source) ?? []), mapping]))
  state.nodes.filter((node) => node.type === '毕业要求').forEach((node) => {
    if (!(outgoing.get(node.id) ?? []).some((mapping) => state.nodes.find((item) => item.id === mapping.target)?.type === '课程')) {
      issues.push({ id: `coverage-${node.id}`, severity: '错误', title: `${node.label.split('\n')[0]} 存在覆盖缺口`, detail: '未关联任何课程支撑证据。' })
    }
  })
  const seen = new Set<string>()
  state.mappings.forEach((mapping) => {
    const key = `${mapping.source}-${mapping.target}-${mapping.relation}`
    if (seen.has(key)) issues.push({ id: `dup-${mapping.id}`, severity: '警告', title: `${mapping.id} 为重复映射`, detail: '相同来源、目标和关系重复录入，可合并。' })
    seen.add(key)
  })
  return issues
}
