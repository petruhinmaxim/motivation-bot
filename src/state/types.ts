export type Scene = 'start' | 'info' | 'begin' | 'tomorrow' | 'monday' | 'timezone' | 'reminder_time' | 'challenge_rules' | 'challenge_stats' | 'challenge_settings' | 'edit_timezone' | 'edit_reminder_time' | 'waiting_for_photo' | 'missed_workout_report' | 'challenge_failed' | 'feedback' | 'start_new_challenge_confirm' | 'finish30';

export interface UserContext {
  userId: number;
  scene: Scene;
}

