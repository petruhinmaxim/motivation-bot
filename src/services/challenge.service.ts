import { eq, and, desc } from 'drizzle-orm';
import { db } from '../database/client.js';
import { challenges } from '../database/schema.js';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { getPhotoUploadKey } from '../redis/keys.js';
import { getYesterdayDateString, formatDateToString, getCurrentDateString } from '../utils/date-utils.js';
import { userService } from './user.service.js';

export class ChallengeService {
  /**
   * Очищает все ключи Redis для загрузки фото пользователя
   * Используется при создании нового челленджа или провале старого
   * @param userId - ID пользователя
   */
  async clearPhotoUploadKeys(userId: number): Promise<void> {
    try {
      // Используем SCAN для поиска всех ключей photo_upload:${userId}:*
      const pattern = `photo_upload:${userId}:*`;
      let cursor = '0';
      let deletedCount = 0;

      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      if (deletedCount > 0) {
        logger.info(`Cleared ${deletedCount} photo upload keys for user ${userId}`);
      }
    } catch (error) {
      logger.error(`Error clearing photo upload keys for user ${userId}:`, error);
      // Не пробрасываем ошибку, чтобы не блокировать создание челленджа
    }
  }

  /**
   * Создает новый челлендж для пользователя
   * Блокирует создание, если у пользователя уже есть активный челлендж
   * Очищает все ключи Redis для загрузки фото при создании нового челленджа
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

      // Очищаем все ключи Redis для загрузки фото перед созданием нового челленджа
      // Это необходимо, чтобы старые ключи не блокировали загрузку фото в новом челлендже
      await this.clearPhotoUploadKeys(userId);

      // Получаем или устанавливаем часовой пояс по умолчанию (МСК)
      // Часовой пояс нужен для корректной работы проверки пропущенных дней в 4:00 МСК
      await userService.getOrSetDefaultTimezone(userId);

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

      // Проверка пропущенных дней теперь выполняется только в 4:00 МСК через performDailyHealthCheck
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
   * Получает последний челлендж пользователя (самый новый по id), независимо от статуса
   * Нужен, например, чтобы планировать финальное уведомление после перевода в failed.
   */
  async getLatestChallenge(userId: number) {
    const result = await db
      .select()
      .from(challenges)
      .where(eq(challenges.userId, userId))
      .orderBy(desc(challenges.id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Обновляет дату старта активного челленджа
   */
  async updateChallengeStartDate(userId: number, newStartDate: Date): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      await db
        .update(challenges)
        .set({
          startDate: newStartDate,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));
      logger.info(`Updated challenge start date for user ${userId} to ${newStartDate.toISOString()}`);
    } catch (error) {
      logger.error(`Error updating challenge start date for user ${userId}:`, error);
      throw error;
    }
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
   * Включает напоминания для активного челленджа (использует сохраненное время или 12:00 МСК)
   */
  async enableReminders(userId: number): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      // Если время не установлено, используем 12:00 МСК по умолчанию
      const reminderTime = challenge.reminderTime || '12:00';

      await db
        .update(challenges)
        .set({
          reminderStatus: true,
          reminderTime,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));
      logger.info(`Enabled reminders for user ${userId} with time ${reminderTime}`);
    } catch (error) {
      logger.error(`Error enabling reminders for user ${userId}:`, error);
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
   * Использует атомарную операцию через Redis для предотвращения race conditions
   * @param userId - ID пользователя
   * @param date - Дата в формате YYYY-MM-DD
   * @returns true, если операция успешна, false если фото уже было загружено сегодня
   */
  async incrementSuccessfulDays(userId: number, date: string): Promise<boolean> {
    try {
      const key = getPhotoUploadKey(userId, date);
      
      // Атомарно проверяем и устанавливаем ключ в Redis для предотвращения race conditions
      // SET key value NX EX seconds - устанавливает ключ только если его еще нет
      const result = await redis.set(key, '1', 'EX', 86400, 'NX'); // 86400 секунд = 24 часа
      
      // Если ключ уже существует (result === null), значит фото уже было загружено сегодня
      if (result === null) {
        logger.debug(`Photo already uploaded today for user ${userId} on ${date}`);
        return false;
      }

      // Получаем активный челлендж
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        // Если челлендж не найден, удаляем установленный ключ Redis
        await redis.del(key);
        throw new Error(`Active challenge not found for user ${userId}`);
      }

      // Проверяем, что челлендж активен
      if (challenge.status !== 'active') {
        // Если челлендж не активен, удаляем установленный ключ Redis
        await redis.del(key);
        throw new Error(`Challenge is not active for user ${userId}`);
      }

      // Увеличиваем successfulDays и обнуляем счетчик пропущенных дней
      // Используем транзакцию для атомарности операции
      const newSuccessfulDays = challenge.successfulDays + 1;
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
          // Челлендж был изменен или удален
          await redis.del(key);
          throw new Error(`Challenge state changed for user ${userId} during transaction`);
        }

        await tx
          .update(challenges)
          .set({
            successfulDays: currentChallenge[0].successfulDays + 1,
            daysWithoutWorkout: 0, // Обнуляем счетчик пропущенных дней после загрузки фото
            updatedAt: new Date(),
          })
          .where(eq(challenges.id, challenge.id));
      });

      logger.info(`Incremented successfulDays for user ${userId} on ${date} (new value: ${newSuccessfulDays})`);
      return true;
    } catch (error) {
      logger.error(`Error incrementing successfulDays for user ${userId} on ${date}:`, error);
      throw error;
    }
  }

  /**
   * Переводит активный челлендж в статус completed (успешное завершение)
   * @param userId - ID пользователя
   */
  async completeChallenge(userId: number): Promise<void> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        logger.warn(`No active challenge found for user ${userId} to complete`);
        return;
      }

      await db
        .update(challenges)
        .set({
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));

      await this.clearPhotoUploadKeys(userId);

      logger.info(`Completed challenge ${challenge.id} for user ${userId}`);
    } catch (error) {
      logger.error(`Error completing challenge for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Продлевает активный челлендж до 50 или 100 дней.
   * Разрешает только увеличение: до 50 только при текущих 30 днях, до 100 — при 30 или 50.
   * @param userId - ID пользователя
   * @param newDuration - 50 или 100
   * @returns Обновлённый челлендж или null при ошибке/невалидном переходе
   */
  async extendChallenge(
    userId: number,
    newDuration: 50 | 100
  ): Promise<typeof challenges.$inferSelect | null> {
    try {
      const challenge = await this.getActiveChallenge(userId);
      if (!challenge) {
        logger.warn(`No active challenge found for user ${userId} to extend`);
        return null;
      }

      const current = challenge.duration;
      if (newDuration === 50 && current !== 30) {
        logger.warn(`Cannot extend to 50 for user ${userId}: current duration is ${current}`);
        return null;
      }
      if (newDuration === 100 && current >= 100) {
        logger.warn(`Cannot extend to 100 for user ${userId}: current duration is ${current}`);
        return null;
      }

      await db
        .update(challenges)
        .set({
          duration: newDuration,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challenge.id));

      logger.info(`Extended challenge ${challenge.id} for user ${userId} to ${newDuration} days`);
      return { ...challenge, duration: newDuration, updatedAt: new Date() };
    } catch (error) {
      logger.error(`Error extending challenge for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Переводит активный челлендж в статус failed
   * Очищает все ключи Redis для загрузки фото
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

      // Очищаем все ключи Redis для загрузки фото при провале челленджа
      // Это гарантирует, что при создании нового челленджа не будет конфликтов
      await this.clearPhotoUploadKeys(userId);

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
      
      // Получаем дату старта челленджа в формате YYYY-MM-DD с учетом часового пояса
      const startDate = new Date(challenge.startDate);
      const startDateString = formatDateToString(startDate, timezoneOffset);
      
      // Если вчерашняя дата раньше даты старта челленджа - не увеличиваем счетчик
      // (челлендж еще не был активен в тот день)
      if (yesterdayDate < startDateString) {
        logger.debug(`Yesterday (${yesterdayDate}) is before challenge start date (${startDateString}), skipping increment for user ${userId}`);
        return false;
      }

      // Дополнительная проверка: если челлендж создан сегодня (после 20:00), 
      // то первая проверка должна быть на следующий день (пропускаем эту проверку)
      const currentDate = getCurrentDateString(timezoneOffset);
      if (startDateString === currentDate) {
        // Челлиндж создан сегодня, проверяем время создания
        const challengeStartLocalTime = new Date(challenge.startDate.getTime() + (timezoneOffset * 60 * 60 * 1000));
        const challengeStartHour = challengeStartLocalTime.getHours();
        
        // Если челлендж создан после 20:00, пропускаем проверку (слишком рано для первой проверки)
        if (challengeStartHour >= 20) {
          logger.debug(`Challenge created today after 20:00 (${challengeStartHour}:00), skipping check for user ${userId}`);
          return false;
        }
      }

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
