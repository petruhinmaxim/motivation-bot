import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { challenges } from '../database/schema.js';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { getPhotoUploadKey } from '../redis/keys.js';
import { getYesterdayDateString } from '../utils/date-utils.js';

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

  /**
   * Обновляет время напоминаний и статус напоминаний для активного челленджа
   */
  async updateReminderTime(userId: number, reminderTime: string): Promise<void> {
    try {
      await db
        .update(challenges)
        .set({
          reminderTime,
          reminderStatus: true,
          updatedAt: new Date(),
        })
        .where(eq(challenges.userId, userId));
      logger.info(`Updated reminder time for user ${userId}: ${reminderTime}`);
    } catch (error) {
      logger.error(`Error updating reminder time for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отключает напоминания для активного челленджа и удаляет время напоминания
   */
  async disableReminders(userId: number): Promise<void> {
    try {
      await db
        .update(challenges)
        .set({
          reminderStatus: false,
          reminderTime: null,
          updatedAt: new Date(),
        })
        .where(eq(challenges.userId, userId));
      logger.info(`Disabled reminders and cleared reminder time for user ${userId}`);
    } catch (error) {
      logger.error(`Error disabling reminders for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет, было ли уже загружено фото сегодня
   * @param userId - ID пользователя
   * @param date - Дата в формате YYYY-MM-DD
   * @returns true, если фото уже было загружено сегодня
   */
  async hasPhotoUploadedToday(userId: number, date: string): Promise<boolean> {
    try {
      const key = getPhotoUploadKey(userId, date);
      const value = await redis.get(key);
      return value !== null;
    } catch (error) {
      logger.error(`Error checking photo upload for user ${userId} on ${date}:`, error);
      return false;
    }
  }

  /**
   * Увеличивает successfulDays на 1 и отмечает, что фото было загружено сегодня
   * @param userId - ID пользователя
   * @param date - Дата в формате YYYY-MM-DD
   * @returns true, если операция успешна, false если фото уже было загружено сегодня
   */
  async incrementSuccessfulDays(userId: number, date: string): Promise<boolean> {
    try {
      // Проверяем, было ли уже загружено фото сегодня
      const alreadyUploaded = await this.hasPhotoUploadedToday(userId, date);
      if (alreadyUploaded) {
        return false;
      }

      // Получаем текущее значение successfulDays
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      // Увеличиваем successfulDays и обнуляем счетчик пропущенных дней
      await db
        .update(challenges)
        .set({
          successfulDays: challenge.successfulDays + 1,
          daysWithoutWorkout: 0, // Обнуляем счетчик пропущенных дней после загрузки фото
          updatedAt: new Date(),
        })
        .where(eq(challenges.userId, userId));

      // Отмечаем, что фото было загружено сегодня (ключ истекает через 24 часа)
      const key = getPhotoUploadKey(userId, date);
      await redis.setex(key, 86400, '1'); // 86400 секунд = 24 часа

      logger.info(`Incremented successfulDays for user ${userId} on ${date}`);
      return true;
    } catch (error) {
      logger.error(`Error incrementing successfulDays for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет и увеличивает счетчик дней без тренировки, если фото не было загружено вчера
   * Вызывается в полночь по часовому поясу пользователя
   * @param userId - ID пользователя
   * @param timezoneOffset - Смещение часового пояса от UTC в часах
   */
  async checkAndIncrementMissedDays(userId: number, timezoneOffset: number): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge || challenge.status !== 'active') {
        return;
      }

      // Получаем вчерашнюю дату в часовом поясе пользователя
      const yesterdayDate = getYesterdayDateString(timezoneOffset);

      // Проверяем, было ли загружено фото вчера
      const hadPhotoYesterday = await this.hasPhotoUploadedToday(userId, yesterdayDate);

      if (!hadPhotoYesterday) {
        // Увеличиваем счетчик дней без тренировки
        await db
          .update(challenges)
          .set({
            daysWithoutWorkout: challenge.daysWithoutWorkout + 1,
            updatedAt: new Date(),
          })
          .where(eq(challenges.userId, userId));

        logger.info(`Incremented daysWithoutWorkout for user ${userId} (yesterday: ${yesterdayDate})`);
      } else {
        logger.debug(`Photo was uploaded yesterday for user ${userId}, no increment needed`);
      }
    } catch (error) {
      logger.error(`Error checking and incrementing missed days for user ${userId}:`, error);
    }
  }

  /**
   * Получает все активные челленджи (для полночной проверки)
   */
  async getAllActiveChallenges() {
    const result = await db
      .select()
      .from(challenges)
      .where(eq(challenges.status, 'active'));

    return result;
  }
}

export const challengeService = new ChallengeService();
