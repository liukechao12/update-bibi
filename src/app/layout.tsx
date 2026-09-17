import type { Metadata, Viewport } from 'next';
import TopNav from '@/components/top-nav';
import './globals.css';

export const metadata: Metadata = {
  title: '数据同步推送平台',
  description: '支持多人录入、Excel 导入、自动推送和结果追踪的数据同步系统'
};

// 移动端 viewport：禁用用户缩放以避免 iOS 输入框放大时页面抖动
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  themeColor: '#2f6fed'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <TopNav />
        <main className="page-body">{children}</main>
      </body>
    </html>
  );
}
