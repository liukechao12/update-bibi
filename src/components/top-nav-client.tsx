'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import LogoutButton from '@/app/logout-button';

// 与服务端共享的导航条目类型，类型只在编译期使用不跨传输
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

type TopNavClientProps = {
  user: { displayName: string } | null;
  visibleItems: NavItem[];
};

type NavGroup = {
  label: string;
  icon: string;
  items: NavItem[];
};

// 图标 SVG path 集合，client 内保留一份本地映射避免和 server 共享运行期对象
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

const primaryHrefs = new Set(['/', '/data-entry', '/excel-import', '/records', '/event-records']);

const groupConfig = [
  {
    label: '批次与推送',
    icon: 'batch',
    hrefs: ['/batches', '/push-jobs']
  },
  {
    label: '资料管理',
    icon: 'library',
    hrefs: ['/media-libraries']
  },
  {
    label: '系统管理',
    icon: 'settings',
    hrefs: ['/users', '/external-api-clients', '/external-api-logs', '/settings', '/profile']
  }
] as const;

function Icon({ name }: { name: string }) {
  const path = icons[name] ?? icons.home;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function isCurrent(pathname: string | null, href: string) {
  return href === '/'
    ? pathname === '/'
    : pathname === href || pathname?.startsWith(`${href}/`);
}

// 汉堡图标 & 关闭图标
function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export default function TopNavClient({ user, visibleItems }: TopNavClientProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const primaryItems = visibleItems.filter((item) => primaryHrefs.has(item.href));
  const groupedItems: NavGroup[] = groupConfig
    .map((group) => ({
      label: group.label,
      icon: group.icon,
      items: group.hrefs
        .map((href) => visibleItems.find((item) => item.href === href))
        .filter((item): item is NavItem => Boolean(item))
    }))
    .filter((group) => group.items.length > 0);

  // 路由切换时自动关闭抽屉
  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // 关闭 body 滚动（抽屉打开时）+ ESC 键关闭抽屉
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <>
      {/* ====== 左侧 logo + 主菜单（中大屏使用） ====== */}
      <Link href="/" className="topnav-logo">
        <span className="topnav-logo-mark">DS</span>
        <span className="topnav-logo-text">数据同步推送平台</span>
      </Link>

      <nav className="topnav-menu" aria-label="主导航">
        {primaryItems.map((item) => {
          const current = isCurrent(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="topnav-item"
              aria-current={current ? 'page' : undefined}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {groupedItems.map((group) => {
          const active = group.items.some((item) => isCurrent(pathname, item.href));
          return (
            <div key={group.label} className="topnav-dropdown">
              <button
                type="button"
                className="topnav-item topnav-dropdown-trigger"
                aria-expanded={active ? 'true' : undefined}
              >
                <Icon name={group.icon} />
                <span>{group.label}</span>
                <span className="topnav-chevron">⌄</span>
              </button>
              <div className="topnav-dropdown-panel">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="topnav-dropdown-link"
                    aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ====== 右上角用户区 + 移动端汉堡按钮 ====== */}
      <div className="topnav-user">
        {user ? (
          <>
            <span className="topnav-user-name">{user.displayName}</span>
            <span className="topnav-user-sep" />
            <LogoutButton />
          </>
        ) : (
          <Link href="/login" className="button">登录</Link>
        )}

        <button
          type="button"
          className="topnav-burger"
          aria-label={open ? '关闭菜单' : '打开菜单'}
          aria-expanded={open}
          aria-controls="mobile-drawer"
          onClick={() => setOpen(!open)}
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {/* ====== 遮罩层（点击关闭） ====== */}
      {open ? (
        <div
          className="topnav-overlay"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* ====== 移动端抽屉 ====== */}
      <aside
        id="mobile-drawer"
        className={`topnav-drawer ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="移动端导航"
      >
        <div className="topnav-drawer-header">
          <span className="topnav-drawer-title">导航菜单</span>
          <button
            type="button"
            className="link-button"
            onClick={() => setOpen(false)}
            aria-label="关闭菜单"
          >
            关闭
          </button>
        </div>

        {user ? (
          <div className="topnav-drawer-user">
            <div className="topnav-drawer-user-name">{user.displayName}</div>
            <LogoutButton />
          </div>
        ) : null}

        <nav className="topnav-drawer-menu" aria-label="移动端导航列表">
          {primaryItems.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="topnav-drawer-item"
                aria-current={current ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {groupedItems.map((group) => (
            <div key={group.label} className="topnav-drawer-group">
              <div className="topnav-drawer-group-title">
                <Icon name={group.icon} />
                <span>{group.label}</span>
              </div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="topnav-drawer-item topnav-drawer-subitem"
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
