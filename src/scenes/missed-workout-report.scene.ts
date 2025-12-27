import type { Context } from 'grammy';

export async function handleMissedWorkoutReportScene(_ctx: Context) {
  // Эта сцена не отправляет сообщение, она просто ожидает текстовый ввод от пользователя
  // Сообщение о пропущенной тренировке отправляется из schedulerService.sendDailyReminder
}
