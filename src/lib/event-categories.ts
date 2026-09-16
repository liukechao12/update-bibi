import { prisma } from '@/lib/prisma';
import { eventCategoryList } from '@/lib/labels';

export async function getEventCategoryOptions() {
  const databaseCategories = await prisma.eventRecord.findMany({
    distinct: ['category'],
    select: { category: true },
    where: { category: { not: '' } },
    orderBy: { category: 'asc' }
  });

  const result = new Map(eventCategoryList.map((item) => [item.value, item.label]));
  for (const item of databaseCategories) {
    if (!result.has(item.category)) result.set(item.category, item.category);
  }

  return Array.from(result, ([value, label]) => ({ value, label }));
}

export async function eventCategoryExists(category: string) {
  if (eventCategoryList.some((item) => item.value === category)) return true;
  const count = await prisma.eventRecord.count({ where: { category } });
  return count > 0;
}
