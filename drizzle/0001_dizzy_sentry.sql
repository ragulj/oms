CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	CONSTRAINT "products_unit_price_minor_valid" CHECK(typeof("products"."unit_price_minor") = 'integer' AND "products"."unit_price_minor" >= 0 AND "products"."unit_price_minor" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at_us` integer NOT NULL,
	`updated_at_us` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_valid" CHECK("orders"."status" IN ('pending', 'processing', 'cancelled')),
	CONSTRAINT "orders_created_at_us_valid" CHECK(typeof("orders"."created_at_us") = 'integer' AND "orders"."created_at_us" > 0),
	CONSTRAINT "orders_updated_at_us_valid" CHECK(typeof("orders"."updated_at_us") = 'integer' AND "orders"."updated_at_us" >= "orders"."created_at_us")
);
--> statement-breakpoint
CREATE INDEX `orders_created_at_id_idx` ON `orders` (`created_at_us`,`id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_at_id_idx` ON `orders` (`status`,`created_at_us`,`id`);--> statement-breakpoint
CREATE TABLE `order_line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`product_description` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total_minor` integer GENERATED ALWAYS AS (unit_price_minor * quantity) STORED,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_line_items_unit_price_minor_valid" CHECK(typeof("order_line_items"."unit_price_minor") = 'integer' AND "order_line_items"."unit_price_minor" >= 0 AND "order_line_items"."unit_price_minor" <= 9007199254740991),
	CONSTRAINT "order_line_items_quantity_valid" CHECK(typeof("order_line_items"."quantity") = 'integer' AND "order_line_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE INDEX `order_line_items_order_id_idx` ON `order_line_items` (`order_id`);