import { db } from '../database/client.js';
import { userButtonLogs } from '../database/schema.js';
import logger from '../utils/logger.js';

export class ButtonLogService {
  async logButtonClick(userId: number, buttonName: string): Promise<void> {
    try {
      await db.insert(userButtonLogs).values({
        userId,
        buttonName,
        clickedAt: new Date(),
      });
      logger.debug(`Logged button click: user ${userId}, button "${buttonName}"`);
    } catch (error) {
      // Логируем ошибку, но не прерываем работу бота
      logger.error(`Error logging button click for user ${userId}, button "${buttonName}":`, error);
    }
  }
}

export const buttonLogService = new ButtonLogService();

