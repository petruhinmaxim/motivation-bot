export type Scene = 'start' | 'info' | 'begin';

export interface UserContext {
  userId: number;
  scene: Scene;
}

