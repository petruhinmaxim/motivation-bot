import { setup, createActor } from 'xstate';
import type { Scene } from './types.js';

export const botMachine = setup({
  types: {
    context: {} as { scene: Scene },
    events: {} as
      | { type: 'GO_TO_START' }
      | { type: 'GO_TO_INFO' }
      | { type: 'GO_TO_BEGIN' }
      | { type: 'GO_TO_TOMORROW' }
      | { type: 'GO_TO_MONDAY' }
      | { type: 'GO_TO_TIMEZONE' }
      | { type: 'GO_TO_REMINDER_TIME' }
      | { type: 'GO_TO_CHALLENGE_RULES' }
      | { type: 'GO_TO_CHALLENGE_STATS' }
      | { type: 'GO_TO_CHALLENGE_SETTINGS' }
      | { type: 'GO_TO_EDIT_TIMEZONE' }
      | { type: 'GO_TO_EDIT_REMINDER_TIME' }
      | { type: 'GO_TO_WAITING_FOR_PHOTO' }
      | { type: 'GO_TO_MISSED_WORKOUT_REPORT' }
      | { type: 'GO_TO_CHALLENGE_FAILED' }
      | { type: 'GO_TO_FEEDBACK' }
      | { type: 'GO_BACK' },
  },
}).createMachine({
  id: 'bot',
  initial: 'start',
  context: () => ({
    scene: 'start' as Scene,
  }),
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
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
      },
    },
    info: {
      entry: ({ context }) => {
        context.scene = 'info';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
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
        GO_TO_TIMEZONE: {
          target: 'timezone',
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
    tomorrow: {
      entry: ({ context }) => {
        context.scene = 'tomorrow';
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
    monday: {
      entry: ({ context }) => {
        context.scene = 'monday';
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
        GO_TO_CHALLENGE_SETTINGS: {
          target: 'challenge_settings',
        },
        GO_TO_WAITING_FOR_PHOTO: {
          target: 'waiting_for_photo',
        },
        GO_TO_INFO: {
          target: 'info',
        },
        GO_TO_FEEDBACK: {
          target: 'feedback',
        },
        GO_TO_BEGIN: {
          target: 'begin',
        },
        GO_BACK: {
          target: 'challenge_rules',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    challenge_settings: {
      entry: ({ context }) => {
        context.scene = 'challenge_settings';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
        GO_TO_EDIT_TIMEZONE: {
          target: 'edit_timezone',
        },
        GO_TO_EDIT_REMINDER_TIME: {
          target: 'edit_reminder_time',
        },
        GO_BACK: {
          target: 'challenge_stats',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    edit_timezone: {
      entry: ({ context }) => {
        context.scene = 'edit_timezone';
      },
      on: {
        GO_TO_CHALLENGE_SETTINGS: {
          target: 'challenge_settings',
        },
        GO_BACK: {
          target: 'challenge_settings',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    edit_reminder_time: {
      entry: ({ context }) => {
        context.scene = 'edit_reminder_time';
      },
      on: {
        GO_TO_CHALLENGE_SETTINGS: {
          target: 'challenge_settings',
        },
        GO_BACK: {
          target: 'challenge_settings',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    waiting_for_photo: {
      entry: ({ context }) => {
        context.scene = 'waiting_for_photo';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    missed_workout_report: {
      entry: ({ context }) => {
        context.scene = 'missed_workout_report';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    challenge_failed: {
      entry: ({ context }) => {
        context.scene = 'challenge_failed';
      },
      on: {
        GO_TO_START: {
          target: 'start',
        },
      },
    },
    feedback: {
      entry: ({ context }) => {
        context.scene = 'feedback';
      },
      on: {
        GO_TO_CHALLENGE_STATS: {
          target: 'challenge_stats',
        },
        GO_TO_START: {
          target: 'start',
        },
      },
    },
  },
});

export type BotActor = ReturnType<typeof createActor<typeof botMachine>>;

