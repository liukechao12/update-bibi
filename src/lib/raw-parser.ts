import { ParsedRawRecord } from '@/lib/types';

const REQUIRED_LABELS = ['倾向性', '来源', '作者', '时间', '标题', '链接', '摘要', '评论数'];
const OPTIONAL_LABELS = ['粉丝数', '转发数', '转发量', '点赞数', '点赞量', '阅读数', '阅读量', '浏览量'];
const ALL_LABELS = [...REQUIRED_LABELS, ...OPTIONAL_LABELS];

function normalizeLine(line: string) {
  return line.trim();
}

function readValue(block: string, label: string) {
  const line = block
    .split('\n')
    .map(normalizeLine)
    .find((item) => item.startsWith(`${label}:`));

  if (!line) return '';
  return line.slice(label.length + 1).trim();
}

function readValueAny(block: string, labels: string[]) {
  for (const label of labels) {
    const value = readValue(block, label);
    if (value) return value;
  }
  return '';
}

function toNumber(value: string) {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function splitBlocks(sourceText: string) {
  const lines = sourceText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const startsNewBlock = line.startsWith('倾向性:') && current.length > 0;
    const lineLooksLikeRecordField = ALL_LABELS.some((label) => line.startsWith(`${label}:`));

    if (startsNewBlock && lineLooksLikeRecordField) {
      blocks.push(current.join('\n'));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

export function parseRawTextRecords(sourceText: string): ParsedRawRecord[] {
  return splitBlocks(sourceText).map((block) => ({
    tendency: readValue(block, '倾向性'),
    source: readValue(block, '来源'),
    author: readValue(block, '作者'),
    fansCount: toNumber(readValue(block, '粉丝数')),
    time: readValue(block, '时间'),
    title: readValue(block, '标题'),
    link: readValue(block, '链接'),
    summary: readValue(block, '摘要'),
    commentNum: toNumber(readValue(block, '评论数')),
    forwardNum: toNumber(readValueAny(block, ['转发数', '转发量'])),
    praiseNum: toNumber(readValueAny(block, ['点赞数', '点赞量'])),
    viewNum: toNumber(readValueAny(block, ['阅读数', '阅读量', '浏览量']))
  }));
}

export function findMissingFields(rawText: string) {
  const blocks = splitBlocks(rawText);

  return blocks.map((block, index) => {
    const missing = REQUIRED_LABELS.filter((label) => !readValue(block, label));
    return {
      index,
      missing
    };
  });
}

export function extractRawBlocks(sourceText: string) {
  return splitBlocks(sourceText);
}
