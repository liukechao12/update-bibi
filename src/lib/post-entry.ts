import { prisma } from '@/lib/prisma';
import { captureScreenshotsForRecords } from '@/lib/image-service';
import { pushExistingRecords } from '@/lib/push-workflow';

export type ScreenshotTarget = { id: string; url: string };

function logError(scope: string, error: unknown) {
  console.error(`${scope}:`, error instanceof Error ? error.message : String(error));
}

/** 入库后异步截图，不等结果、不阻塞录入响应。 */
export function scheduleScreenshots(targets: ScreenshotTarget[]): void {
  if (targets.length === 0) return;
  void captureScreenshotsForRecords(targets).catch((error) => logError('后台截图任务异常', error));
}

type PostEntryJob = {
  batchId: string;
  userId: string;
  recordIds: string[];
  screenshots: ScreenshotTarget[];
  /** 写入 DataBatch.remark 前缀，例如「Excel 导入：新增 3 条，更新 1 条」 */
  summary: string;
};

/**
 * 录入响应返回后，在后台把「截图 → 上传 → 推送」跑完。
 *
 * 截图必须先于推送：推送按有无图片决定 v4/v3，反过来等于永远没图。
 * 推送失败的记录由客户接口重试机制兜底；截图失败的记录按既有规则降级 v3。
 */
export function schedulePostEntry(job: PostEntryJob): void {
  if (job.recordIds.length === 0) return;
  void runPostEntry(job).catch((error) => logError('后台导入流水线异常', error));
}

async function runPostEntry(job: PostEntryJob): Promise<void> {
  await captureScreenshotsForRecords(job.screenshots).catch((error) => logError('后台截图失败', error));

  try {
    const pushResult = await pushExistingRecords(job.userId, job.recordIds);
    const failed = pushResult.results.reduce((sum, item) => sum + item.failed, 0);
    const pushed = pushResult.results.reduce((sum, item) => sum + item.inserted, 0);
    await prisma.dataBatch.update({
      where: { id: job.batchId },
      data: {
        status: failed > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
        pushedAt: new Date(),
        pushCount: pushResult.results.length,
        successCount: pushed,
        failCount: failed,
        remark: `${job.summary}；后台推送完成：成功 ${pushed} 条，失败 ${failed} 条${pushResult.skipped ? `，跳过未变化 ${pushResult.skipped} 条` : ''}`
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('后台推送失败', error);
    await prisma.dataBatch
      .update({
        where: { id: job.batchId },
        data: { status: 'FAILED', successCount: 0, failCount: job.recordIds.length, remark: `${job.summary}；后台推送失败：${message}` }
      })
      .catch(() => {});
  }
}
