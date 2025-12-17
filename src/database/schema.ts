import { pgTable, bigint, varchar, boolean, timestamp, integer, time, serial, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  isBot: boolean('is_bot').notNull(),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }),
  username: varchar('username', { length: 255 }),
  languageCode: varchar('language_code', { length: 10 }),
  isPremium: boolean('is_premium'),
  addedToAttachmentMenu: boolean('added_to_attachment_menu'),
  timezone: integer('timezone'), // Смещение от UTC в часах
  blockedAt: timestamp('blocked_at'), // Дата блокировки бота пользователем
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const challenges = pgTable('challenges', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull().references(() => users.id),
  startDate: timestamp('start_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'), // active, completed, failed
  restartCount: integer('restart_count').notNull().default(0),
  daysWithoutWorkout: integer('days_without_workout').notNull().default(0),
  successfulDays: integer('successful_days').notNull().default(0),
  duration: integer('duration').notNull(), // 30, 60, or 90 days
  reminderStatus: boolean('reminder_status').notNull().default(false),
  reminderTime: time('reminder_time'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  challenges: many(challenges),
}));

export const missedWorkoutReports = pgTable('missed_workout_reports', {
  id: serial('id').primaryKey(),
  challengeId: integer('challenge_id').notNull().references(() => challenges.id),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const challengesRelations = relations(challenges, ({ one, many }) => ({
  user: one(users, {
    fields: [challenges.userId],
    references: [users.id],
  }),
  missedWorkoutReports: many(missedWorkoutReports),
}));

export const missedWorkoutReportsRelations = relations(missedWorkoutReports, ({ one }) => ({
  challenge: one(challenges, {
    fields: [missedWorkoutReports.challengeId],
    references: [challenges.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;
export type MissedWorkoutReport = typeof missedWorkoutReports.$inferSelect;
export type NewMissedWorkoutReport = typeof missedWorkoutReports.$inferInsert;

