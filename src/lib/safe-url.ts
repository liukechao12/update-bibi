// 渲染用户提交的链接前过滤协议，防止 javascript: 等造成存储型 XSS
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined;
}
