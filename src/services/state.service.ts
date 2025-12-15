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
          
          // Переводим машину в нужное состояние через события
          if (savedState === 'info') {
            actor.send({ type: 'GO_TO_INFO' });
          } else if (savedState === 'begin') {
            actor.send({ type: 'GO_TO_BEGIN' });
          } else if (savedState === 'duration') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_DURATION' });
          } else if (savedState === 'tomorrow') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_TOMORROW' });
          } else if (savedState === 'monday') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_MONDAY' });
          } else if (savedState === 'timezone') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_DURATION' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
          } else if (savedState === 'reminder_time') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_DURATION' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
            actor.send({ type: 'GO_TO_REMINDER_TIME' });
          } else if (savedState === 'challenge_rules') {
            actor.send({ type: 'GO_TO_BEGIN' });
            actor.send({ type: 'GO_TO_DURATION' });
            actor.send({ type: 'GO_TO_TIMEZONE' });
            actor.send({ type: 'GO_TO_REMINDER_TIME' });
            actor.send({ type: 'GO_TO_CHALLENGE_RULES' });
          } else {
            actor.send({ type: 'GO_TO_START' });
          }
          
          logger.debug(`Restored state for user ${userId}: ${savedState}`);
        } catch (error) {
          logger.warn(`Failed to restore state for user ${userId}, using default:`, error);
        }
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
    } catch (error) {
      logger.error(`Error saving state for user ${userId}:`, error);
    }
  }

  async getCurrentScene(userId: number): Promise<string> {
    const actor = await this.getActor(userId);
    const snapshot = actor.getSnapshot();
    return snapshot.context.scene;
  }

  async sendEvent(userId: number, event: any): Promise<void> {
    const actor = await this.getActor(userId);
    actor.send(event);
  }
}

export const stateService = new StateService();

