CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"amount" numeric(10, 2) NOT NULL,
	"commission_rate_applied" numeric(5, 4),
	"employee_amount" numeric(10, 2),
	"business_amount" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "commission_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "commission_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_commission_rate_check" CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_commission_rate_check" CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_commission_consistency_check" CHECK (
  (commission_rate_applied IS NULL AND employee_amount IS NULL AND business_amount IS NULL)
  OR
  (commission_rate_applied IS NOT NULL AND employee_amount IS NOT NULL AND business_amount IS NOT NULL)
);