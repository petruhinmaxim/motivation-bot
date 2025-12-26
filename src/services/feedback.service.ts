import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { userFeedback } from '../database/schema.js';
import logger from '../utils/logger.js';

export class FeedbackService {
  /**
   * Создает запись обратной связи от пользователя
   */
  async createFeedback(userId: number, text: string): Promise<void> {
    try {
      await db.insert(userFeedback).values({
        userId,
        text,
        createdAt: new Date(),
      });
      logger.info(`Created feedback for user ${userId}`);
    } catch (error) {
      logger.error(`Error creating feedback for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получает все записи обратной связи для пользователя
   */
  async getFeedbackByUserId(userId: number) {
    const result = await db
      .select()
      .from(userFeedback)
      .where(eq(userFeedback.userId, userId))
      .orderBy(userFeedback.createdAt);

    return result;
  }
}

export const feedbackService = new FeedbackService();

