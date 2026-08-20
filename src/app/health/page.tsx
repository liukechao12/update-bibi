export default function HealthPage() {
  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 28 }}>
        <span className="badge">健康检查</span>
        <h1 style={{ marginTop: 16 }}>系统运行正常</h1>
        <p className="helper">API 可用性、数据库连接和任务调度会在这里展示。</p>
      </div>
    </main>
  );
}
