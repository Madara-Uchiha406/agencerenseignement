-- =====================================================
-- AGENCE DE RENSEIGNEMENT (SITE 11) - SCHEMA SQL
-- =====================================================

-- Suppression de la table si elle existe déjà (remise à zéro propre)
DROP TABLE IF EXISTS dossiers;

-- Création de la table principale des dossiers
CREATE TABLE dossiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    sujet TEXT NOT NULL,
    niveau TEXT NOT NULL,
    statut TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertion de dossiers initiaux par défaut
INSERT INTO dossiers (code, sujet, niveau, statut) VALUES 
('#DOS-0841', 'Mouvement Faction ReCreate', 'Niveau 3', 'Surveillance active');
