# Agence de renseignement — Site 11

Portail français organisé en pages séparées, avec Supabase pour l’authentification, les profils agents, les dossiers, le journal d’activité et la messagerie :

- `index.html` / `index.css` : page Informations et accueil.
- `dashboard.html` / `dashboard.css` : tableau de bord public et gestion des dossiers autorisés.
- `contact.html` / `contact.css` : présentation de la messagerie visiteurs.
- `messages.html` / `messages.css` : boîte de réception des agents.
- `chat-widget.css` : bulle de messagerie partagée sur les pages du site.
- `connexion.html` / `connexion.css` : connexion des comptes agents.
- `agents.html` / `agents.css` : gestion des comptes, réservée au niveau 5.
- `journal.html` / `journal.css` : journal d’audit, réservé aux niveaux 4 et 5.
- `app.js` : interactions et appels Supabase.
- `config.js` : URL Supabase et clé publique.
- `supabase/schema.sql` : tables, génération de codes, règles d’accès et journalisation.
- `supabase/chat.sql` : migration de conversations, messages et accès visiteur.
- `supabase/maintenance.sql` : réglages de maintenance globale et par page, contrôlés par le superadmin officiel.
- `supabase/functions/manage-agent/index.ts` : création, modification et suppression sécurisées de comptes.
- `database.sql` : ancien schéma SQLite local, conservé en archive ; le portail Supabase ne l’utilise plus.

## Mise en place Supabase

1. Dans le tableau de bord Supabase, ouvrez **SQL Editor**, exécutez d’abord `supabase/schema.sql`, puis `supabase/chat.sql` et enfin `supabase/maintenance.sql`. Les migrations de chat et de maintenance peuvent être relancées sans supprimer les données existantes.
2. Dans **Authentication > Providers / Sign In**, activez les connexions anonymes (**Anonymous Sign-Ins**) pour autoriser les visiteurs à ouvrir un chat sans compte. Gardez les inscriptions par e-mail désactivées ; les comptes agents sont créés depuis la page Comptes par un agent niveau 5.
3. Dans **Authentication > Users**, créez puis confirmez l’utilisateur officiel `directionagencerenseignement@gmail.com`. Ne place pas son mot de passe dans Git, dans `config.js` ou dans un fichier SQL.
4. Dans **SQL Editor**, exécutez `supabase/first-admin.sql` pour attribuer le niveau 5 et le rôle protégé d’administrateur officiel à ce compte Auth déjà créé. Si le compte existe déjà, réexécutez ce script après la migration.
5. Dans **Project Settings > API**, renseignez `supabaseUrl` et la clé **publishable/anon** dans `config.js`. Cette clé publique est prévue pour le navigateur ; ne mettez jamais la clé `service_role` ni le mot de passe PostgreSQL dans les fichiers du site.
6. Installez la Supabase CLI, lancez `supabase login`, puis déployez la fonction depuis la racine du projet avec `supabase functions deploy manage-agent --project-ref <reference-du-projet>`. Vérifiez les secrets de fonctions dans le tableau de bord ; si `SUPABASE_SERVICE_ROLE_KEY` n’y est pas disponible, ajoutez-la uniquement dans **Edge Functions > Secrets**. Ne partagez jamais cette clé et ne la mettez jamais dans les fichiers du site. Si la fonction n’est pas déployée, la page Comptes affichera une erreur 404 explicite à l’enregistrement.
7. Publiez les fichiers du site sur un hébergement statique via HTTPS.

Le niveau d’accès est compris entre 1 et 5. Les visiteurs non connectés ne voient que les dossiers de niveau 1 ; un agent ne voit que les dossiers jusqu’à son niveau. Un dossier au statut `Classified` est forcé au niveau 5 côté base. Les changements de dossiers et de comptes, ainsi que les connexions et déconnexions, alimentent le journal.

## Messagerie

Les visiteurs ouvrent la bulle en bas à gauche pour créer et retrouver leurs conversations sur le même navigateur. Les agents actifs répondent depuis **Messages** ; ils peuvent classer les conversations en attente, en cours ou traitées. Seuls les agents de niveau 5 peuvent supprimer une conversation. Chaque message, du visiteur ou d’un agent, renouvelle la conservation du chat de 24 heures. Sans nouveau message, le chat et ses messages sont supprimés après 24 heures ; un compte visiteur anonyme sans chat actif est supprimé après 12 heures. Le nettoyage s’exécute automatiquement toutes les cinq minutes via l’extension Supabase **pg_cron**. Les changements de statut seuls ne renouvellent pas le délai. Les messages ne sont pas copiés dans le journal d’audit.

Les comptes anonymes Supabase identifient les visiteurs et ne sont pas des comptes agents. Un visiteur qui efface les données de son navigateur ne pourra plus retrouver ses conversations précédentes.

## Gestion des comptes

Le compte officiel marqué par `supabase/first-admin.sql` est exempté des restrictions hiérarchiques. Les autres gestionnaires (niveau 5) ne peuvent pas modifier ou supprimer leur propre compte, les comptes du même niveau ou ceux de niveau supérieur ; ils ne peuvent pas non plus créer ou promouvoir un compte à leur niveau ou au-dessus. Les contrôles sont appliqués dans la fonction Edge `manage-agent`, pas uniquement dans l’interface. Redéployez cette fonction après mise à jour du code.

## Maintenance du site

Après exécution de `supabase/maintenance.sql`, le superadmin officiel trouvera les réglages de maintenance dans la page **Comptes** : maintenance complète ou indépendante pour chaque page. Les paramètres sont lus publiquement afin que le navigateur puisse afficher l’écran de maintenance, mais seul le compte officiel peut les modifier. Le superadmin conserve l’accès pendant la maintenance ; la page de connexion reste disponible pour pouvoir se reconnecter. Une erreur de lecture des paramètres affiche un avertissement et laisse le site accessible.

Le mot de passe PostgreSQL ne doit être utilisé que pour l’administration de la base, jamais dans le navigateur ou dans Git. Si un mot de passe de base a été partagé dans une conversation, régénérez-le dans Supabase.

Le mot de passe du compte officiel a été partagé dans une conversation : change-le dès la première connexion dans Supabase Auth ou remplace-le avant de mettre le site en production.
