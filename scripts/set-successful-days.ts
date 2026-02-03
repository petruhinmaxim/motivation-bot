import { eq, and } from 'drizzle-orm';
import { db, closeDatabase } from '../src/database/client.js';
import { challenges } from '../src/database/schema.js';

// Использование: npm run db:set-days -- <userId> [successfulDays]
// Пример: npm run db:set-days -- 7057620186 29
const userId = parseInt(process.argv[2], 10);
const newSuccessfulDays = parseInt(process.argv[3] ?? '29', 10);

if (!userId || isNaN(userId)) {
  console.error('Использование: npm run db:set-days -- <userId> [successfulDays]');
  console.error('Пример: npm run db:set-days -- 7057620186 29');
  process.exit(1);
}

async function main() {
  const result = await db
    .update(challenges)
    .set({
      successfulDays: newSuccessfulDays,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(challenges.userId, userId),
        eq(challenges.status, 'active')
      )
    )
    .returning({ id: challenges.id, successfulDays: challenges.successfulDays });

  if (result.length === 0) {
    console.log(`Активный челлендж для пользователя ${userId} не найден`);
    process.exit(1);
  }

  console.log(`Обновлено: successfulDays = ${newSuccessfulDays} для challenge id=${result[0].id}`);
  await closeDatabase();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
