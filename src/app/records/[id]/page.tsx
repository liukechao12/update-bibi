import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/guards';
import { formatBeijingTime } from '@/lib/time';
import { labelOrValue, originTypeLabelMap, publisherTypeLabelMap, authorTypeLabelMap, recordStatusLabelMap } from '@/lib/labels';

export default async function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const record = await prisma.dataRecord.findUnique({
    where: { id },
    include: {
      batch: { include: { createdBy: true } },
      createdBy: true,
      pushItems: { include: { pushJob: true } }
    }
  });

  if (!record) {
    notFound();
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { roles: { include: { role: true } } }
  });

  const isAdmin = Boolean(currentUser?.roles?.some((item) => item.role.roleCode === 'SUPER_ADMIN'));
  if (!isAdmin && record.createdById !== user.id) {
    notFound();
  }

  const tone = (status: string) => {
    switch (status) {
      case 'SUCCESS':
        return { bg: '#eaf7ef', color: '#0f9d58' };
      case 'FAILED':
        return { bg: '#fdeaea', color: '#d14343' };
      case 'RETRYING':
      case 'PUSHING':
      case 'PENDING_PUSH':
        return { bg: '#fff4e6', color: '#b45309' };
      default:
        return { bg: '#f1f4f9', color: '#6b7a90' };
    }
  };

  const latestPushItem = record.pushItems[0] ? [...record.pushItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] : null;

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">记录详情</span>
          <h1>{record.textId}</h1>
          <p className="helper">标题：{record.title} · 来源：{labelOrValue(originTypeLabelMap, record.originType)} · 作者：{record.author}</p>
        </div>
        <a className="button secondary" href="/records">返回数据记录</a>
      </div>

      <section className="grid grid-4" style={{ marginTop: 0 }}>
        <div className="card kpi"><div className="label">评论数</div><div className="value">{record.commentNum}</div></div>
        <div className="card kpi"><div className="label">转发数</div><div className="value">{record.forwardNum ?? 0}</div></div>
        <div className="card kpi"><div className="label">点赞数</div><div className="value">{record.praiseNum ?? 0}</div></div>
        <div className="card kpi"><div className="label">阅读数</div><div className="value">{record.viewNum ?? 0}</div></div>
      </section>

      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">当前状态</h2>
          <table className="table">
            <tbody>
              <tr><th>状态</th><td>{labelOrValue(recordStatusLabelMap, record.recordStatus)}</td></tr>
              <tr><th>是否重复</th><td>{record.isDuplicate ? '是' : '否'}</td></tr>
              <tr><th>所属批次</th><td>{record.batch ? <Link href={`/batches/${record.batch.id}`}>{record.batch.batchNo}</Link> : '-'}</td></tr>
              <tr><th>提交人</th><td>{record.createdBy?.displayName ?? '-'}</td></tr>
              <tr><th>创建时间</th><td>{formatBeijingTime(record.createdAt)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="section-title">基本信息</h2>
          <table className="table">
            <tbody>
              <tr><th>textId</th><td>{record.textId}</td></tr>
              <tr><th>标题</th><td>{record.title}</td></tr>
              <tr><th>作者</th><td>{record.author}</td></tr>
              <tr><th>来源</th><td>{labelOrValue(originTypeLabelMap, record.originType)}</td></tr>
              <tr><th>媒体属性</th><td>{labelOrValue(publisherTypeLabelMap, record.publisherType)}</td></tr>
              <tr><th>作者分类</th><td>{labelOrValue(authorTypeLabelMap, record.authorType)}</td></tr>
              <tr><th>链接</th><td><a href={record.url} target="_blank" rel="noreferrer">{record.url}</a></td></tr>
              <tr><th>发布时间</th><td>{formatBeijingTime(record.publishTime)}</td></tr>
              <tr><th>评论数</th><td>{record.commentNum}</td></tr>
              <tr><th>转发数</th><td>{record.forwardNum ?? '-'}</td></tr>
              <tr><th>点赞数</th><td>{record.praiseNum ?? '-'}</td></tr>
              <tr><th>阅读数</th><td>{record.viewNum ?? '-'}</td></tr>
              <tr><th>倾向性</th><td>{record.tendency ?? '-'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">正文内容</h2>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'var(--text)' }}>
          {record.text}
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 20 }}>
        <h2 className="section-title">推送历史</h2>
        {record.pushItems.length === 0 ? (
          <p className="helper">该记录尚未推送</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>任务号</th>
                <th>序号</th>
                <th>状态</th>
                <th>供应商响应码</th>
                <th>失败原因</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {record.pushItems
                .slice()
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .map((item) => {
                  const t = tone(item.status);
                  return (
                    <tr key={item.id}>
                      <td><Link href={`/batches/${record.batch?.id ?? ''}`}>{item.pushJob.jobNo}</Link></td>
                      <td>{item.itemIndex}</td>
                      <td>
                        <span style={{ background: t.bg, color: t.color, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                          {item.status}
                        </span>
                      </td>
                      <td>{item.vendorResponseCode ?? '-'}</td>
                      <td>{item.errorMessage ?? '-'}</td>
                      <td>{formatBeijingTime(item.createdAt)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
        {latestPushItem ? (
          <p className="helper" style={{ marginTop: 12 }}>
            最近一次推送状态：{latestPushItem.status} · {formatBeijingTime(latestPushItem.createdAt)}
          </p>
        ) : null}
      </div>
    </main>
  );
}
