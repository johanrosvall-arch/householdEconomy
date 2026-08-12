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
  // Swedish names are the display names: this is an app for Swedish
  // households and the whole interface is in Swedish, so showing "Groceries"
  // next to "Kvar denna månad" reads as a bug. The English `name` in the
  // taxonomy stays as the developer-facing label.
  const rows = CATEGORY_GROUPS.flatMap((group, groupIndex) =>
    group.categories.map((category, index) => ({
      householdId,
      slug: category.slug,
      name: category.nameSv,
      groupSlug: group.slug,
      groupName: group.nameSv,
      kind: group.kind,
      color: group.color,
      icon: group.icon,
      isFixed: category.fixed ?? false,
      isCustom: false,
      sortOrder: groupIndex * 100 + index,
    })),
  );

  const result = await prisma.category.createMany({ data: rows, skipDuplicates: true });

  // Refresh the built-in categories so a taxonomy change (a rename, a new
  // colour) reaches households that already exist. Categories the household
  // created or renamed itself are marked `isCustom` and left alone.
  await Promise.all(
    rows.map((row) =>
      prisma.category.updateMany({
        where: { householdId, slug: row.slug, isCustom: false },
        data: {
          name: row.name,
          groupName: row.groupName,
          color: row.color,
          icon: row.icon,
          isFixed: row.isFixed,
          sortOrder: row.sortOrder,
        },
      }),
    ),
  );

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
