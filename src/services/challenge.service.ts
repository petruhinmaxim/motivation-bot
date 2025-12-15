import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { challenges } from '../database/schema.js';
import logger from '../utils/logger.js';

export class ChallengeService {
  /**
   * Создает или обновляет челлендж для пользователя
   * Если запись уже существует, обновляет статус на активен и другие поля
   */
  async createOrUpdateChallenge(
    userId: number,
    duration: number,
    startDate: Date = new Date()
  ): Promise<void> {
    try {
      // Проверяем, есть ли уже запись для пользователя
      const existingChallenge = await db
        .select()
        .from(challenges)
        .where(eq(challenges.userId, userId))
        .limit(1);

      if (existingChallenge.length > 0) {
        // Обновляем существующую запись
        await db
          .update(challenges)
          .set({
            status: 'active',
            duration,
            startDate,
            updatedAt: new Date(),
          })
          .where(eq(challenges.userId, userId));
        logger.info(`Updated challenge for user ${userId} with duration ${duration} days`);
      } else {
        // Создаем новую запись
        await db.insert(challenges).values({
          userId,
          startDate,
          status: 'active',
          duration,
          restartCount: 0,
          daysWithoutWorkout: 0,
          successfulDays: 0,
          reminderStatus: false,
        });
        logger.info(`Created new challenge for user ${userId} with duration ${duration} days`);
      }
    } catch (error) {
      logger.error(`Error creating/updating challenge for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получает активный челлендж пользователя
   */
  async getActiveChallenge(userId: number) {
    const result = await db
      .select()
      .from(challenges)
      .where(eq(challenges.userId, userId))
      .limit(1);

    return result[0] || null;
  }
}

export const challengeService = new ChallengeService();
