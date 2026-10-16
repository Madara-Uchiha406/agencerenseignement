# Agence de renseignement — Site 11

Portail français organisé en pages séparées, avec Supabase pour l’authentification, les profils agents, les dossiers, le journal d’activité et la messagerie :

- `index.html` / `index.css` : page Informations et accueil.
- `dashboard.html` / `dashboard.css` : tableau de bord public et gestion des dossiers autorisés.
- `contact.html` / `contact.css` : présentation de la messagerie visiteurs.
- `messages.html` / `messages.css` : boîte de réception des agents.
- `maintenance.html` / `maintenance.css` : réglages de maintenance réservés au superadmin.
- `chat-widget.css` : bulle de messagerie partagée sur les pages du site.
- `anniversary.css` : animations d’interface, respect de la préférence de réduction des animations et thème anniversaire.
- `connexion.html` / `connexion.css` : connexion des comptes agents.
- `agents.html` / `agents.css` : gestion des comptes, réservée au niveau 5.
- `journal.html` / `journal.css` : journal d’audit, réservé aux niveaux 4 et 5.
- `app.js` : interactions et appels Supabase.
- `config.js` : URL Supabase et clé publique.
- `supabase/schema.sql` : tables, génération de codes, règles d’accès et journalisation.
- `supabase/chat.sql` : migration de conversations, messages et accès visiteur.
- `supabase/maintenance.sql` : réglages de maintenance globale et par page, contrôlés par le superadmin officiel.
- `supabase/level-zero.sql` : migration pour autoriser les dossiers de niveau 0 sans perdre les données.
- `supabase/enhancements.sql` : archivage des dossiers, pièces jointes privées au chat et activation Realtime pour les alertes.
- `supabase/functions/manage-agent/index.ts` : création, modification et suppression sécurisées de comptes.
- `database.sql` : ancien schéma SQLite local, conservé en archive ; le portail Supabase ne l’utilise plus.

## Mise en place Supabase

1. Le projet Supabase utilisé par le portail doit déjà avoir son schéma et sa messagerie installés. Dans le tableau de bord Supabase, ouvrez **SQL Editor** et exécutez (ou réexécutez) `supabase/enhancements.sql` depuis ce dépôt. La migration ajoute le bucket privé des pièces jointes (10 Mo maximum, JPG/PNG/WebP/PDF), les règles d’accès, les colonnes de présentation/archivage des dossiers et active les changements Realtime pour les dossiers et messages. Elle ne supprime pas les données existantes.
2. Dans **Authentication > Providers / Sign In**, activez les connexions anonymes (**Anonymous Sign-Ins**) pour autoriser les visiteurs à ouvrir un chat sans compte. Gardez les inscriptions par e-mail désactivées ; les comptes agents sont créés depuis la page Comptes par un agent niveau 5.
3. Dans **Authentication > Users**, créez puis confirmez l’utilisateur officiel `directionagencerenseignement@gmail.com`. Ne place pas son mot de passe dans Git, dans `config.js` ou dans un fichier SQL.
4. Dans **SQL Editor**, exécutez `supabase/first-admin.sql` pour attribuer le niveau 5 et le rôle protégé d’administrateur officiel à ce compte Auth déjà créé. Si le compte existe déjà, réexécutez ce script après la migration.
5. Dans **Project Settings > API**, renseignez `supabaseUrl` et la clé **publishable/anon** dans `config.js`. Cette clé publique est prévue pour le navigateur ; ne mettez jamais la clé `service_role` ni le mot de passe PostgreSQL dans les fichiers du site.
6. Installez la Supabase CLI, lancez `supabase login`, puis déployez la fonction depuis la racine du projet avec `supabase functions deploy manage-agent --project-ref <reference-du-projet>`. Vérifiez les secrets de fonctions dans le tableau de bord ; si `SUPABASE_SERVICE_ROLE_KEY` n’y est pas disponible, ajoutez-la uniquement dans **Edge Functions > Secrets**. Ne partagez jamais cette clé et ne la mettez jamais dans les fichiers du site. Si la fonction n’est pas déployée, la page Comptes affichera une erreur 404 explicite à l’enregistrement.
7. Publiez les fichiers du site sur un hébergement statique via HTTPS.

Le niveau d’accès agent est compris entre 1 et 5. Les dossiers vont du niveau 0 à 5 ; les visiteurs et tous les agents de niveau 1 voient les dossiers de niveau 0 et 1. Un dossier au statut `Classified` est forcé au niveau 5 côté base. Les changements de dossiers et de comptes, ainsi que les connexions et déconnexions, alimentent le journal.

La date de création officielle du Site 11 est le **16 octobre 2026**. Le thème anniversaire s’active automatiquement chaque 16 octobre (avec une bannière de lancement pour 2026, puis le numéro d’anniversaire les années suivantes), avec rideaux décoratifs et feux d’artifice animés. Les boutons réagissent au pointeur et au clic, et les menus déroulants ont un état de focus/hover animé. Si le système indique « réduire les animations », les animations décoratives sont désactivées.

## Dossiers

Le Dashboard présente chaque dossier dans une fiche avec sa description, son numéro, ses dates et les noms de création/modification ; la sélection rapide, le tri et les filtres facilitent la navigation. Une accréditation dépliable indique les niveaux autorisés. Le niveau 5 peut activer l’affichage anonyme de l’auteur ; son nom n’est alors plus exposé dans les données de dossier accessibles aux autres niveaux. L’historique détaillé n’est pas affiché sur le Dashboard ; les événements restent consultables dans le Journal par les niveaux autorisés. Les agents de niveau 4 et 5 peuvent exporter les dossiers accessibles en CSV ou préparer une version imprimable à enregistrer en PDF. L’archivage/restauration est réservé aux niveaux 4 et 5 ; les dossiers archivés sont masqués aux visiteurs et consultables avec la case d’archives.

## Messagerie

Les visiteurs peuvent envoyer un message depuis le formulaire **Contact** sans rechargement ni changement de page, ou ouvrir la bulle en bas à gauche pour créer et retrouver leurs conversations sur le même navigateur. La session anonyme Supabase est conservée dans le stockage local du navigateur et réutilisée entre les pages et les onglets ; ouvrir simplement la bulle ne crée plus de compte, la session n’est créée qu’au premier envoi. Les visiteurs et agents peuvent joindre des images JPG/PNG/WebP ou un PDF (10 Mo maximum). Les fichiers sont stockés dans un bucket privé, accessibles seulement aux participants autorisés de la conversation et supprimés avec leurs messages. Les agents actifs répondent depuis **Messages** ; ils peuvent classer les conversations en attente, en cours ou traitées. Seuls les agents de niveau 5 peuvent supprimer une conversation. Chaque message, du visiteur ou d’un agent, renouvelle la conservation du chat de 24 heures. Sans nouveau message, le chat et ses messages sont supprimés après 24 heures ; un compte visiteur anonyme sans chat actif est supprimé après 12 heures. Le nettoyage s’exécute automatiquement toutes les cinq minutes via l’extension Supabase **pg_cron**. Les changements de statut seuls ne renouvellent pas le délai. Les messages ne sont pas copiés dans le journal d’audit.

Les agents peuvent activer les alertes depuis le bouton dans l’en-tête. Tant que le site est ouvert, Realtime affiche une notification pour les nouveaux messages de visiteurs et les changements de dossiers ; les notifications du navigateur nécessitent l’autorisation de l’utilisateur.

Les comptes anonymes Supabase identifient les visiteurs et ne sont pas des comptes agents. Un visiteur qui efface les données de son navigateur ne pourra plus retrouver ses conversations précédentes.

## Assistant IA local

Une bulle **Assistant IA** est disponible sur les pages du portail. Elle utilise le modèle open source `qwen2.5:7b` exécuté par Ollama sur le PC où le visiteur ouvre le site ; le PC doit rester allumé avec Ollama et le relais local actifs. L’assistant ne fonctionne donc pas pour les visiteurs distants qui n’ont pas Ollama installé sur leur propre appareil.

Le relais Node.js sans dépendances se trouve dans `ai-local/server.mjs`. Il lit l’URL et la clé publique Supabase dans `config.js`, écoute uniquement sur `127.0.0.1:11435` et n’autorise par défaut que l’origine GitHub Pages `https://madara-uchiha406.github.io`. Il vérifie le jeton Supabase et le niveau réel du profil agent côté serveur. Pour les visiteurs et agents de niveaux 1 à 4, un filtre accepte seulement les questions identifiées comme liées au site ; Qwen y répond à partir d’un contexte public fixe. Les demandes du pseudo Discord du créateur et de la charte reçoivent des réponses exactes, avec liens vers l’invitation Discord et le document Google. Les questions générales, calculs et sujets quotidiens sont refusés avant d’appeler Ollama. Les agents actifs de niveau 5 peuvent poser des questions générales et sur toutes les fonctions publiques documentées ; un contexte enrichi inclut les ajouts récents connus. Le niveau 5 ne donne pas à l’IA accès aux dossiers privés, conversations, comptes ou journaux : rien de cela n’est envoyé au modèle. Le widget ne rend cliquables que les liens publics connus, notamment l’invitation Discord et le document de charte.

### Démarrage sur Windows

1. Installez Node.js 20 ou une version plus récente si ce n’est pas déjà fait.
2. Lancez Ollama et vérifiez que le modèle est disponible avec `ollama run qwen2.5:7b`.
3. Dans une autre fenêtre PowerShell, depuis la racine du dépôt, lancez :
   ```powershell
   cd E:\AlanuCopyes\Github\agencerenseignement\ai-local
   node .\server.mjs
   ```
4. Gardez la fenêtre du relais ouverte, ainsi qu’Ollama. Publiez ensuite les fichiers du site : `app.js`, `chat-widget.css`, `ai-local/server.mjs` et `README.md`.

Si le site est servi depuis une autre origine, définissez `SITE_ORIGIN` dans l’environnement de la fenêtre PowerShell avant `node .\server.mjs`, avec uniquement l’origine exacte du site (schéma et nom d’hôte, sans chemin). Ne configurez pas `OLLAMA_HOST` sur `0.0.0.0` et ne redirigez pas le port du relais sur Internet. Le relais protège les demandes faites depuis le site en vérifiant Supabase ; l’utilisateur qui contrôle le PC peut toutefois toujours lancer Ollama directement depuis son propre terminal.

## Gestion des comptes

Le compte officiel marqué par `supabase/first-admin.sql` est exempté des restrictions hiérarchiques. Les autres gestionnaires (niveau 5) ne peuvent pas modifier ou supprimer leur propre compte, les comptes du même niveau ou ceux de niveau supérieur ; ils ne peuvent pas non plus créer ou promouvoir un compte à leur niveau ou au-dessus. Les contrôles sont appliqués dans la fonction Edge `manage-agent`, pas uniquement dans l’interface. Redéployez cette fonction après mise à jour du code.

## Maintenance du site

Après exécution de `supabase/maintenance.sql`, le superadmin officiel trouvera une catégorie **Maintenance** dédiée : maintenance complète ou indépendante pour chaque page, avec une raison personnalisable. Les paramètres sont lus publiquement afin que le navigateur puisse afficher l’écran de maintenance, mais seul le compte officiel peut les modifier. Le superadmin conserve l’accès pendant la maintenance ; la page de connexion reste disponible pour pouvoir se reconnecter. Une erreur de lecture des paramètres affiche un avertissement et laisse le site accessible.

Le code source HTML, CSS et JavaScript envoyé au navigateur est nécessairement visible dans les outils développeur, même sur GitHub Pages. Il ne faut pas y placer de secrets. La sécurité réelle repose sur Supabase RLS et les fonctions serveur ; la clé `anon` est publique par conception, tandis que `service_role` doit rester uniquement dans les secrets Edge Functions.

Le mot de passe PostgreSQL ne doit être utilisé que pour l’administration de la base, jamais dans le navigateur ou dans Git. Si un mot de passe de base a été partagé dans une conversation, régénérez-le dans Supabase.

## Dépôt GitHub privé et site publié

GitHub Free pour un compte personnel permet GitHub Pages à partir d’un dépôt public. GitHub Pro permet d’utiliser Pages avec un dépôt privé, mais le site publié reste public ; rendre le dépôt privé ne masque pas le HTML, le CSS et le JavaScript envoyés aux navigateurs. La publication réellement privée d’un site Pages nécessite une organisation GitHub Enterprise Cloud. Vérifiez votre forfait et les paramètres Pages avant de changer la visibilité du dépôt. Références : [forfaits GitHub](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) et [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

Le mot de passe du compte officiel a été partagé dans une conversation : change-le dès la première connexion dans Supabase Auth ou remplace-le avant de mettre le site en production.
