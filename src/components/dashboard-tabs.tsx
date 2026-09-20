'use client';

import { useState } from 'react';
import WeiboHotTab from '@/components/weibo-hot-tab';

type TabKey = 'overview' | 'weibo';

export default function DashboardTabs({ overview }: { overview: React.ReactNode }) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [weiboMounted, setWeiboMounted] = useState(false);

  function switchTab(next: TabKey) {
    setTab(next);
    if (next === 'weibo') setWeiboMounted(true);
  }

  return (
    <>
      <div className="home-tabs" role="tablist" aria-label="首页视图切换">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`home-tab ${tab === 'overview' ? 'active' : ''}`}
          onClick={() => switchTab('overview')}
        >
          数据概览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'weibo'}
          className={`home-tab ${tab === 'weibo' ? 'active' : ''}`}
          onClick={() => switchTab('weibo')}
        >
          微博热点
        </button>
      </div>

      <div role="tabpanel" hidden={tab !== 'overview'}>
        {overview}
      </div>

      {tab === 'weibo' && weiboMounted ? <WeiboHotTab /> : null}
    </>
  );
}
