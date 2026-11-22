CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`nom` text NOT NULL,
	`interlocuteur` text,
	`corps_etat` text,
	`telephone` text,
	`email` text,
	`adresse` text,
	`notes` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text
);
--> statement-breakpoint
CREATE INDEX `contact_type_idx` ON `contact` (`type`);--> statement-breakpoint
CREATE TABLE `devis` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`entreprise_id` text NOT NULL,
	`reference` text,
	`version` integer DEFAULT 1 NOT NULL,
	`date` text NOT NULL,
	`montant_ttc` integer NOT NULL,
	`statut` text DEFAULT 'recu' NOT NULL,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`entreprise_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `devis_lot_idx` ON `devis` (`lot_id`);--> statement-breakpoint
CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text,
	`lot_id` text,
	`devis_id` text,
	`contact_id` text,
	`type` text NOT NULL,
	`nom` text NOT NULL,
	`fichier` text NOT NULL,
	`mime` text NOT NULL,
	`taille` integer NOT NULL,
	`valide_jusqu_au` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`devis_id`) REFERENCES `devis`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `document_projet_idx` ON `document` (`projet_id`);--> statement-breakpoint
CREATE INDEX `document_contact_idx` ON `document` (`contact_id`);--> statement-breakpoint
CREATE TABLE `interaction` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`projet_id` text,
	`nature` text NOT NULL,
	`date` text NOT NULL,
	`heure` text,
	`objet` text NOT NULL,
	`texte` text,
	`a_faire_le` text,
	`faite` integer DEFAULT false NOT NULL,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `interaction_contact_idx` ON `interaction` (`contact_id`);--> statement-breakpoint
CREATE INDEX `interaction_projet_idx` ON `interaction` (`projet_id`);--> statement-breakpoint
CREATE INDEX `interaction_a_faire_idx` ON `interaction` (`a_faire_le`);--> statement-breakpoint
CREATE TABLE `jalon` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`code` text NOT NULL,
	`date_prevue` text,
	`date_reelle` text,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jalon_projet_code_idx` ON `jalon` (`projet_id`,`code`);--> statement-breakpoint
CREATE TABLE `journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quand` text NOT NULL,
	`utilisateur` text NOT NULL,
	`fonction` text NOT NULL,
	`cible` text,
	`resume` text,
	`avant` text,
	`apres` text
);
--> statement-breakpoint
CREATE INDEX `journal_quand_idx` ON `journal` (`quand`);--> statement-breakpoint
CREATE INDEX `journal_utilisateur_idx` ON `journal` (`utilisateur`);--> statement-breakpoint
CREATE INDEX `journal_cible_idx` ON `journal` (`cible`);--> statement-breakpoint
CREATE TABLE `lot` (
	`id` text PRIMARY KEY NOT NULL,
	`projet_id` text NOT NULL,
	`numero` integer NOT NULL,
	`corps_etat` text NOT NULL,
	`entreprise_id` text,
	`tva_pb` integer DEFAULT 1000 NOT NULL,
	`commission_pb` integer DEFAULT 1300 NOT NULL,
	`montant_ttc` integer,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`projet_id`) REFERENCES `projet`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`entreprise_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `lot_projet_idx` ON `lot` (`projet_id`);--> statement-breakpoint
CREATE TABLE `mission` (
	`code` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`mode` text NOT NULL,
	`taux_pb` integer,
	`forfait_ttc` integer,
	`tva_pb` integer,
	`avec_travaux` integer NOT NULL,
	`avec_acompte` integer NOT NULL,
	`echeancier` text NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text
);
--> statement-breakpoint
CREATE TABLE `origine` (
	`code` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	`archive` integer DEFAULT false NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text
);
--> statement-breakpoint
CREATE TABLE `parametre` (
	`cle` text PRIMARY KEY NOT NULL,
	`valeur` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projet` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`intitule` text NOT NULL,
	`client_id` text NOT NULL,
	`mission_code` text NOT NULL,
	`origine_code` text NOT NULL,
	`apporteur_id` text,
	`projet_origine_id` text,
	`adresse` text,
	`taux_pb` integer,
	`forfait_ttc` integer,
	`taux_apport_pb` integer,
	`issue` text DEFAULT 'en_cours' NOT NULL,
	`motif_issue` text,
	`notes` text,
	`archive` integer DEFAULT false NOT NULL,
	`cree_le` text DEFAULT (datetime('now')) NOT NULL,
	`cree_par` text,
	`modifie_par` text,
	`modifie_le` text,
	FOREIGN KEY (`client_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`mission_code`) REFERENCES `mission`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origine_code`) REFERENCES `origine`(`code`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`apporteur_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `projet_client_idx` ON `projet` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projet_reference_idx` ON `projet` (`reference`);