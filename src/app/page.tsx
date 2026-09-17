import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { formatBeijingTime } from '@/lib/time';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfYesterday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

function formatPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? '0%' : '+100%';
  const diff = ((current - previous) / previous) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  const isAdmin = Boolean(user.roles?.includes('SUPER_ADMIN'));

  const today = startOfToday();
  const yesterday = startOfYesterday();
  const beforeYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - 1);

  const userFilter: Prisma.DataRecordWhereInput = isAdmin ? {} : { createdById: user.id };
  const userBatchFilter: Prisma.DataBatchWhereInput = isAdmin ? {} : { createdById: user.id };
  const userJobFilter: Prisma.PushJobWhereInput = isAdmin ? {} : { createdById: user.id };

  const [
    todayRecords,
    todaySuccessPushJobs,
    todayFailedPushJobs,
    pendingBatches,
    totalBatches,
    totalRecords,
    totalPushJobs,
    yesterdayRecords,
    yesterdaySuccessPushJobs,
    yesterdayFailedPushJobs,
    beforeYesterdayRecords,
    beforeYesterdaySuccessPushJobs,
    beforeYesterdayFailedPushJobs
  ] = await Promise.all([
    prisma.dataRecord.count({ where: { ...userFilter, createdAt: { gte: today } } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: today }, status: 'SUCCESS' } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: today }, status: 'FAILED' } }),
    prisma.dataBatch.count({ where: { ...userBatchFilter, status: { in: ['PENDING_PUSH', 'PUSHING'] } } }),
    prisma.dataBatch.count({ where: userBatchFilter }),
    prisma.dataRecord.count({ where: userFilter }),
    prisma.pushJob.count({ where: userJobFilter }),
    prisma.dataRecord.count({ where: { ...userFilter, createdAt: { gte: yesterday, lt: today } } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: yesterday, lt: today }, status: 'SUCCESS' } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: yesterday, lt: today }, status: 'FAILED' } }),
    prisma.dataRecord.count({ where: { ...userFilter, createdAt: { gte: beforeYesterday, lt: yesterday } } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: beforeYesterday, lt: yesterday }, status: 'SUCCESS' } }),
    prisma.pushJob.count({ where: { ...userJobFilter, createdAt: { gte: beforeYesterday, lt: yesterday }, status: 'FAILED' } })
  ]);

  const totalUsers = isAdmin ? await prisma.user.count() : null;

  const todayKpis = [
    { label: '今日新增数据', value: todayRecords, delta: formatPercent(todayRecords, yesterdayRecords) },
    { label: '今日成功推送', value: todaySuccessPushJobs, delta: formatPercent(todaySuccessPushJobs, yesterdaySuccessPushJobs) },
    { label: '今日失败记录', value: todayFailedPushJobs, delta: formatPercent(todayFailedPushJobs, yesterdayFailedPushJobs) },
    { label: '待推送批次', value: pendingBatches, delta: '实时' }
  ];

  const totalKpis = [
    ...(isAdmin ? [{ label: '用户总数', value: totalUsers ?? 0 }] : []),
    { label: '批次总数', value: totalBatches },
    { label: '记录总数', value: totalRecords },
    { label: '推送任务总数', value: totalPushJobs }
  ];

  const recentBatches = await prisma.dataBatch.findMany({
    where: userBatchFilter,
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      createdBy: true,
      _count: { select: { records: true, pushJobs: true } }
    }
  });

  const recentJobs = await prisma.pushJob.findMany({
    where: userJobFilter,
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { createdBy: true, batch: true }
  });

  const activitySummary = [
    {
      label: '新增数据趋势',
      today: todayRecords,
      yesterday: yesterdayRecords,
      delta: formatPercent(todayRecords, yesterdayRecords)
    },
    {
      label: '成功推送趋势',
      today: todaySuccessPushJobs,
      yesterday: yesterdaySuccessPushJobs,
      delta: formatPercent(todaySuccessPushJobs, yesterdaySuccessPushJobs)
    },
    {
      label: '失败记录趋势',
      today: todayFailedPushJobs,
      yesterday: yesterdayFailedPushJobs,
      delta: formatPercent(todayFailedPushJobs, yesterdayFailedPushJobs)
    }
  ];

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">数据同步推送平台</span>
          <h1>舆情数据录入、推送与管理中心</h1>
          <p>支持多人协作、Excel 导入、自动推送、结果追踪和权限管理。</p>
          <p className="helper">当前用户：{user.displayName}（{user.username}）{isAdmin ? '· 管理员' : '· 普通用户'}</p>
        </div>
      </div>

      <section className="grid grid-4">
        {todayKpis.map((item) => (
          <div className="card kpi" key={item.label}>
            <div className="label">{item.label}</div>
            <div className="value">{item.value}</div>
            <div className="helper" style={{ marginTop: 6 }}>{item.delta}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-4" style={{ marginTop: 20 }}>
        {totalKpis.map((item) => (
          <div className="card kpi" key={item.label}>
            <div className="label">{item.label}</div>
            <div className="value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">昨日对比</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>指标</th>
                <th>今日</th>
                <th>昨日</th>
                <th>变化</th>
              </tr>
            </thead>
            <tbody>
              {activitySummary.map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td>{item.today}</td>
                  <td>{item.yesterday}</td>
                  <td>{item.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="header" style={{ marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>最近批次</h2>
            <Link className="button secondary" href="/batches">查看全部</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>提交人</th>
                  <th>方式</th>
                  <th>状态</th>
                  <th>记录数</th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center' }}>暂无数据</td></tr>
                ) : recentBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <Link href={`/batches/${batch.id}`}>{batch.batchNo}</Link>
                    </td>
                    <td>{batch.createdBy?.displayName ?? '-'}</td>
                    <td>{batch.importType}</td>
                    <td>{batch.status}</td>
                    <td>{batch._count.records}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="header" style={{ marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>最近推送</h2>
            <Link className="button secondary" href="/push-jobs">查看全部</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>提交人</th>
                  <th>状态</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center' }}>暂无数据</td></tr>
                ) : recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.jobNo}</td>
                    <td>{job.createdBy?.displayName ?? '-'}</td>
                    <td>{job.status}</td>
                    <td>{job.insertedCount}</td>
                    <td>{job.failedCount}</td>
                    <td>{formatBeijingTime(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
