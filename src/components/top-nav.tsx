import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import LogoutButton from '@/app/logout-button';

type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

const navItems: NavItem[] = [
  { href: '/', label: '首页', icon: 'home' },
  { href: '/data-entry', label: '粘贴录入', icon: 'paste' },
  { href: '/excel-import', label: 'Excel 导入', icon: 'excel' },
  { href: '/batches', label: '批次管理', icon: 'batch' },
  { href: '/records', label: '数据记录', icon: 'record' },
  { href: '/event-records', label: '事件数据', icon: 'event' },
  { href: '/push-jobs', label: '推送日志', icon: 'push' },
  { href: '/profile', label: '个人中心', icon: 'profile' },
  { href: '/users', label: '人员管理', icon: 'users', adminOnly: true },
  { href: '/media-libraries', label: '媒体库管理', icon: 'library' },
  { href: '/external-api-clients', label: '开放API', icon: 'api', adminOnly: true },
  { href: '/external-api-logs', label: 'API日志', icon: 'log', adminOnly: true },
  { href: '/settings', label: '系统配置', icon: 'settings', adminOnly: true }
];

const icons: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h14V10',
  paste: 'M9 5h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 5V3h6v2M9 12h6M9 16h4',
  excel: 'M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM14 4v4h4M9.5 13l2 2.2-2 2.2M14.5 13l-2 2.2 2 2.2',
  batch: 'M4 6h16M4 12h16M4 18h10M5 4h2v4H5zM11 4h2v4h-2zM17 4h2v4h-2z',
  record: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 8h8M8 12h8M8 16h5',
  event: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 20a8 8 0 0 1 16 0M12 12v3M10 15h4',
  push: 'M12 3v9m0 0 3.5-3.5M12 12 8.5 8.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  users: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 20a6.5 6.5 0 0 0-3-5.5',
  library: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11ZM8 7h8M8 11h8M8 15h5',
  api: 'M8 8h8M8 12h5M8 16h8M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Z',
  log: 'M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4h6M9 12h6M9 16h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V20a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 18.3a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 2.6V2a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 3.7l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.6Z'
};

function Icon({ name }: { name: string }) {
  const path = icons[name] ?? icons.home;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export default async function TopNav() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <header className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="topnav-logo">
            <span className="topnav-logo-mark">DS</span>
            <span className="topnav-logo-text">数据同步推送平台</span>
          </Link>
          <div className="topnav-user">
            <Link href="/login" className="button">登录</Link>
          </div>
        </div>
      </header>
    );
  }

  const isAdmin = Boolean(user.roles?.includes('SUPER_ADMIN'));
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/" className="topnav-logo">
          <span className="topnav-logo-mark">DS</span>
          <span className="topnav-logo-text">数据同步推送平台</span>
        </Link>

        <nav className="topnav-menu">
          {visibleItems.map((item) => (
            <Link key={item.href} href={item.href} className="topnav-item">
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="topnav-user">
          <span className="topnav-user-name">{user.displayName}</span>
          <span className="topnav-user-sep" />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
