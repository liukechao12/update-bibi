import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/api-auth';

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const source = String(body?.source ?? '').trim();
  const author = String(body?.author ?? '').trim();
  const url = String(body?.url ?? '').trim();

  const domain = extractDomain(url);

  const candidates = await prisma.mediaLibrary.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        domain ? { domain: { contains: domain } } : undefined,
        author ? { authorName: { contains: author } } : undefined
      ].filter(Boolean) as Array<Record<string, unknown>>
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  const exact = candidates.find((item) => {
    const domainHit = domain && item.domain ? normalize(item.domain).includes(domain) : false;
    const authorHit = author && item.authorName ? normalize(item.authorName).includes(normalize(author)) : false;
    return domainHit || authorHit;
  });

  return NextResponse.json({
    matched: Boolean(exact),
    mediaLibrary: exact ?? null,
    domain,
    author,
    source
  });
}
