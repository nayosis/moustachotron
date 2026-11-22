-- Valeurs de départ (conception, cadrage du 22/11/2026) : missions et leur règle de prix, origines, réglages.
INSERT INTO `mission` (`code`, `libelle`, `mode`, `taux_pb`, `forfait_ttc`, `tva_pb`, `avec_travaux`, `avec_acompte`, `echeancier`, `ordre`, `archive`) VALUES
('AMO', 'AMO', 'pourcentage', 1500, NULL, NULL, 1, 1, '[{"code":"acompte","libelle":"Acompte","type":"acompte","jalon":"validation_mission"},{"code":"signature_devis","libelle":"Signature des devis (40 %, acompte déduit)","type":"part","partPb":4000,"deduireAcompte":true,"jalon":"validation_devis"},{"code":"demarrage","libelle":"Démarrage des travaux (40 %)","type":"part","partPb":4000,"jalon":"demarrage_travaux"},{"code":"solde","libelle":"Solde à la réception","type":"solde","jalon":"reception_travaux"}]', 1, 0),
('MOE', 'MOE', 'pourcentage', 1500, NULL, NULL, 1, 1, '[{"code":"acompte","libelle":"Acompte","type":"acompte","jalon":"validation_mission"},{"code":"signature_devis","libelle":"Signature des devis (40 %, acompte déduit)","type":"part","partPb":4000,"deduireAcompte":true,"jalon":"validation_devis"},{"code":"demarrage","libelle":"Démarrage des travaux (40 %)","type":"part","partPb":4000,"jalon":"demarrage_travaux"},{"code":"solde","libelle":"Solde à la réception","type":"solde","jalon":"reception_travaux"}]', 2, 0),
('COU', 'Courtage', 'pourcentage', 600, NULL, NULL, 1, 1, '[{"code":"acompte","libelle":"Acompte","type":"acompte","jalon":"validation_mission"},{"code":"solde","libelle":"Solde à la signature des devis","type":"solde","jalon":"validation_devis"}]', 3, 0),
('EXP', 'Expertise', 'forfait', NULL, NULL, 2000, 0, 0, '[{"code":"commande","libelle":"50 % à la commande","type":"part","partPb":5000,"jalon":"validation_mission"},{"code":"solde","libelle":"50 % à la livraison du rapport","type":"solde","jalon":"remise_rapport"}]', 4, 0),
('EAA', 'EAA — Estimation Avant Achat', 'forfait', NULL, 19900, 2000, 0, 0, '[{"code":"solde","libelle":"100 % à la livraison du rapport","type":"solde","jalon":"remise_rapport"}]', 5, 0),
('AUD', 'Audit énergétique', 'forfait', NULL, NULL, 2000, 0, 0, '[{"code":"solde","libelle":"À la remise du rapport","type":"solde","jalon":"remise_rapport"}]', 6, 1);
--> statement-breakpoint
INSERT INTO `origine` (`code`, `libelle`, `ordre`) VALUES
('reseau', 'Réseau (franchise)', 1),
('site', 'Site internet', 2),
('bouche', 'Bouche-à-oreille', 3),
('apporteur', 'Apporteur d''affaires', 4),
('partenaire', 'Partenaire', 5),
('autre', 'Autre', 6);
--> statement-breakpoint
INSERT INTO `parametre` (`cle`, `valeur`) VALUES
('bareme_acompte', '[{"plafondTtc":1999999,"acompteTtc":50000},{"plafondTtc":7500000,"acompteTtc":75000},{"plafondTtc":10000000,"acompteTtc":100000},{"plafondTtc":null,"acompteTtc":150000}]'),
('commission_defaut_pb', '1300'),
('apport_defaut_pb', '1000'),
('relance_jours', '15'),
('alerte_assurance_jours', '30');
