# 🎮 Mini Arcade

Plateforme de mini-jeux jouables directement dans le navigateur. 100% statique — HTML/CSS/JS vanilla, aucune dépendance, aucun backend, aucune base de données.

## Les bornes

Chaque borne reprend les règles et l'ambiance de son époque — pas l'art d'origine : sprites,
labyrinthe et sons sont dessinés ou synthétisés pour ce site.

| Borne | Dans l'esprit de | Ce qu'elle a de particulier |
|---|---|---|
| Pong | 1972 | Tout en blanc, chiffres en blocs, les trois bips d'origine ; raquette au doigt ou à la souris, comme la molette |
| Croque-Labyrinthe | 1980 | Labyrinthe fixe et symétrique, maison des fantômes, quatre poursuivants qui visent chacun ailleurs, vagues dispersion/poursuite, fruits, « PRÊT ! », labyrinthe qui clignote |
| Tetris | 1984-89 | Sac de 7, garde, délai de verrouillage, lignes qui clignotent, et *Korobeiniki* (domaine public) en chiptune qui accélère avec le niveau |
| Vague Zéro | 1978 | Formation de 11 × 5 animée sur 2 images, marche à quatre notes qui accélère, un seul tir à la fois, abris qui s'effritent, soucoupe mystère, film de couleur rouge/vert |
| Serpent | 1976-97 | Virages mis en file, bonus chronométré |
| Casse-Brique | 1976 | Huit rangées 1/3/5/7 points, accélérations à 4 et 12 touches puis aux rangées orange et rouge, raquette qui rétrécit au plafond |
| 2048 | 2014 | Fusion classique, tuiles colorées par valeur |
| Démineur | 1990 | Mines posées **après** le premier clic |
| Simon | 1978 | Une note par quartier |
| Bat d'Aile | 2013 | Une seule touche |
| Puissance 4 | 1974 | IA minimax |
| Paires | — | Mémoire, coups et temps comptés |
| **Astéroïdes** | 1979 | Nouvelle. Traits vectoriels lumineux, inertie, rochers en trois tailles, soucoupe qui vise, hyperespace, battement à deux notes |
| **Traversée** | 1981 | Nouvelle. Route puis rivière, rondins, tortues qui plongent, cinq abris, mouche bonus, chrono |
| **Riposte** | 1980 | Nouvelle. Six villes, trois silos, ogives qui se divisent, explosions en chaîne, palette qui change à chaque vague |
| **Galaxie** | 1979 | Nouvelle. Flotte qui ondule sur un ciel étoilé, pillards en piqué, amiraux escortés (jusqu'à 800 points), un tir à la fois |
| **Mille-pattes** | 1981 | Nouvelle. Il se coupe en deux à chaque tir et laisse des champignons ; araignée, puce, canon libre dans la zone du bas |
| **Alunissage** | 1979 | Nouvelle. Module vectoriel, gravité, pistes ×2/×3/×5, instruments de bord ; la partie s'arrête quand le réservoir est vide |
| **Motos lumière** | 1982 | Nouvelle. Murs de lumière, rivaux qui cherchent à t'enfermer, un rival de plus par manche |
| **Freedoom** | 1993 | Le vrai moteur de *Doom* (GPL) en WebAssembly avec Freedoom, un Doom complet et libre en 4 épisodes ; charge ton propre `DOOM.WAD` si tu l'as. Son, musique, sauvegardes, commandes tactiles |
| **Pyramide** | 1982 | Nouvelle. Pyramide isométrique de 28 cubes, sauts en diagonale seulement, boules qui dévalent, disque volant pour un sauvetage par tableau |
| **Bombes** | 1983 | Nouvelle. Labyrinthe de piliers, briques destructibles, sortie et bonus cachés dessous, explosions en chaîne qui ne t'épargnent pas |
| **Éboulis** | 1984 | Nouvelle. Grotte à creuser, rochers qui tombent et roulent sur les dos ronds, quota de diamants et chrono avant la sortie |
| **Tuyaux** | 1989 | Nouvelle. File de pièces imposée, compte à rebours avant le lâcher d'eau, croix réutilisable une fois, fuite = essai perdu |
| **Colonnes** | 1990 | Nouvelle. Colonne de trois gemmes dont tu permutes les couleurs en vol, alignements en diagonale compris, chaînes qui paient double |
| **Foreuse** | 1982 | Nouvelle. Quatre strates, galeries creusées à la demande, harpon qui gonfle les bestioles en quatre appuis, rochers qui écrasent (×5) et bestioles qui traversent la terre |
| **Échelles** | 1983 | Nouvelle. Or à ramasser, gardiens qui chassent, briques à creuser en diagonale qui se rebouchent toutes seules, cordes, échelle de fuite une fois l'or pris ; deux plans dessinés à la main, joués aussi en miroir |
| **Qix** | 1981 | Nouvelle. Tracé de lignes depuis le bord, remplissage de la zone que le Qix ne peut plus atteindre, tracé lent qui vaut le double, mèche qui remonte ta ligne si tu t'arrêtes |

### Les bornes maison

Celles-là ne copient rien : règles, niveaux et dessins sont écrits pour ce site.

| Borne | Genre | Ce qu'elle a de particulier |
|---|---|---|
| Éteins-Tout | Puzzle | Une case inverse ses voisines ; le mélange est fait de vrais coups, donc toujours résoluble, et l'indice vient de là |
| Taquin | Puzzle | Mélange toujours résoluble, couleurs qui aident autant que les chiffres |
| Tour de Hanoï | Réflexion | Trois piquets, le minimum de coups comme référence |
| Tape-Taupe | Réflexe | Séries qui multiplient, taupe dorée, bombes à éviter |
| Saute-Nuages | Arcade | Rebond automatique, ressorts, nuages d'orage qui s'effritent |
| Cosmo-Course | Réflexe | Saut à hauteur variable, rochers et drones, étoiles à ramasser |
| Hockey de Table | Action | Palet quasi sans frottement, maillet au doigt |
| Reversi | Réflexion | IA qui aime les coins et les bords, indice à la demande |
| Gemmes | Puzzle | Gemmes rayées à 4, arc-en-ciel à 5, combos en cascade |
| Bulles | Arcade | Nid suspendu, grappes qui tombent, plafond qui descend |
| **Entrepôt** | Puzzle | Sokoban : huit niveaux dessinés à la main, un « par » par niveau, annulation illimitée |
| **Le Mot** | Réflexion | Trois mots français de cinq lettres par partie, clavier AZERTY à l'écran, première lettre donnée |
| **Défense** | Réflexion | Tower defense : une route fixe, deux tours (dégâts, ralentissement) sur trois niveaux, jusqu'à 14 vagues |
| **Caverne** | Arcade | Plateforme : cinq salles, saut à hauteur variable, plateforme mobile, pics et lave, chrono par salle |
| **Rallye** | Réflexe | Quatre voies, trafic qui se densifie, réservoir qui descend, bidons à ramasser, braquage continu (pas de voie à voie) |
| **Plateformes** | Arcade | Six tableaux d'un écran, saut coupé si tu lâches la touche, *coyote time*, marcheurs à écraser, pièces et drapeau |

Chaque borne porte sa propre couleur d'encre : elle identifie le jeu sur sa carte, sur son
écran et dans le tableau des scores.

## Parti pris visuel

Une salle d'arcade le soir : fond indigo profond, deux halos (orange et violet) peints une
seule fois derrière la page, et une grille de verre à peine visible qui s'efface vers le bas.
Chaque borne tient sa couleur d'encre (`--ink`) et s'en sert partout.

- **un rail flottant à gauche** sur grand écran (marquise de la marque, cinq rubriques
  avec une barre lumineuse sur l'onglet actif, son/thème/code), **une barre en haut et des
  onglets sous le pouce** sur téléphone ; la barre d'onglets disparaît en partie ;
- les cartes sont des **bornes** : bandeau lumineux en haut, écran au milieu (la vraie
  capture du jeu, `img/games/<id>.png`), socle en bas avec le nom et ton record ; au survol,
  la borne se soulève et son encre s'allume ;
- l'accueil s'ouvre sur une **marquise** : le texte à gauche, une borne qui **joue toute
  seule** à droite (Pong en mode démo, coupé si « Animations » est décoché ou si le système
  demande moins de mouvement), puis une bande de compteurs et **une étagère par genre**
  qui défile horizontalement ;
- la page des scores commence par un **podium** de tes trois plus gros records ;
- un seul jeu de variables CSS (couleurs, type, espaces, rayons, ombres, halo, focus,
  animations) dans `:root`, et un thème clair qui ne change que des variables ;
- le cadre de l'écran prend **la forme du jeu** : une borne en portrait n'est pas noyée
  dans un cadre 4/3 ;
- tout réagit à l'appui, jamais au relâchement ; courbes amorties sans rebond ;
- l'écran de jeu reste noir dans les deux thèmes, et l'encre du jeu y diffuse un halo ;
- téléphone tourné, la page de jeu devient une console portable : croix, écran, boutons.

## Le catalogue

Recherche (insensible à la casse et aux accents), filtre par genre, filtre **★ Favoris**,
filtre « jamais jouées », filtre par **commandes** (une seule touche, souris ou doigt,
gauche/droite, quatre directions — déduit du `touch` déclaré par chaque borne, pas d'un
second champ à tenir à jour), cinq tris, nombre de résultats, rappel des filtres actifs et
bouton **Tout effacer** — tout marche ensemble. Les cartes montrent le titre, l'écran, le
genre et soit ton record, soit la difficulté en points ; une pastille marque les bornes déjà
jouées, et l'étoile en haut à droite met la borne en favori (elle remonte alors sur l'accueil).

## Profil, XP et défis

`js/progress.js` tient toute la progression dans une seule clé `arcade:prog`, à côté des
scores — aucun compte, aucun serveur.

- **XP et niveaux** : une partie rapporte `10 + √score + 25 si gagnée + 5 × difficulté`.
  Chaque niveau coûte 150 XP de plus que le précédent, et chaque badge en vaut 100.
- **17 badges** : premières parties, bornes essayées, victoires, victoire en difficile,
  gros score, série de jours, défis remplis, partie nocturne…
- **Deux défis par jour**, tirés d'un hachage de la date (donc identiques pour tout le monde,
  sans rien stocker ailleurs) : une borne au sort avec un objectif de points figé à la première
  consultation de la journée, et « trois bornes différentes aujourd'hui ». Remise à zéro à
  minuit, heure de la machine.
- **Historique** des 60 dernières parties, **statistiques par borne** (parties, victoires,
  meilleur score) et **série de jours consécutifs**, sur la page `#/profil`.
- Les gains d'une partie (XP, niveau pris, badges, défis) s'affichent sur l'écran de fin et
  sont annoncés aux lecteurs d'écran.

## Freedoom / Doom

- **Moteur** : [doomgeneric](https://github.com/ozkl/doomgeneric) (GPL-2.0, commit `dcb7a8d`),
  compilé par `tools/doom/build.sh` avec Emscripten. Seul ajout : `tools/doom/doomgeneric_web.c`,
  qui confie l'image, le clavier, les sons et la musique au navigateur. Résultat dans
  `js/games/doom/engine.{js,wasm}` (≈ 450 Ko).
- **Données** : `js/games/doom/freedoom1.wad`, [Freedoom](https://freedoom.github.io/) 0.13.0
  (licence BSD), 28 Mo, téléchargé seulement quand on lance la borne.
- **Ton DOOM.WAD** : le bouton « Charger mon DOOM.WAD » lit le fichier sur l'appareil
  (Doom, Ultimate Doom, Doom II…). Rien n'est envoyé ni hébergé.
- **Son** : les effets sont lus depuis le WAD via Web Audio ; la musique est convertie de MUS en
  MIDI par le moteur puis jouée par un petit synthé dans `js/games/doom.js` (esprit carte FM).
- **Sauvegardes** : stockées dans IndexedDB du navigateur, elles survivent à la fermeture.
- **Recompiler** : `DOOMGENERIC=chemin/vers/doomgeneric bash tools/doom/build.sh` avec `emcc` dans le PATH.
- Le nom DOOM est une marque déposée : la borne s'appelle Freedoom.

## Sur téléphone

- **Installer** : iPhone → Partager → « Sur l'écran d'accueil ». Android → menu → « Installer
  l'application ». Elle s'ouvre alors en plein écran et **fonctionne hors ligne** (`sw.js`).
- **Jouer** : croix, joystick et boutons sous les pouces — joystick pour Croque-Labyrinthe
  (quatre directions) et Tetris (gauche/droite, avec boutons dédiés Tourner et Descente
  douce) ; glissements sur l'écran pour Serpent, 2048, Croque-Labyrinthe, Traversée et
  Tetris ; raquette au doigt pour Pong et Casse-Brique ; volant au doigt pour Rallye ;
  toucher l'écran pour Riposte. Téléphone tourné : disposition console portable.
- L'écran reste allumé pendant une partie, la partie se met en pause si tu changes d'app,
  et un bouton plein écran apparaît quand le navigateur le permet (Android, ordinateur).

## Ambiance d'époque

- **Écran cathodique** (réglable) : lignes de balayage et vignettage sur l'écran de jeu.
- **Initiales** : un score qui entre dans le top 5 se signe de trois lettres, comme sur borne.
- **Musique** (réglable) : petit séquenceur chiptune dans `audio.js` (`SONGS`), joué par les
  bornes qui déclarent `music` dans le catalogue. Trois airs : *Korobeiniki* (domaine public,
  Tetris), `caverne` (Caverne, Plateformes) et `course` (Rallye, Cosmo-Course), écrits ici.

## Installation

```bash
git clone <url-du-repo>
cd <repo>
```

## Développement

Le site utilise des modules ES (`<script type="module">`), qui nécessitent un serveur HTTP (pas d'ouverture directe du fichier `index.html` en `file://`). Lance un petit serveur statique à la racine :

```bash
npx serve .
# ou
python -m http.server 8080
```

Puis ouvre `http://localhost:8080` (ou le port affiché).

## Build

Aucun build n'est nécessaire — c'est du HTML/CSS/JS statique servi tel quel.

## Publier sur GitHub Pages

1. Crée un repository GitHub et pousse ce projet (`git add . && git commit -m "init" && git push`).
2. Dans le repo GitHub : **Settings → Pages**.
3. Source : **Deploy from a branch**.
4. Branche : `main`, dossier `/ (root)`.
5. Enregistre — le site est publié à `https://<user>.github.io/<repo>/`.

Aucun workflow GitHub Actions n'est requis puisqu'il n'y a pas d'étape de build. Le routing du site utilise des ancres (`#/games`, `#/game/pong`, …) pour rester compatible avec l'hébergement statique de GitHub Pages sans configuration de redirection particulière.

## Architecture

```text
/
├── index.html           # coquille : rail / barre, onglets, pied de page
├── manifest.webmanifest # appli installable
├── sw.js                # cache hors ligne (liste dérivée du catalogue)
├── css/style.css        # variables, coquille, composants, pages, jeu
├── img/games/           # une capture d'écran par borne (vignettes)
├── img/icons/           # icônes de l'appli installée
├── img/og.png           # carte de partage, dessinée par tools/og.mjs
├── js/
│   ├── app.js           # routeur (par ancres) + rendu des pages + page de jeu
│   ├── catalog.js       # registre des bornes (source unique des titres et URL)
│   ├── storage.js       # scores & réglages (localStorage, lectures typées)
│   ├── audio.js         # sons et musique procéduraux (Web Audio API)
│   └── games/           # un module autonome par borne
└── tools/
    ├── shoot.mjs        # photographie l'écran d'une borne -> img/games/<id>.png
    ├── smoke.mjs        # fait tourner une borne sans navigateur (crash, score, sons)
    ├── og.mjs           # dessine img/og.png
    └── doom/            # sources et script de compilation du moteur Doom (GPL)
```

## Ajouter un nouveau jeu

1. Crée `js/games/mon-jeu.js` exportant `createGame(canvas, host)` qui retourne `{ start(), togglePause(), input(action, isDown), destroy() }`.
   - `host.onStats({score, level, lives})` met à jour le HUD.
   - `host.onGameOver(score, won)` déclenche l'écran de fin et sauvegarde le score.
   - `host.sfx` expose des sons prêts à l'emploi (`move`, `hit`, `score`, `gameover`, `win`, `clear`).
2. Ajoute une entrée dans `js/catalog.js` : `id`, `name`, `ink` (la couleur de la borne),
   `glyph` (le pictogramme, contenu d'un `viewBox` 24×24 en `currentColor`), `category`,
   `difficulty`, `description`, `module`, `touch`.
3. Ajoute une capture `img/games/<id>.png` du canvas en cours de partie
   (`canvas.toBlob()` depuis la console suffit). Sans elle, la vignette affiche le `glyph`.
4. Rien à faire pour le hors ligne : `sw.js` lit les identifiants dans `js/catalog.js`
   et met en cache `js/games/<id>.js` et `img/games/<id>.png` tout seul. Change juste
   `CACHE` (`-v6`…) pour que les visiteurs déjà installés reprennent la nouvelle liste.
5. `node tools/shoot.mjs <id>` photographie l'écran de la borne, et
   `node tools/og.mjs` redessine l'image de partage (elle annonce le nombre de bornes).
6. `node tools/smoke.mjs js/games/<id>.js` fait tourner la borne hors navigateur : elle
   doit survivre à quelques milliers d'images et marquer des points.

Options du catalogue : `swipe` (glissements = croix), `music` (id d'un air de `SONGS`),
`livesLabel` (renomme le troisième compteur), `custom` (jeu avec ses propres menus : pas de
compteurs ni de difficulté), `filePicker` (bouton pour charger un fichier, transmis en `opts.file`).
Un contrôleur qui expose `ownsKeyboard: true` reçoit tout le clavier lui-même.

La physique doit avancer au temps réel, pas à l'image : les écrans de téléphone à 120 Hz
appellent `requestAnimationFrame` deux fois plus souvent. Les jeux réglés « par image »
(Pong, Casse-Brique, Bat d'Aile, Vague Zéro, Puissance 4, Astéroïdes, Riposte, Galaxie, Mille-pattes, Alunissage) avancent par pas fixes de 1/60 s.

Le contrôleur doit exposer `start()`, `togglePause()` (qui **renvoie** le nouvel état, pour
que le bouton affiche « Pause » ou « Reprendre »), `setPaused(v)`, `input(action, isDown)`
et `destroy()`.

Les actions reçues par `input` : `up`, `down`, `left`, `right`, `action`, `hold`.
Un jeu à la souris (Démineur) pose ses propres écouteurs sur le canvas et les retire
dans `destroy()`.

### Scores

`host.onGameOver(score, won, display)` : `score` doit être un **nombre** (c'est lui qui
classe le tableau) ; `display` est facultatif et sert quand le nombre n'est pas ce qu'on
veut lire — Pong enregistre `702` et affiche « 7 — 2 ».

### Compteurs

Le troisième compteur du bandeau s'appelle « Vies » par défaut ; `livesLabel` dans le
catalogue le renomme (le Démineur y affiche « Mines »). Le nombre de bornes affiché sur
le site est dérivé de `GAMES.length`, jamais écrit en dur.

Le jeu est chargé en lazy-loading (`import()`) uniquement quand le joueur clique sur "Jouer" — aucun impact sur le temps de chargement initial.

## Sauvegarde locale

Tout est stocké dans `localStorage` sous le préfixe `arcade:` (scores, thème, volume, dernier
jeu joué, et la progression : XP, badges, favoris, historique, défis du jour). Aucune donnée
ne quitte le navigateur. « Effacer les données locales » dans les Réglages efface ce préfixe.

## Accessibilité

- navigation clavier complète, lien d'évitement, focus visible, `aria-current` sur l'onglet actif ;
- `prefers-reduced-motion` : les transformations sont neutralisées (interrupteur manuel
  « Animations » en doublon dans les réglages) ;
- sur pointeur grossier, la page de jeu se cale sur la hauteur de l'écran, les commandes
  tactiles restent sous les pouces et l'aide affiche la carte tactile au lieu du clavier ;
- `prefers-reduced-transparency` : en-tête, barre d'onglets et voile de pause deviennent opaques ;
- `prefers-contrast: more` : contours sur les cartes, libellés secondaires renforcés ;
- les encres ne servent jamais de texte fin sur fond clair — elles y passent en aplat ;
  l'accent en texte passe à un orange plus sombre (`--accent-text`) en thème clair.
