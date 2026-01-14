export const getStateKey = (userId: number): string => `user:${userId}:state`;

export const getStateSnapshotKey = (userId: number): string => `user:${userId}:state:snapshot`;

// Ключи для планировщика задач
export const getScheduledTasksKey = (): string => 'scheduler:tasks';
export const getScheduledTaskDataKey = (userId: number): string => `scheduler:task:${userId}`;

// Ключ для отслеживания загрузки фото за день (формат: YYYY-MM-DD)
export const getPhotoUploadKey = (userId: number, date: string): string => `photo_upload:${userId}:${date}`;

// Ключи для таймеров бездействия
export const getIdleTimerKey = (userId: number): string => `idle_timer:${userId}`;

// Ключи для уведомлений
export const getDailyReminderKey = (userId: number): string => `notification:daily:${userId}`;
export const getDailyReminderDataKey = (userId: number): string => `notification:daily:data:${userId}`;
export const getDailyRemindersListKey = (): string => 'notification:daily:list';

export const getMissedCheckKey = (userId: number): string => `notification:missed:${userId}`;
export const getMissedCheckDataKey = (userId: number): string => `notification:missed:data:${userId}`;
export const getMissedChecksListKey = (): string => 'notification:missed:list';

export const getNotificationLockKey = (userId: number): string => `notification:lock:${userId}`;
export const getMissedNotificationSentKey = (userId: number): string => `notification:missed:sent:${userId}`;

// Ключи для уведомлений о пропущенных днях
export const getMissedDayNotificationDataKey = (userId: number): string => `notification:missed_day:data:${userId}`;
export const getMissedDayNotificationsListKey = (): string => 'notification:missed_day:list';

// Ключ для блокировки ежедневной проверки здоровья
export const getDailyHealthCheckLockKey = (): string => 'notification:health_check:lock';

