export type Scene = 'start' | 'info' | 'begin' | 'duration' | 'tomorrow' | 'monday' | 'timezone';

export interface UserContext {
  userId: number;
  scene: Scene;
}

