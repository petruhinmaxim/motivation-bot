export const getStateKey = (userId: number): string => `user:${userId}:state`;

export const getStateSnapshotKey = (userId: number): string => `user:${userId}:state:snapshot`;

// Ключи для планировщика задач
export const getScheduledTasksKey = (): string => 'scheduler:tasks';
export const getScheduledTaskDataKey = (userId: number): string => `scheduler:task:${userId}`;

// Ключи для ежедневных напоминаний
export const getDailyRemindersKey = (): string => 'scheduler:daily_reminders';
export const getDailyReminderDataKey = (userId: number): string => `scheduler:daily_reminder:${userId}`;

// Ключ для отслеживания загрузки фото за день (формат: YYYY-MM-DD)
export const getPhotoUploadKey = (userId: number, date: string): string => `photo_upload:${userId}:${date}`;

// Ключи для полночных проверок
export const getMidnightChecksKey = (): string => 'scheduler:midnight_checks';
export const getMidnightCheckDataKey = (userId: number): string => `scheduler:midnight_check:${userId}`;

