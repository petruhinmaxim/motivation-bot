import { setup, createActor } from 'xstate';
import type { Scene } from './types.js';

export const botMachine = setup({
  types: {
    context: {} as { scene: Scene },
    events: {} as
      | { type: 'GO_TO_START' }
      | { type: 'GO_TO_INFO' }
      | { type: 'GO_TO_BEGIN' }
      | { type: 'GO_TO_DURATION' }
      | { type: 'GO_TO_TOMORROW' }
      | { type: 'GO_TO_MONDAY' }
      | { type: 'GO_TO_TIMEZONE' }
      | { type: 'GO_TO_REMINDER_TIME' }
      | { type: 'GO_TO_CHALLENGE_RULES' }
      | { type: 'GO_TO_CHALLENGE_STATS' }
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
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    begin: {
      entry: ({ context }) => {
        context.scene = 'begin';
      },
      on: {
        GO_TO_DURATION: {
          target: 'duration',
        },
        GO_TO_TOMORROW: {
          target: 'tomorrow',
        },
        GO_TO_MONDAY: {
          target: 'monday',
        },
        GO_BACK: {
          target: 'start',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    duration: {
      entry: ({ context }) => {
        context.scene = 'duration';
      },
      on: {
        GO_TO_TIMEZONE: {
          target: 'timezone',
        },
        GO_BACK: {
          target: 'begin',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    tomorrow: {
      entry: ({ context }) => {
        context.scene = 'tomorrow';
      },
      on: {
        GO_TO_TIMEZONE: {
          target: 'timezone',
        },
        GO_TO_DURATION: {
          target: 'duration',
        },
        GO_BACK: {
          target: 'begin',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    monday: {
      entry: ({ context }) => {
        context.scene = 'monday';
      },
      on: {
        GO_TO_TIMEZONE: {
          target: 'timezone',
        },
        GO_TO_DURATION: {
          target: 'duration',
        },
        GO_BACK: {
          target: 'begin',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    timezone: {
      entry: ({ context }) => {
        context.scene = 'timezone';
      },
      on: {
        GO_TO_REMINDER_TIME: {
          target: 'reminder_time',
        },
        GO_BACK: {
          target: 'begin',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    reminder_time: {
      entry: ({ context }) => {
        context.scene = 'reminder_time';
      },
      on: {
        GO_TO_CHALLENGE_RULES: {
          target: 'challenge_rules',
        },
        GO_BACK: {
          target: 'timezone',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    challenge_rules: {
      entry: ({ context }) => {
        context.scene = 'challenge_rules';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
        GO_BACK: {
          target: 'reminder_time',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    challenge_stats: {
      entry: ({ context }) => {
        context.scene = 'challenge_stats';
      },
      on: {
        GO_TO_CHALLENGE_RULES: {
          target: 'challenge_rules',
        },
        GO_BACK: {
          target: 'challenge_rules',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
  },
});

export type BotActor = ReturnType<typeof createActor<typeof botMachine>>;

