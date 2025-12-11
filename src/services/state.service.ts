import { createActor, fromSnapshot } from 'xstate';
import { botMachine } from '../state/machine.js';
import redis from '../redis/client.js';
import { getStateKey, getStateSnapshotKey } from '../redis/keys.js';
import logger from '../utils/logger.js';
import type { BotActor } from '../state/machine.js';

export class StateService {
  private actors = new Map<number, BotActor>();

  async getActor(userId: number): Promise<BotActor> {
    if (this.actors.has(userId)) {
      return this.actors.get(userId)!;
    }

    // Пытаемся восстановить состояние из Redis
    const stateKey = getStateKey(userId);
    const snapshotKey = getStateSnapshotKey(userId);

    try {
      const [stateJson, snapshotJson] = await Promise.all([
        redis.get(stateKey),
        redis.get(snapshotKey),
      ]);

      let actor: BotActor;

      if (snapshotJson) {
        // Восстанавливаем из snapshot
        try {
          const savedSnapshot = JSON.parse(snapshotJson);
          const snapshot = fromSnapshot(savedSnapshot);
          actor = createActor(botMachine, { snapshot });
          actor.start();
          logger.debug(`Restored state for user ${userId} from snapshot`);
        } catch (error) {
          logger.warn(`Failed to restore snapshot for user ${userId}, creating new actor:`, error);
          actor = createActor(botMachine);
          actor.start();
        }
      } else {
        // Создаем новый актор
        actor = createActor(botMachine);
        actor.start();
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
      const snapshotKey = getStateSnapshotKey(userId);

      await Promise.all([
        redis.set(stateKey, JSON.stringify(snapshot.value)),
        redis.set(snapshotKey, JSON.stringify(snapshot)),
      ]);

      // Устанавливаем TTL на 30 дней
      await Promise.all([
        redis.expire(stateKey, 60 * 60 * 24 * 30),
        redis.expire(snapshotKey, 60 * 60 * 24 * 30),
      ]);
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

