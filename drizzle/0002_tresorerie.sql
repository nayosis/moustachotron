CREATE TABLE `categorie` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`groupe` text NOT NULL,
	`sens` text NOT NULL,
	`tva_pb` integer DEFAULT 2000 NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text
);
--> statement-breakpoint
CREATE TABLE `charge_recurrente` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`tiers` text,
	`categorie_id` text NOT NULL,
	`montant_ttc` integer NOT NULL,
	`tva_pb` integer DEFAULT 2000 NOT NULL,
	`periodicite` text DEFAULT 'mensuelle' NOT NULL,
	`jour` integer DEFAULT 1 NOT NULL,
	`debut` text NOT NULL,
	`fin` text,
	`mot_cle` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`categorie_id`) REFERENCES `categorie`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `echeance` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`lot_id` text,
	`code` text NOT NULL,
	`libelle` text NOT NULL,
	`sens` text NOT NULL,
	`payeur_id` text,
	`categorie_id` text NOT NULL,
	`jalon` text NOT NULL,
	`date_forcee` text,
	`ttc` integer NOT NULL,
	`ht` integer NOT NULL,
	`statut` text DEFAULT 'prevue' NOT NULL,
	`numero_facture` text,
	`date_facture` text,
	`mouvement_id` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payeur_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`categorie_id`) REFERENCES `categorie`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `echeance_projet_idx` ON `echeance` (`projet_id`);--> statement-breakpoint
CREATE TABLE `exercice` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`debut` text NOT NULL,
	`fin` text NOT NULL,
	`tresorerie_ouverture` integer DEFAULT 0 NOT NULL,
	`objectif_ca_ht` integer,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text
);
--> statement-breakpoint
CREATE TABLE `mouvement` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`tiers` text,
	`mode` text DEFAULT 'virement' NOT NULL,
	`objet` text NOT NULL,
	`categorie_id` text NOT NULL,
	`ht` integer NOT NULL,
	`tva` integer NOT NULL,
	`ttc` integer NOT NULL,
	`projet_id` text,
	`charge_recurrente_id` text,
	`reference` text,
	`date_emission` text,
	`source` text DEFAULT 'saisie' NOT NULL,
	`cle_import` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`categorie_id`) REFERENCES `categorie`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `mouvement_date_idx` ON `mouvement` (`date`);--> statement-breakpoint
CREATE INDEX `mouvement_projet_idx` ON `mouvement` (`projet_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mouvement_cle_import_idx` ON `mouvement` (`cle_import`);--> statement-breakpoint
ALTER TABLE `document` ADD `mouvement_id` text;--> statement-breakpoint
ALTER TABLE `projet` ADD `estimation_ttc` integer;