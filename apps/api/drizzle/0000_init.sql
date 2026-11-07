CREATE TABLE "child_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"grade" integer NOT NULL,
	"pin_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"method" text NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"pack_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"task_id" text NOT NULL,
	"kind" text NOT NULL,
	"correct" boolean NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"context" text NOT NULL,
	"checked_by" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_profile_id_child_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."child_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "child_profiles_parent_idx" ON "child_profiles" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "consents_parent_idx" ON "consents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "learning_events_profile_pack_idx" ON "learning_events" USING btree ("profile_id","pack_id","occurred_at");