export type Scene = 'start' | 'info' | 'begin' | 'duration' | 'tomorrow' | 'monday' | 'timezone' | 'reminder_time' | 'challenge_rules' | 'challenge_stats' | 'challenge_settings' | 'edit_timezone' | 'edit_reminder_time';

export interface UserContext {
  userId: number;
  scene: Scene;
}

