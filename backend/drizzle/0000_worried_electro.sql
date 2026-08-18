CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "audio_transcription_jobs" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"YT_source_url" text,
	"file_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"claim_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"transcription_model_id" text
);
--> statement-breakpoint
CREATE TABLE "chat_message_transcriptions" (
	"message_id" uuid NOT NULL,
	"audio_upload_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "chat_message_transcriptions_message_id_audio_upload_id_pk" PRIMARY KEY("message_id","audio_upload_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"chosen_model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_id" uuid,
	"active_turn_claim_token" uuid,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_uploads" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_url" text,
	"signed_url_expires_at" timestamp with time zone,
	"message_id" uuid,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_contents" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"char_count" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_transcription_jobs" ADD CONSTRAINT "audio_transcription_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_transcriptions" ADD CONSTRAINT "chat_message_transcriptions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_transcriptions" ADD CONSTRAINT "chat_message_transcriptions_audio_upload_id_audio_transcription_jobs_upload_id_fk" FOREIGN KEY ("audio_upload_id") REFERENCES "public"."audio_transcription_jobs"("upload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_uploads" ADD CONSTRAINT "image_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_contents" ADD CONSTRAINT "transcript_contents_upload_id_audio_transcription_jobs_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."audio_transcription_jobs"("upload_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_contents" ADD CONSTRAINT "transcript_contents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_jobs_user_created_upload_idx" ON "audio_transcription_jobs" USING btree ("user_id","created_at","upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_transcriptions_message_position_idx" ON "chat_message_transcriptions" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "chat_message_transcriptions_audio_upload_idx" ON "chat_message_transcriptions" USING btree ("audio_upload_id");--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_created_idx" ON "chat_messages" USING btree ("conversation_id","created_at","role","id");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "image_uploads_message_idx" ON "image_uploads" USING btree ("message_id");