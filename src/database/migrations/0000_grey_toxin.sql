CREATE TABLE IF NOT EXISTS "challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"start_date" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"restart_count" integer DEFAULT 0 NOT NULL,
	"days_without_workout" integer DEFAULT 0 NOT NULL,
	"successful_days" integer DEFAULT 0 NOT NULL,
	"duration" integer NOT NULL,
	"reminder_status" boolean DEFAULT false NOT NULL,
	"reminder_time" time,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"is_bot" boolean NOT NULL,
	"first_name" varchar(255) NOT NULL,
	"last_name" varchar(255),
	"username" varchar(255),
	"language_code" varchar(10),
	"is_premium" boolean,
	"added_to_attachment_menu" boolean,
	"timezone" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenges" ADD CONSTRAINT "challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
