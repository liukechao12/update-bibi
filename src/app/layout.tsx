import type { Metadata } from 'next';
import TopNav from '@/components/top-nav';
import './globals.css';

export const metadata: Metadata = {
  title: '数据同步推送平台',
  description: '支持多人录入、Excel 导入、自动推送和结果追踪的数据同步系统'
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
