export const getStateKey = (userId: number): string => `user:${userId}:state`;

export const getStateSnapshotKey = (userId: number): string => `user:${userId}:state:snapshot`;

// Ключи для планировщика задач
export const getScheduledTasksKey = (): string => 'scheduler:tasks';
export const getScheduledTaskDataKey = (userId: number): string => `scheduler:task:${userId}`;

