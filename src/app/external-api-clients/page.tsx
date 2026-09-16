import { requireAdmin } from '@/lib/guards';
import { prisma } from '@/lib/prisma';
import ExternalApiClientsClient from './external-api-clients-client';

export default async function ExternalApiClientsPage() {
  await requireAdmin();

  const [clients, eventCategories, users] = await Promise.all([
    prisma.externalApiClient.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, displayName: true, username: true } },
        eventScopes: true,
        _count: { select: { requestLogs: true } }
      }
    }),
    prisma.eventRecord.groupBy({ by: ['category'], _count: { _all: true } }).catch(() => []),
    prisma.user.findMany({ select: { id: true, displayName: true, username: true }, orderBy: { displayName: 'asc' } })
  ]);

  return (
    <main className="container">
      <div className="header">
        <div className="brand">
          <span className="badge">开放 API 管理</span>
          <h1>外部事件查询客户</h1>
          <p>为客户生成 API Key，并限制可访问的事件项目。</p>
        </div>
        <a className="button secondary" href="/settings">返回系统配置</a>
      </div>

      <ExternalApiClientsClient
        initialClients={clients as never}
        eventCategories={eventCategories as never}
        users={users}
      />
    </main>
  );
}
