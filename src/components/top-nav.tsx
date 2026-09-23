import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import TopNavClient, { NavItem } from '@/components/top-nav-client';

const navItems: NavItem[] = [
  { href: '/', label: '首页', icon: 'home' },
  { href: '/data-entry', label: '粘贴录入', icon: 'paste' },
  { href: '/excel-import', label: 'Excel 导入', icon: 'excel' },
  { href: '/batches', label: '批次管理', icon: 'batch' },
  { href: '/records', label: '数据记录', icon: 'record' },
  { href: '/plugin-records', label: '插件数据', icon: 'api', adminOnly: true },
  { href: '/event-records', label: '事件数据', icon: 'event' },
  { href: '/push-jobs', label: '推送日志', icon: 'push' },
  { href: '/profile', label: '个人中心', icon: 'profile' },
  { href: '/users', label: '人员管理', icon: 'users', adminOnly: true },
  { href: '/media-libraries', label: '媒体库管理', icon: 'library' },
  { href: '/media-capabilities', label: '采集能力', icon: 'library' },
  { href: '/external-api-clients', label: '开放API', icon: 'api', adminOnly: true },
  { href: '/external-api-logs', label: 'API日志', icon: 'log', adminOnly: true },
  { href: '/settings', label: '系统配置', icon: 'settings', adminOnly: true }
];

export default async function TopNav() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <header className="topnav">
        <div className="topnav-inner">
          <TopNavClient user={null} visibleItems={[]} />
        </div>
      </header>
    );
  }

  const isAdmin = Boolean(user.roles?.includes('SUPER_ADMIN'));
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <TopNavClient
          user={{ displayName: user.displayName }}
          visibleItems={visibleItems}
        />
      </div>
    </header>
  );
}
