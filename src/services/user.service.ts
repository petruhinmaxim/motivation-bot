import { eq } from 'drizzle-orm';
import { db } from '../database/client.js';
import { users } from '../database/schema.js';
import logger from '../utils/logger.js';
import type { User as TelegramUser } from 'grammy/types';

export class UserService {
  async saveOrUpdateUser(telegramUser: TelegramUser): Promise<void> {
    try {
      const userData = {
        id: telegramUser.id,
        isBot: telegramUser.is_bot,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name || null,
        username: telegramUser.username || null,
        languageCode: telegramUser.language_code || null,
        isPremium: telegramUser.is_premium || null,
        addedToAttachmentMenu: telegramUser.added_to_attachment_menu || null,
        updatedAt: new Date(),
      };

      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.id, telegramUser.id))
        .limit(1);

      if (existingUser.length > 0) {
        // Если пользователь взаимодействует с ботом, сбрасываем статус блокировки
        // (на случай, если событие my_chat_member не сработало)
        const updateData = existingUser[0].blockedAt
          ? { ...userData, blockedAt: null }
          : userData;

        await db
          .update(users)
          .set(updateData)
          .where(eq(users.id, telegramUser.id));
        logger.debug(`Updated user ${telegramUser.id}`);
      } else {
        await db.insert(users).values({
          ...userData,
          createdAt: new Date(),
        });
        logger.info(`Created new user ${telegramUser.id}`);
      }
    } catch (error) {
      logger.error(`Error saving user ${telegramUser.id}:`, error);
      throw error;
    }
  }

  async getUser(userId: number) {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return result[0] || null;
  }

  async updateTimezone(userId: number, timezone: number): Promise<void> {
    try {
      await db
        .update(users)
        .set({
          timezone,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      logger.info(`Updated timezone for user ${userId}: UTC${timezone >= 0 ? '+' : ''}${timezone}`);
    } catch (error) {
      logger.error(`Error updating timezone for user ${userId}:`, error);
      throw error;
    }
  }

  async markUserAsBlocked(userId: number): Promise<void> {
    try {
      await db
        .update(users)
        .set({
          blockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      logger.info(`User ${userId} marked as blocked`);
    } catch (error) {
      logger.error(`Error marking user ${userId} as blocked:`, error);
      throw error;
    }
  }

  async markUserAsUnblocked(userId: number): Promise<void> {
    try {
      await db
        .update(users)
        .set({
          blockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      logger.info(`User ${userId} marked as unblocked`);
    } catch (error) {
      logger.error(`Error marking user ${userId} as unblocked:`, error);
      throw error;
    }
  }
}

export const userService = new UserService();

