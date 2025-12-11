CREATE TABLE IF NOT EXISTS "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"is_bot" boolean NOT NULL,
	"first_name" varchar(255) NOT NULL,
	"last_name" varchar(255),
	"username" varchar(255),
	"language_code" varchar(10),
	"is_premium" boolean,
	"added_to_attachment_menu" boolean,
	"can_join_groups" boolean,
	"can_read_all_group_messages" boolean,
	"supports_inline_queries" boolean,
	"raw_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

