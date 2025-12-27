import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { userFeedback } from '../database/schema.js';
import logger from '../utils/logger.js';

// Максимальная длина текста обратной связи (10KB)
const MAX_FEEDBACK_LENGTH = 10000;

export class FeedbackService {
  /**
   * Создает запись обратной связи от пользователя
   * @throws Error если текст слишком длинный
   */
  async createFeedback(userId: number, text: string): Promise<void> {
    // Валидация длины текста
    if (text.length > MAX_FEEDBACK_LENGTH) {
      const error = new Error(`Feedback text exceeds maximum length of ${MAX_FEEDBACK_LENGTH} characters`);
      logger.warn(`Feedback validation failed for user ${userId}: text length ${text.length}`);
      throw error;
    }

    // Проверка на пустой текст (после trim)
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      const error = new Error('Feedback text cannot be empty');
      logger.warn(`Feedback validation failed for user ${userId}: empty text`);
      throw error;
    }

    try {
      await db.insert(userFeedback).values({
        userId,
        text: trimmedText,
        createdAt: new Date(),
      });
      logger.info(`Created feedback for user ${userId} (length: ${trimmedText.length})`);
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

