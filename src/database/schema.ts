import { pgTable, bigint, varchar, boolean, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  isBot: boolean('is_bot').notNull(),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }),
  username: varchar('username', { length: 255 }),
  languageCode: varchar('language_code', { length: 10 }),
  isPremium: boolean('is_premium'),
  addedToAttachmentMenu: boolean('added_to_attachment_menu'),
  canJoinGroups: boolean('can_join_groups'),
  canReadAllGroupMessages: boolean('can_read_all_group_messages'),
  supportsInlineQueries: boolean('supports_inline_queries'),
  rawData: text('raw_data'), // JSON строка со всеми данными от Telegram
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

