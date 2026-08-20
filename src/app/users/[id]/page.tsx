import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/guards';
import { batchStatusLabelMap, importTypeLabelMap, labelOrValue, pushJobStatusLabelMap, userStatusLabelMap } from '@/lib/labels';
import { formatBeijingTime } from '@/lib/time';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      roles: { include: { role: true } },
      _count: {
        select: {
          createdBatches: true,
          createdDataRecords: true,
          createdPushJobs: true
        }
      }
    }
  });

  if (!user) {
    notFound();
  }

  const [batches, pushJobs] = await Promise.all([
    prisma.dataBatch.findMany({
      where: { createdById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { _count: { select: { records: true, pushJobs: true } } }
    }),
    prisma.pushJob.findMany({
      where: { createdById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { batch: true }
    })
  ]);

  const kpis = [
    { label: '批次总数', value: user._count.createdBatches },
    { label: '录入总数', value: user._count.createdDataRecords },
    { label: '推送总数', value: user._count.createdPushJobs }
  ];

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">用户详情</span>
          <h1>{user.displayName}</h1>
          <p className="helper">用户名：{user.username} · 部门：{user.department ?? '-'} · 状态：{labelOrValue(userStatusLabelMap, user.status)}</p>
        </div>
        <a className="button secondary" href="/users">返回人员管理</a>
      </div>

      <section className="grid grid-3">
        {kpis.map((item) => (
          <div className="card kpi" key={item.label}>
            <div className="label">{item.label}</div>
            <div className="value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">最近批次</h2>
          {batches.length === 0 ? (
            <p className="helper">暂无批次</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>批次号</th>
                  <th>方式</th>
                  <th>状态</th>
                  <th>记录数</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td><Link href={`/batches/${batch.id}`}>{batch.batchNo}</Link></td>
                    <td>{labelOrValue(importTypeLabelMap, batch.importType)}</td>
                    <td>{labelOrValue(batchStatusLabelMap, batch.status)}</td>
                    <td>{batch._count.records}</td>
                    <td>{formatBeijingTime(batch.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">最近推送</h2>
          {pushJobs.length === 0 ? (
            <p className="helper">暂无推送</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>批次号</th>
                  <th>状态</th>
                  <th>成功</th>
                  <th>失败</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {pushJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.jobNo}</td>
                    <td>{job.batch?.batchNo ?? '-'}</td>
                    <td>{labelOrValue(pushJobStatusLabelMap, job.status)}</td>
                    <td>{job.insertedCount}</td>
                    <td>{job.failedCount}</td>
                    <td>{formatBeijingTime(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">账号信息</h2>
        <table className="table">
          <tbody>
            <tr><th>用户名</th><td>{user.username}</td></tr>
            <tr><th>显示名称</th><td>{user.displayName}</td></tr>
            <tr><th>部门</th><td>{user.department ?? '-'}</td></tr>
            <tr><th>电话</th><td>{user.phone ?? '-'}</td></tr>
            <tr><th>邮箱</th><td>{user.email ?? '-'}</td></tr>
            <tr><th>角色</th><td>{user.roles.map((item) => item.role.roleName).join('、') || '-'}</td></tr>
            <tr><th>状态</th><td>{labelOrValue(userStatusLabelMap, user.status)}</td></tr>
            <tr><th>最后登录</th><td>{formatBeijingTime(user.lastLoginAt)}</td></tr>
            <tr><th>创建时间</th><td>{formatBeijingTime(user.createdAt)}</td></tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
