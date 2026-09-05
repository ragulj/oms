CREATE TABLE `idempotency_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`order_id` integer NOT NULL,
	`created_at_us` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "idempotency_records_created_at_us_valid" CHECK(typeof("idempotency_records"."created_at_us") = 'integer' AND "idempotency_records"."created_at_us" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_records_idempotency_key_unique` ON `idempotency_records` (`idempotency_key`);