import { z } from 'zod'

export const revisionSchema = z.object({
  courseId: z.string().min(1, '请选择课程'),
  requirementId: z.string().min(1, '请选择毕业要求'),
  evidence: z.string().min(12, '证据说明至少需要 12 个字符'),
  revisionNote: z.string().min(8, '修订说明至少需要 8 个字符'),
  submitter: z.string().min(2, '请填写提交人'),
})

export const mappingSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  relation: z.enum(['支撑', '前置', '考核', '教学']),
  weight: z.number().min(0).max(1),
})

export const receiptItemSchema = z.object({
  id: z.string().min(1, '回执项缺少编号'),
  courseId: z.string().min(1, '回执项缺少课程'),
  requirementId: z.string().min(1, '回执项缺少毕业要求'),
  status: z.enum(['已附议', '已退回']),
  comment: z.string().default(''),
  merged: z.boolean().optional().default(false),
})

export const receiptSchema = z.object({
  id: z.string().min(1, '回执缺少编号'),
  source: z.string().min(1, '请填写回执来源'),
  receivedRevision: z.string().min(1, '请填写收到版本号'),
  scope: z.array(z.string().min(1)).min(1, '请填写负责的毕业要求'),
  items: z.array(receiptItemSchema).min(1, '回执至少包含一项审阅结果'),
  importedAt: z.string().optional(),
})

export const receiptBatchSchema = z.object({
  receipts: z.array(receiptSchema).min(1, '没有可导入的回执'),
})

export type RevisionInput = z.infer<typeof revisionSchema>
export type ReceiptBatchInput = z.infer<typeof receiptBatchSchema>
