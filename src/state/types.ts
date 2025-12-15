export type Scene = 'start' | 'info' | 'begin' | 'duration' | 'tomorrow' | 'monday' | 'timezone' | 'reminder_time' | 'challenge_rules';

export interface UserContext {
  userId: number;
  scene: Scene;
}

