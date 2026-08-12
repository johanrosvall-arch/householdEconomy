import { CATEGORY_GROUPS } from '@household/shared';
import { prisma } from '../prisma.js';

/**
 * Seeds a new household's category list from the shared taxonomy.
 *
 * Categories are copied per household rather than referenced globally so a
 * household can rename "Lunch" to "Fika-budget" or add "Segelbåt" without
 * touching anyone else's data.
 */
export async function seedCategories(householdId: string): Promise<number> {
  const rows = CATEGORY_GROUPS.flatMap((group, groupIndex) =>
    group.categories.map((category, index) => ({
      householdId,
      slug: category.slug,
      name: category.name,
      groupSlug: group.slug,
      groupName: group.name,
      kind: group.kind,
      color: group.color,
      icon: group.icon,
      isFixed: category.fixed ?? false,
      isCustom: false,
      sortOrder: groupIndex * 100 + index,
    })),
  );

  const result = await prisma.category.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

export async function createHousehold(input: {
  name: string;
  userId: string;
  baseCurrency?: string;
}): Promise<{ id: string }> {
  const household = await prisma.household.create({
    data: {
      name: input.name,
      baseCurrency: input.baseCurrency ?? 'SEK',
      members: { create: { userId: input.userId, role: 'owner' } },
    },
    select: { id: true },
  });

  await seedCategories(household.id);
  return household;
}
