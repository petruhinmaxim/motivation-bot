import { setup, createActor } from 'xstate';
import type { Scene } from './types.js';

export const botMachine = setup({
  types: {
    context: {} as { scene: Scene },
    events: {} as
      | { type: 'GO_TO_START' }
      | { type: 'GO_TO_INFO' }
      | { type: 'GO_TO_BEGIN' }
      | { type: 'GO_BACK' },
  },
}).createMachine({
  id: 'bot',
  initial: 'start',
  context: {
    scene: 'start',
  },
  states: {
    start: {
      entry: ({ context }) => {
        context.scene = 'start';
      },
      on: {
        GO_TO_INFO: {
          target: 'info',
        },
        GO_TO_BEGIN: {
          target: 'begin',
        },
      },
    },
    info: {
      entry: ({ context }) => {
        context.scene = 'info';
      },
      on: {
        GO_BACK: {
          target: 'start',
        },
      },
    },
    begin: {
      entry: ({ context }) => {
        context.scene = 'begin';
      },
      on: {
        GO_BACK: {
          target: 'start',
        },
      },
    },
  },
});

export type BotActor = ReturnType<typeof createActor<typeof botMachine>>;

