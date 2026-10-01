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

Chaque borne porte sa propre couleur d'encre : elle identifie le jeu sur sa carte, sur son
marquee et dans le tableau des scores.

## Parti pris visuel

Une interface qui s'efface derrière les jeux, dans l'esprit des apps Apple :

- les vignettes montrent **le vrai écran de chaque jeu** (`img/games/<id>.png`, capturé
  pendant une partie) — on choisit en voyant à quoi on va jouer ;
- chrome translucide (`backdrop-filter`) sous lequel le contenu défile, coins continus,
  police système, interlettrage qui se resserre quand le texte grossit ;
- tout réagit à l'appui, jamais au relâchement ; courbes amorties sans rebond ;
- l'écran de jeu reste noir dans les deux thèmes, et l'encre du jeu y diffuse un halo ;
- sur téléphone : barre d'onglets sous le pouce, et la page de jeu tient dans l'écran
  sans défilement (croix à gauche, boutons à droite). Téléphone tourné, la mise en page
  devient celle d'une console portable : croix, écran, boutons.

## Les bornes du catalogue

Chaque jeu est présenté comme une petite borne d'arcade : fronton rétroéclairé avec le nom,
l'écran du jeu (sa capture) dans son cadre, un panneau de commande avec joystick et bouton
**Jouer**, et une porte à pièces avec le genre et le record. Toute la borne est un lien.

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
- **Jouer** : croix et boutons sous les pouces ; glissements sur l'écran pour Serpent, 2048,
  Croque-Labyrinthe, Traversée et Tetris ; raquette au doigt pour Pong et Casse-Brique ;
  toucher l'écran pour Riposte. Téléphone tourné : disposition console portable.
- L'écran reste allumé pendant une partie, la partie se met en pause si tu changes d'app,
  et un bouton plein écran apparaît quand le navigateur le permet (Android, ordinateur).

## Ambiance d'époque

- **Écran cathodique** (réglable) : lignes de balayage et vignettage sur l'écran de jeu.
- **Initiales** : un score qui entre dans le top 5 se signe de trois lettres, comme sur borne.
- **Musique** (réglable) : petit séquenceur chiptune dans `audio.js` (`SONGS`), joué par les
  bornes qui déclarent `music` dans le catalogue.

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
├── index.html          # shell + header/nav
├── manifest.webmanifest # appli installable
├── sw.js               # cache hors ligne (liste des fichiers à tenir à jour)
├── tools/doom/         # sources et script de compilation du moteur Doom (GPL)
├── css/style.css       # thème, layout, composants
├── img/games/          # une capture d'écran par jeu (vignettes)
├── img/icons/          # icônes de l'appli installée
├── js/
│   ├── app.js          # routeur (hash-based) + rendu des pages
│   ├── catalog.js      # registre des jeux
│   ├── storage.js      # scores & paramètres (localStorage)
│   ├── audio.js        # sons et musique procéduraux (Web Audio API)
│   └── games/
│       ├── pong.js
│       ├── pacman.js
│       ├── tetris.js
│       ├── invaders.js
│       ├── snake.js
│       ├── breakout.js
│       ├── 2048.js
│       └── minesweeper.js
└── README.md
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
4. Ajoute le module et l'image à la liste `FILES` de `sw.js` et change `CACHE` (`-v3`…),
   sinon le jeu ne marchera pas hors ligne. Une entrée manquante (404) fait échouer
   toute l'installation du cache : vérifie que chaque chemin existe.

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

Tout est stocké dans `localStorage` sous le préfixe `arcade:` (scores, thème, volume, dernier jeu joué). Aucune donnée ne quitte le navigateur. « Effacer les données locales » dans les Réglages efface ce préfixe.

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
