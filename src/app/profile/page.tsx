import { requireUser } from '@/lib/guards';
import { prisma } from '@/lib/prisma';
import LogoutButton from '../logout-button';
import ChangePasswordForm from './change-password-form';
import { labelOrValue, userStatusLabelMap } from '@/lib/labels';
import { formatBeijingTime } from '@/lib/time';

export default async function ProfilePage() {
  const sessionUser = await requireUser();

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: {
      roles: { include: { role: true } },
      _count: {
        select: {
          createdDataRecords: true,
          createdPushJobs: true,
          createdBatches: true
        }
      }
    }
  });

  if (!user) {
    return (
      <main className="container">
        <p className="helper">用户不存在</p>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 960 }}>
      <div className="header">
        <div className="brand">
          <span className="badge">个人中心</span>
          <h1>{user.displayName}</h1>
          <p className="helper">用户名：{user.username} · 角色：{user.roles.map((item) => item.role.roleName).join('、') || '-'}</p>
        </div>
        <a className="button secondary" href="/">返回首页</a>
      </div>

      <section className="grid grid-3">
        <div className="card kpi">
          <div className="label">我的批次</div>
          <div className="value">{user._count.createdBatches}</div>
        </div>
        <div className="card kpi">
          <div className="label">我的录入</div>
          <div className="value">{user._count.createdDataRecords}</div>
        </div>
        <div className="card kpi">
          <div className="label">我的推送</div>
          <div className="value">{user._count.createdPushJobs}</div>
        </div>
      </section>

      <section className="grid grid-2" style={{ marginTop: 20 }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 className="section-title">账号信息</h2>
          <table className="table">
            <tbody>
              <tr><th>用户名</th><td>{user.username}</td></tr>
              <tr><th>显示名称</th><td>{user.displayName}</td></tr>
              <tr><th>部门</th><td>{user.department ?? '-'}</td></tr>
              <tr><th>电话</th><td>{user.phone ?? '-'}</td></tr>
              <tr><th>邮箱</th><td>{user.email ?? '-'}</td></tr>
              <tr><th>状态</th><td>{labelOrValue(userStatusLabelMap, user.status)}</td></tr>
              <tr><th>最后登录</th><td>{formatBeijingTime(user.lastLoginAt)}</td></tr>
              <tr><th>创建时间</th><td>{formatBeijingTime(user.createdAt)}</td></tr>
            </tbody>
          </table>
          <div className="stack" style={{ marginTop: 16 }}>
            <LogoutButton />
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <h2 className="section-title">修改密码</h2>
          <ChangePasswordForm />
        </div>
      </section>
    </main>
  );
}
