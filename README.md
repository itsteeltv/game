# 🎮 Mini Arcade

Plateforme de mini-jeux jouables directement dans le navigateur. 100% statique — HTML/CSS/JS vanilla, aucune dépendance, aucun backend, aucune base de données.

## Les bornes

| Borne | Genre | Encre | Ce qu'elle a de particulier |
|---|---|---|---|
| Pong | Classique | flame `#FF4D1F` | L'angle de renvoi dépend de l'endroit touché sur la raquette ; l'IA se durcit quand tu mènes |
| Croque-Labyrinthe | Arcade | amber `#FFB020` | Labyrinthe généré et « tressé » à chaque niveau, gélules, fantômes apeurés, tunnels latéraux |
| Tetris | Puzzle | jade `#12C98C` | Sac de 7, pièce en garde, délai de verrouillage, DAS/ARR, file de 3, ghost piece |
| Vague Zéro | Action | grape `#9D6BFF` | Abris destructibles, cadence de tir, bonus qui tombent, boss toutes les 4 vagues |
| Serpent | Arcade | lime `#8BE04E` | Virages mis en file (les doubles appuis rapides ne sont plus perdus), bonus chronométré |
| Casse-Brique | Arcade | azure `#4EA8FF` | Briques multi-coups, bonus large/multi-balle/vie, collisions échantillonnées |
| 2048 | Puzzle | rose `#FF5C8A` | Fusion classique, tuiles colorées par valeur |
| Démineur | Puzzle | steel `#9FB0C9` | Mines posées **après** le premier clic : l'ouverture n'est jamais fatale |

Chaque borne porte sa propre couleur d'encre : elle identifie le jeu sur sa carte, sur son
marquee et dans le tableau des scores.

## Parti pris visuel

Sérigraphie sur stratifié noir, pas néon. Les vraies bornes des années 80 sont des aplats
d'encre imprimés — nombre de couleurs limité, contours francs, aucun dégradé. D'où :

- aplats de couleur, jamais de dégradé ni de glassmorphism ;
- une seule source de lumière justifiée : le marquee rétroéclairé, qui déborde sur l'écran ;
- l'écran reste noir dans les deux thèmes — un écran est noir quelle que soit la pièce ;
- `Impact` pour les marquees (chasse étroite de poster), système pour le texte, monospace
  tabulaire pour les scores ;
- l'interlettrage suit la taille : serré sur les gros titres, ouvert sur les petites capitales.

L'élément signature est la borne elle-même : marquee, écran, panneau de contrôle. La page
d'accueil en est une (en mode attraction, l'IA joue contre elle-même), chaque carte du
catalogue en est une en miniature, chaque page de jeu en est une.

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
├── css/style.css       # thème, layout, composants
├── js/
│   ├── app.js          # routeur (hash-based) + rendu des pages
│   ├── catalog.js      # registre des jeux
│   ├── storage.js      # scores & paramètres (localStorage)
│   ├── audio.js        # sons procéduraux (Web Audio API)
│   └── games/
│       ├── pong.js        # + mode attraction (IA vs IA) pour la home
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
- `prefers-reduced-motion` : le mode attraction se fige sur une image au lieu de tourner,
  et les transformations sont neutralisées (interrupteur manuel « Animations » en doublon
  dans les réglages) ;
- `prefers-reduced-transparency` : l'en-tête devient opaque ;
- `prefers-contrast: more` : contours renforcés, scanlines désactivées ;
- les encres ne servent jamais de texte fin sur fond clair — elles y passent en aplat,
  car aucune des quatre n'atteint un contraste suffisant en petit texte sur le stratifié clair.
