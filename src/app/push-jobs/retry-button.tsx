'use client';

import { useState } from 'react';

export default function RetryButton({ jobId }: { jobId: string }) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/push/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId })
      });
      const data = await res.json();
      setMessage(res.ok ? '重推完成' : data.message ?? '重推失败');
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <button className="button secondary" onClick={handleRetry} disabled={loading}>
        {loading ? '重推中...' : '重推'}
      </button>
      {message ? <span className="helper">{message}</span> : null}
    </div>
  );
}
