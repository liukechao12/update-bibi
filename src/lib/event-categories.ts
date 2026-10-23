import { prisma } from '@/lib/prisma';
import { eventCategoryList } from '@/lib/labels';

export async function getEventCategoryOptions() {
  // 使用预定义分类列表，避免在大数据量上执行 distinct 查询
  const result = new Map(eventCategoryList.map((item) => [item.value, item.label]));

  // 检查数据库中是否有额外的分类（不在预定义列表中）
  const dbCategories = await prisma.eventRecord.findMany({
    distinct: ['category'],
    select: { category: true },
    where: {
      category: { not: '' },
      AND: { category: { notIn: Array.from(result.keys()) } }
    }
  });

  for (const item of dbCategories) {
    result.set(item.category, item.category);
  }

  return Array.from(result, ([value, label]) => ({ value, label }));
}

export async function eventCategoryExists(category: string) {
  if (eventCategoryList.some((item) => item.value === category)) return true;
  const count = await prisma.eventRecord.count({ where: { category } });
  return count > 0;
}
