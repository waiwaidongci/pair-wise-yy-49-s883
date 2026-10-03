import { writable } from 'svelte/store'
import { browser } from '$app/environment'
import type { GraphNode, Mapping, ReviewItem, Receipt, ReceiptItem } from './seed'
import { seedState } from './seed'
import { receiptBatchSchema } from './schema'

export type ConflictReason = '已过期' | '超出教师范围' | '未找到对应审阅项'

export type Conflict = {
  receiptId: string
  receiptSource: string
  itemId: string
  courseId: string
  requirementId: string
  reason: ConflictReason
  proposedStatus: string
  proposedComment: string
  liveStatus: string | null
  liveEvidence: string | null
  liveComment: string | null
}

export type ImportResult = {
  ok: boolean
  error?: string
  merged: string[]
  conflicts: Conflict[]
  newRevision: string
  previousRevision: string
}

type CurriculumState = {
  nodes: GraphNode[]
  mappings: Mapping[]
  reviewItems: ReviewItem[]
  revision: string
  locked: boolean
  draft: string
  receipts: Receipt[]
}

function revisionNumber(revision: string): number {
  return parseInt(revision.replace(/^R/i, ''), 10) || 0
}

function cloneReceipts(receipts: Receipt[]): Receipt[] {
  return receipts.map((receipt) => ({ ...receipt, items: receipt.items.map((item) => ({ ...item })) }))
}

function migrate(raw: unknown): CurriculumState {
  const base = raw && typeof raw === 'object' ? (raw as Partial<CurriculumState>) : {}
  return {
    nodes: Array.isArray(base.nodes) ? base.nodes : seedState.nodes,
    mappings: Array.isArray(base.mappings) ? base.mappings : seedState.mappings,
    reviewItems: Array.isArray(base.reviewItems) ? base.reviewItems : seedState.reviewItems,
    revision: typeof base.revision === 'string' && base.revision.trim() ? base.revision : seedState.revision,
    locked: typeof base.locked === 'boolean' ? base.locked : false,
    draft: typeof base.draft === 'string' ? base.draft : 'C-308 对 GR-06 的案例证据不足，需补充评分记录。',
    receipts: Array.isArray(base.receipts) ? cloneReceipts(base.receipts) : cloneReceipts(seedState.receipts),
  }
}

const saved = browser ? localStorage.getItem('curriculum-map-draft-v1') : null
const initial: CurriculumState = migrate(saved ? JSON.parse(saved) : null)

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
    importReceipts(input: unknown): ImportResult {
      const parsed = receiptBatchSchema.safeParse(input)
      if (!parsed.success) {
        return {
          ok: false,
          error: `回执格式校验失败：${parsed.error.issues.map((issue) => issue.message).join('；')}`,
          merged: [],
          conflicts: [],
          newRevision: '',
          previousRevision: '',
        }
      }
      const conflicts: Conflict[] = []
      const merged: string[] = []
      let previousRevision = ''
      let nextRevision = ''

      update((draft) => {
        previousRevision = draft.revision
        const receiptMap = new Map(draft.receipts.map((receipt) => [receipt.id, receipt]))

        for (const incoming of parsed.data.receipts) {
          let receipt = receiptMap.get(incoming.id)
          if (!receipt) {
            receipt = {
              id: incoming.id,
              source: incoming.source,
              receivedRevision: incoming.receivedRevision,
              scope: incoming.scope,
              importedAt: incoming.importedAt ?? new Date().toISOString(),
              items: [],
            }
            draft.receipts.push(receipt)
            receiptMap.set(incoming.id, receipt)
          } else {
            receipt.source = incoming.source
            receipt.receivedRevision = incoming.receivedRevision
            receipt.scope = incoming.scope
          }

          for (const incomingItem of incoming.items) {
            let item: ReceiptItem | undefined = receipt.items.find((entry) => entry.id === incomingItem.id)
            if (item?.merged) continue
            if (!item) {
              item = { ...incomingItem, merged: false }
              receipt.items.push(item)
            } else {
              item.status = incomingItem.status
              item.comment = incomingItem.comment
              item.courseId = incomingItem.courseId
              item.requirementId = incomingItem.requirementId
            }

            const live = draft.reviewItems.find((entry) => entry.id === item!.id)

            if (!live) {
              conflicts.push({
                receiptId: receipt.id,
                receiptSource: receipt.source,
                itemId: item.id,
                courseId: item.courseId,
                requirementId: item.requirementId,
                reason: '未找到对应审阅项',
                proposedStatus: item.status,
                proposedComment: item.comment,
                liveStatus: null,
                liveEvidence: null,
                liveComment: null,
              })
              continue
            }
            const liveStatus = live.status
            const liveEvidence = live.evidence
            const liveComment = live.comment
            if (revisionNumber(receipt.receivedRevision) < revisionNumber(draft.revision)) {
              conflicts.push({
                receiptId: receipt.id,
                receiptSource: receipt.source,
                itemId: item.id,
                courseId: item.courseId,
                requirementId: item.requirementId,
                reason: '已过期',
                proposedStatus: item.status,
                proposedComment: item.comment,
                liveStatus,
                liveEvidence,
                liveComment,
              })
              continue
            }
            if (!receipt.scope.includes(item.requirementId)) {
              conflicts.push({
                receiptId: receipt.id,
                receiptSource: receipt.source,
                itemId: item.id,
                courseId: item.courseId,
                requirementId: item.requirementId,
                reason: '超出教师范围',
                proposedStatus: item.status,
                proposedComment: item.comment,
                liveStatus,
                liveEvidence,
                liveComment,
              })
              continue
            }

            draft.reviewItems = draft.reviewItems.map((entry) =>
              entry.id === item!.id ? { ...entry, status: item!.status, comment: item!.comment } : entry,
            )
            item.merged = true
            merged.push(item.id)
          }
        }

        if (merged.length > 0) {
          nextRevision = `R${revisionNumber(previousRevision) + 1}`
          draft.revision = nextRevision
        } else {
          nextRevision = previousRevision
        }
        return draft
      })

      return { ok: true, merged, conflicts, newRevision: nextRevision, previousRevision }
    },
  }
}

export const curriculumStore = createCurriculumStore()

if (browser) {
  curriculumStore.subscribe((state) => localStorage.setItem('curriculum-map-draft-v1', JSON.stringify(state)))
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
