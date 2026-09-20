const WEIBO_HOT_INTERVAL_MS = 10 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 多台机器共用一个数据库时，只让一台开定时任务；其余机器设 WEIBO_HOT_SCHEDULER=off（手动抓取不受影响）
    if (process.env.WEIBO_HOT_SCHEDULER === 'off') return;

    const globalStore = globalThis as typeof globalThis & { __weiboHotTimer?: NodeJS.Timeout };
    if (globalStore.__weiboHotTimer) return;

    const { runWeiboHotFetch } = await import('@/lib/weibo-hot');
    const tick = () => {
      runWeiboHotFetch().catch((error) => {
        console.error('[weibo-hot] 抓取失败:', error instanceof Error ? error.message : error);
      });
    };

    tick();
    globalStore.__weiboHotTimer = setInterval(tick, WEIBO_HOT_INTERVAL_MS);
  }
}
