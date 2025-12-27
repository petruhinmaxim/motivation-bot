import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { missedWorkoutReports } from '../database/schema.js';
import logger from '../utils/logger.js';

// Максимальная длина текста отчета (10KB)
const MAX_REPORT_LENGTH = 10000;

export class MissedWorkoutReportService {
  /**
   * Создает отчет о пропущенной тренировке
   * @throws Error если текст слишком длинный
   */
  async createReport(challengeId: number, text: string): Promise<void> {
    // Валидация длины текста
    if (text.length > MAX_REPORT_LENGTH) {
      const error = new Error(`Report text exceeds maximum length of ${MAX_REPORT_LENGTH} characters`);
      logger.warn(`Report validation failed for challenge ${challengeId}: text length ${text.length}`);
      throw error;
    }

    // Проверка на пустой текст (после trim)
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      const error = new Error('Report text cannot be empty');
      logger.warn(`Report validation failed for challenge ${challengeId}: empty text`);
      throw error;
    }

    try {
      await db.insert(missedWorkoutReports).values({
        challengeId,
        text: trimmedText,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      logger.info(`Created missed workout report for challenge ${challengeId} (length: ${trimmedText.length})`);
    } catch (error) {
      logger.error(`Error creating missed workout report for challenge ${challengeId}:`, error);
      throw error;
    }
  }

  /**
   * Получает все отчеты для челленджа
   */
  async getReportsByChallengeId(challengeId: number) {
    const result = await db
      .select()
      .from(missedWorkoutReports)
      .where(eq(missedWorkoutReports.challengeId, challengeId))
      .orderBy(missedWorkoutReports.createdAt);

    return result;
  }
}

export const missedWorkoutReportService = new MissedWorkoutReportService();
