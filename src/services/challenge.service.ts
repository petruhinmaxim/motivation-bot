import { eq, and, desc } from 'drizzle-orm';
import { db } from '../database/client.js';
import { challenges } from '../database/schema.js';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { getPhotoUploadKey } from '../redis/keys.js';
import { getYesterdayDateString } from '../utils/date-utils.js';

export class ChallengeService {
  /**
   * Создает новый челлендж для пользователя
   * Блокирует создание, если у пользователя уже есть активный челлендж
   */
  async createOrUpdateChallenge(
    userId: number,
    duration: number,
    startDate: Date = new Date()
  ): Promise<void> {
    try {
      // Проверяем, есть ли уже активный челлендж
      const activeChallenge = await this.getActiveChallenge(userId);
      
      if (activeChallenge) {
        throw new Error('User already has an active challenge');
      }

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
    } catch (error) {
      logger.error(`Error creating challenge for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получает активный челлендж пользователя (самый новый активный)
   */
  async getActiveChallenge(userId: number) {
    const result = await db
      .select()
      .from(challenges)
      .where(
        and(
          eq(challenges.userId, userId),
          eq(challenges.status, 'active')
        )
      )
      .orderBy(desc(challenges.id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Обновляет время напоминаний и статус напоминаний для активного челленджа
   */
  async updateReminderTime(userId: number, reminderTime: string): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      await db
        .update(challenges)
        .set({
          reminderTime,
          reminderStatus: true,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));
      logger.info(`Updated reminder time for user ${userId}: ${reminderTime}`);
    } catch (error) {
      logger.error(`Error updating reminder time for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отключает напоминания для активного челленджа (время напоминания сохраняется)
   */
  async disableReminders(userId: number): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      await db
        .update(challenges)
        .set({
          reminderStatus: false,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));
      logger.info(`Disabled reminders for user ${userId} (reminder time preserved)`);
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

      // Получаем активный челлендж
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      // Проверяем, что челлендж активен
      if (challenge.status !== 'active') {
        throw new Error(`Challenge is not active for user ${userId}`);
      }

      // Увеличиваем successfulDays и обнуляем счетчик пропущенных дней
      await db
        .update(challenges)
        .set({
          successfulDays: challenge.successfulDays + 1,
          daysWithoutWorkout: 0, // Обнуляем счетчик пропущенных дней после загрузки фото
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));

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
   * Переводит активный челлендж в статус failed
   * @param userId - ID пользователя
   */
  async failChallenge(userId: number): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        logger.warn(`No active challenge found for user ${userId} to fail`);
        return;
      }

      await db
        .update(challenges)
        .set({
          status: 'failed',
          daysWithoutWorkout: 0,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));

      logger.info(`Failed challenge ${challenge.id} for user ${userId}`);
    } catch (error) {
      logger.error(`Error failing challenge for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет и увеличивает счетчик дней без тренировки, если фото не было загружено вчера
   * Вызывается в 4:00 утра по местному времени пользователя
   * Если daysWithoutWorkout достигает 3, переводит челлендж в статус failed
   * @param userId - ID пользователя
   * @param timezoneOffset - Смещение часового пояса от UTC в часах
   * @returns true, если челлендж был переведен в failed, false в противном случае
   */
  async checkAndIncrementMissedDays(userId: number, timezoneOffset: number): Promise<boolean> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge || challenge.status !== 'active') {
        return false;
      }

      // Получаем вчерашнюю дату в часовом поясе пользователя
      const yesterdayDate = getYesterdayDateString(timezoneOffset);

      // Проверяем, было ли загружено фото вчера
      const hadPhotoYesterday = await this.hasPhotoUploadedToday(userId, yesterdayDate);

      if (!hadPhotoYesterday) {
        const newDaysWithoutWorkout = challenge.daysWithoutWorkout + 1;
        
        // Используем транзакцию для атомарного обновления и проверки
        await db.transaction(async (tx) => {
          // Повторно получаем челлендж в транзакции для проверки актуального состояния
          const currentChallenge = await tx
            .select()
            .from(challenges)
            .where(
              and(
                eq(challenges.userId, userId),
                eq(challenges.status, 'active'),
                eq(challenges.id, challenge.id)
              )
            )
            .limit(1);

          if (currentChallenge.length === 0 || currentChallenge[0].id !== challenge.id) {
            // Челлендж был изменен или удален, выходим
            logger.warn(`Challenge state changed for user ${userId} during transaction`);
            return;
          }

          // Увеличиваем счетчик дней без тренировки
          await tx
            .update(challenges)
            .set({
              daysWithoutWorkout: newDaysWithoutWorkout,
              updatedAt: new Date(),
            })
            .where(eq(challenges.id, challenge.id));

          logger.info(`Incremented daysWithoutWorkout for user ${userId} to ${newDaysWithoutWorkout} (yesterday: ${yesterdayDate})`);

          // Если достигли 3 дней без тренировки, переводим челлендж в failed
          if (newDaysWithoutWorkout >= 3) {
            await tx
              .update(challenges)
              .set({
                status: 'failed',
                daysWithoutWorkout: 0,
                updatedAt: new Date(),
              })
              .where(eq(challenges.id, challenge.id));

            logger.info(`Challenge failed for user ${userId} after 3 missed days`);
          }
        });

        // Проверяем, был ли челлендж переведен в failed
        const updatedChallenge = await this.getActiveChallenge(userId);
        if (!updatedChallenge || updatedChallenge.status === 'failed') {
          return true;
        }
      } else {
        logger.debug(`Photo was uploaded yesterday for user ${userId}, no increment needed`);
      }

      return false;
    } catch (error) {
      logger.error(`Error checking and incrementing missed days for user ${userId}:`, error);
      return false;
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
