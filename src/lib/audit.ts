import { prisma } from '@/lib/prisma';

export type AuditLogInput = {
  userId: string;
  actionType: string;
  module: string;
  targetId?: string | null;
  actionDesc: string;
  requestData?: unknown;
  resultData?: unknown;
};

export async function writeAuditLog(input: AuditLogInput) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        actionType: input.actionType,
        module: input.module,
        targetId: input.targetId ?? null,
        actionDesc: input.actionDesc,
        requestData: input.requestData as never,
        resultData: input.resultData as never
      }
    });
  } catch {
    // 忽略审计失败，不影响主流程
  }
}
