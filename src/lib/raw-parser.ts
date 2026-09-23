import { ParsedRawRecord } from '@/lib/types';
import { normalizePublishTimeToDate } from '@/lib/mapping';

const REQUIRED_LABELS = ['倾向性', '来源', '作者', '时间', '标题', '链接', '简述', '评论数'];
const CRAWL_TIME_LABELS = ['采集时间', '抓取时间', '爬取时间', 'crawlTime'];
const OPTIONAL_LABELS = ['粉丝数', '转发数', '转发量', '点赞数', '点赞量', '阅读数', '阅读量', '浏览量', '认证类型', '摘要', ...CRAWL_TIME_LABELS];
const ALL_LABELS = [...REQUIRED_LABELS, ...OPTIONAL_LABELS];
const SUMMARY_LABELS = ['简述', '摘要'];

export function normalizeRawCrawlTime(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const date = normalizePublishTimeToDate(value);
  // 无时区原文按北京时间解释；非法值保留给 schema 拒绝，不能替换成当前时间。
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function normalizeLine(line: string) {
  return line.trim();
}

function getLineLabel(line: string) {
  const bracketMatch = line.match(/^【([^】]+)】/);
  if (bracketMatch) return bracketMatch[1];
  const colonMatch = line.match(/^([^:：]+)[:：]/);
  return colonMatch ? colonMatch[1].trim() : '';
}

function readValue(block: string, label: string) {
  const lines = block.split('\n').map(normalizeLine).filter(Boolean);
  const colonPrefixes = [`${label}:`, `${label}：`];
  const bracketPrefix = `【${label}】`;
  const line = lines.find((item) => colonPrefixes.some((prefix) => item.startsWith(prefix)) || item.startsWith(bracketPrefix));
  if (!line) return '';

  if (line.startsWith(bracketPrefix)) return line.slice(bracketPrefix.length).trim();
  const prefix = colonPrefixes.find((item) => line.startsWith(item));
  return prefix ? line.slice(prefix.length).trim() : '';
}

function readValueAny(block: string, labels: string[]) {
  for (const label of labels) {
    const value = readValue(block, label);
    if (value) return value;
  }
  return '';
}

function toNumber(value: string) {
  if (!value || value.trim() === '' || value.trim() === '-' || value.trim() === '—') return null;
  const normalized = value.replace(/,/g, '').trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function splitBlocks(sourceText: string) {
  const lines = sourceText.split('\n').map(normalizeLine).filter(Boolean);
  const blocks: string[] = [];
  let current: string[] = [];
  const seenLabels = new Set<string>();

  for (const line of lines) {
    const label = getLineLabel(line);
    const isKnownField = ALL_LABELS.includes(label);
    const startsNewBlock = current.length > 0 && isKnownField && seenLabels.has(label);

    if (startsNewBlock) {
      blocks.push(current.join('\n'));
      current = [line];
      seenLabels.clear();
      seenLabels.add(label);
      continue;
    }

    current.push(line);
    if (isKnownField) seenLabels.add(label);
  }

  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

export function parseRawTextRecords(sourceText: string): ParsedRawRecord[] {
  return splitBlocks(sourceText).map((block) => ({
    tendency: readValue(block, '倾向性'),
    source: readValue(block, '来源'),
    author: readValue(block, '作者'),
    fansCount: toNumber(readValue(block, '粉丝数')),
    time: readValue(block, '时间'),
    crawlTime: normalizeRawCrawlTime(readValueAny(block, CRAWL_TIME_LABELS) || undefined),
    title: readValue(block, '标题'),
    link: readValue(block, '链接'),
    summary: readValueAny(block, SUMMARY_LABELS),
    certType: readValue(block, '认证类型'),
    commentNum: toNumber(readValue(block, '评论数')),
    forwardNum: toNumber(readValueAny(block, ['转发数', '转发量'])),
    praiseNum: toNumber(readValueAny(block, ['点赞数', '点赞量'])),
    viewNum: toNumber(readValueAny(block, ['阅读数', '阅读量', '浏览量']))
  }));
}

export function findMissingFields(rawText: string) {
  return splitBlocks(rawText).map((block, index) => ({
    index,
    missing: REQUIRED_LABELS.filter((label) => {
      if (label === '简述') return !readValueAny(block, SUMMARY_LABELS);
      return !readValue(block, label);
    })
  }));
}

export function findMissingTendency(rawText: string) {
  return parseRawTextRecords(rawText).some((record) => !record.tendency?.trim());
}

export function extractRawBlocks(sourceText: string) {
  return splitBlocks(sourceText);
}
