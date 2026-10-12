# Les 3 Bases Gagnant : site automatique

Chaque jour, une tâche gratuite (GitHub Actions) télécharge le journal hippique PMU'B sur lonab.bf, lit les partants, calcule les trois bases et republie le site. Vous n'avez plus rien à faire.

## Mise en ligne (une seule fois, environ 10 minutes)

1. Créez un compte gratuit sur github.com, puis un dépôt **public** nommé `les-3-bases-gagnant`.
2. Envoyez-y tout le contenu de ce dossier : « Add file » puis « Upload files ». Glissez aussi le dossier caché `.github`, sans lui le site ne se met pas à jour tout seul.
3. Dans le dépôt : Settings, Pages, Source « Deploy from a branch », branche `main`, dossier `/ (root)`, puis Save.
4. Dans le dépôt : Actions, « Mise à jour quotidienne », Run workflow. Cela lance une première mise à jour.
5. Votre site apparaît sur `https://VOTRE-NOM.github.io/les-3-bases-gagnant/` après une à deux minutes.

## Fonctionnement

- La tâche s'exécute chaque jour à 6 h, 16 h et 20 h (heure du Burkina).
- Elle cherche les journaux d'aujourd'hui, de demain et d'après-demain, nommés `JH_PMUB_DU_JJ-MM-AAAA.pdf`, dans les dossiers du mois sur lonab.bf.
- Le site affiche un bouton par jour disponible et ouvre par défaut la course du jour. Les courses de plus de 14 jours sont retirées.
- Le bouton « Choisir le journal PDF » du site permet toujours d'analyser un autre journal à la main.
- Bilan automatique : chaque journal contient l'arrivée de la veille. Le script compare les bases calculées pour cette course à l'arrivée officielle et ajoute le résultat à la section « Bilan » du site, avec le résultat attendu au hasard en repère. Pour corriger une arrivée, modifiez `data/arrivees.json` (numéros dans l'ordre d'arrivée) et retirez la ligne du même jour dans `data/bilan.json`.

## Galop et trot

Le lecteur comprend les journaux de galop (poids) et de trot attelé (distance et chrono). Il reconnaît les jeux 4+1, Quarté et Tiercé. Au trot, la distance remplace le poids et le chrono (réduction kilométrique) devient un critère de plus.

## Tester la qualité des analyses

`data/archive.json` garde toutes les courses lues et `data/arrivees.json` les arrivées. Lancez `node scripts/backtest.cjs` pour comparer le modèle au hasard sur toutes les courses dont l'arrivée est connue, critère par critère. Ne changez les poids que sur au moins 30 courses : en dessous, les écarts sont du hasard.

## Si le téléchargement automatique échoue

Le site de la LONAB peut refuser les connexions automatiques. Regardez le journal d'exécution dans l'onglet Actions : une ligne « 403 » le confirme. Dans ce cas, déposez le PDF du journal dans le dossier `journaux/` du dépôt (Add file, Upload files). La mise à jour démarre seule et le site est à jour en une minute.

## Réglages

- Les poids des critères (forme, marché, classe, poids, aptitudes, entourage) se règlent sur le site.
- Les valeurs par défaut se changent dans `engine.js`, tableau `BASES_FACTORS`. Elles ont été réglées sur 25 courses (forme 30, marché 30, classe 10, aptitudes 20, le reste à 0).
- Vérifiez que la LONAB accepte la reprise de ses informations sur votre site, et gardez le rappel de jeu responsable.
