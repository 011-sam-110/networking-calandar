CREATE TABLE "attendance" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"going" boolean DEFAULT false NOT NULL,
	"attended" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"run_id" uuid,
	"score" integer DEFAULT 0 NOT NULL,
	"decision" text DEFAULT 'keep' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"expected_payoff" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'web-search' NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"venue_name" text,
	"address" text,
	"city" text,
	"region" text DEFAULT 'UK' NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"booking_url" text NOT NULL,
	"link_verified" boolean DEFAULT false NOT NULL,
	"price" text,
	"organizer" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text,
	"dedupe_hash" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_run_id" uuid,
	CONSTRAINT "events_dedupe_hash_unique" UNIQUE("dedupe_hash")
);
--> statement-breakpoint
CREATE TABLE "gcal_sync" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"gcal_event_id" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_action" text DEFAULT 'created' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"display_name" text DEFAULT 'Sam' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"learned_preferences" text DEFAULT '' NOT NULL,
	"home_city" text DEFAULT 'Brighton' NOT NULL,
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text DEFAULT 'daily' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"covered_from" date,
	"covered_to" date,
	"events_found" integer DEFAULT 0 NOT NULL,
	"events_kept" integer DEFAULT 0 NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curations" ADD CONSTRAINT "curations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gcal_sync" ADD CONSTRAINT "gcal_sync_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;