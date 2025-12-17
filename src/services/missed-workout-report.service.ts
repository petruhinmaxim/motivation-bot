import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { missedWorkoutReports } from '../database/schema.js';
import logger from '../utils/logger.js';

export class MissedWorkoutReportService {
  /**
   * Создает отчет о пропущенной тренировке
   */
  async createReport(challengeId: number, text: string): Promise<void> {
    try {
      await db.insert(missedWorkoutReports).values({
        challengeId,
        text,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      logger.info(`Created missed workout report for challenge ${challengeId}`);
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
