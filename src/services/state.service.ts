import { createActor } from 'xstate';
import { botMachine } from '../state/machine.js';
import redis from '../redis/client.js';
import { getStateKey } from '../redis/keys.js';
import logger from '../utils/logger.js';
import type { BotActor } from '../state/machine.js';
import type { Scene } from '../state/types.js';

export class StateService {
  private actors = new Map<number, BotActor>();

  async getActor(userId: number): Promise<BotActor> {
    if (this.actors.has(userId)) {
      return this.actors.get(userId)!;
    }

    // Пытаемся восстановить состояние из Redis
    const stateKey = getStateKey(userId);

    try {
      const stateJson = await redis.get(stateKey);

      let actor: BotActor = createActor(botMachine);
      actor.start();

      if (stateJson) {
        // Восстанавливаем состояние через события
        try {
          const savedState = JSON.parse(stateJson) as Scene;
          logger.info(`Restoring state for user ${userId} from Redis: ${savedState}`);
          
          // Переводим машину в нужное состояние через события
          if (savedState === 'info') {
            actor.send({ type: 'GO_TO_INFO' });
          } else if (savedState === 'begin') {
            actor.send({ type: 'GO_TO_BEGIN' });
          } else if (savedState === 'tomorrow') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_TOMORROW' });
          } else if (savedState === 'monday') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_MONDAY' });
          } else if (savedState === 'timezone') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
          } else if (savedState === 'reminder_time') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
            actor.send({ type: 'GO_TO_REMINDER_TIME' });
          } else if (savedState === 'challenge_rules') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
            actor.send({ type: 'GO_TO_REMINDER_TIME' });
            actor.send({ type: 'GO_TO_CHALLENGE_RULES' });
          } else if (savedState === 'challenge_stats') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
          } else if (savedState === 'challenge_settings') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
            actor.send({ type: 'GO_TO_CHALLENGE_SETTINGS' });
          } else if (savedState === 'edit_timezone') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
            actor.send({ type: 'GO_TO_CHALLENGE_SETTINGS' });
            actor.send({ type: 'GO_TO_EDIT_TIMEZONE' });
          } else if (savedState === 'edit_reminder_time') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
            actor.send({ type: 'GO_TO_CHALLENGE_SETTINGS' });
            actor.send({ type: 'GO_TO_EDIT_REMINDER_TIME' });
          } else if (savedState === 'waiting_for_photo') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
            actor.send({ type: 'GO_TO_WAITING_FOR_PHOTO' });
          } else if (savedState === 'challenge_failed') {
            actor.send({ type: 'GO_TO_CHALLENGE_FAILED' });
          } else if (savedState === 'feedback') {
            actor.send({ type: 'GO_TO_CHALLENGE_STATS' });
            actor.send({ type: 'GO_TO_FEEDBACK' });
          } else {
            actor.send({ type: 'GO_TO_START' });
          }
          
          // Проверяем, что состояние действительно восстановилось
          const restoredSnapshot = actor.getSnapshot();
          const restoredScene = restoredSnapshot.context.scene;
          if (restoredScene !== savedState) {
            logger.error(`State restoration mismatch for user ${userId}. Expected: ${savedState}, got: ${restoredScene}`);
          } else {
            logger.info(`Successfully restored state for user ${userId}: ${savedState}`);
          }
        } catch (error) {
          logger.warn(`Failed to restore state for user ${userId}, using default:`, error);
        }
      } else {
        logger.debug(`No saved state found in Redis for user ${userId}, using default state`);
      }

      // Сохраняем состояние при каждом изменении
      actor.subscribe((snapshot) => {
        this.saveState(userId, snapshot);
      });

      this.actors.set(userId, actor);
      return actor;
    } catch (error) {
      logger.error(`Error restoring state for user ${userId}:`, error);
      // Создаем новый актор в случае ошибки
      const actor = createActor(botMachine);
      actor.start();
      this.actors.set(userId, actor);
      return actor;
    }
  }

  private async saveState(userId: number, snapshot: any): Promise<void> {
    try {
      const stateKey = getStateKey(userId);
      const scene = snapshot.context.scene as Scene;

      await redis.set(stateKey, JSON.stringify(scene));
      
      // Устанавливаем TTL на 30 дней
      await redis.expire(stateKey, 60 * 60 * 24 * 30);
      
      logger.debug(`State saved for user ${userId}: ${scene}`);
    } catch (error) {
      logger.error(`Error saving state for user ${userId}:`, error);
    }
  }

  async getCurrentScene(userId: number): Promise<Scene> {
    const actor = await this.getActor(userId);
    const snapshot = actor.getSnapshot();
    return snapshot.context.scene;
  }

  async sendEvent(userId: number, event: any): Promise<Scene> {
    const actor = await this.getActor(userId);
    
    // Получаем состояние до отправки события для логирования
    const snapshotBefore = actor.getSnapshot();
    const sceneBefore = snapshotBefore.context.scene;
    
    logger.debug(`Sending event ${event.type} for user ${userId}. Current scene: ${sceneBefore}`);
    
    // Отправляем событие
    // XState обрабатывает события синхронно, поэтому состояние обновится сразу
    actor.send(event);
    
    // Получаем обновленное состояние сразу после отправки события
    const snapshot = actor.getSnapshot();
    const newScene = snapshot.context.scene;
    
    // Проверяем, что состояние действительно изменилось
    if (sceneBefore === newScene && event.type !== 'GO_TO_START') {
      logger.warn(`State did not change after event ${event.type} for user ${userId}. Scene before: ${sceneBefore}, scene after: ${newScene}`);
    }
    
    // Важно: явно сохраняем состояние в Redis синхронно
    // Это гарантирует, что состояние будет сохранено до следующего запроса
    await this.saveState(userId, snapshot);
    
    logger.info(`State changed for user ${userId} from ${sceneBefore} to ${newScene} after event ${event.type}`);
    
    return newScene;
  }
}

export const stateService = new StateService();

