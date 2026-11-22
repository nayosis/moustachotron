CREATE TABLE `point_lot` (
	`id` text PRIMARY KEY NOT NULL,
	`visite_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`avancement` integer,
	`suivi` text,
	`constats` text,
	`observations` text,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`visite_id`) REFERENCES `visite`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `point_lot_visite_idx` ON `point_lot` (`visite_id`);--> statement-breakpoint
CREATE TABLE `presence` (
	`id` text PRIMARY KEY NOT NULL,
	`visite_id` text NOT NULL,
	`ordre` integer NOT NULL,
	`role` text NOT NULL,
	`contact_id` text,
	`lot_id` text,
	`representant` text,
	`etat` text,
	`convoque` integer DEFAULT false NOT NULL,
	`diffusion` integer DEFAULT true NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`visite_id`) REFERENCES `visite`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `presence_visite_idx` ON `presence` (`visite_id`);--> statement-breakpoint
CREATE TABLE `reserve` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`lot_id` text,
	`visite_id` text,
	`description` text NOT NULL,
	`constatee_le` text NOT NULL,
	`levee_le` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reserve_projet_idx` ON `reserve` (`projet_id`);--> statement-breakpoint
CREATE TABLE `visite` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`numero` integer NOT NULL,
	`dates` text NOT NULL,
	`sujets_a_venir` text,
	`note_generale` text,
	`statut` text DEFAULT 'brouillon' NOT NULL,
	`envoyee_le` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `visite_projet_idx` ON `visite` (`projet_id`);--> statement-breakpoint
ALTER TABLE `document` ADD `visite_id` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `numero_dossier` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `acces_conditions` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `acces_stationnement` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `acces_stockage` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `urbanisme` text;