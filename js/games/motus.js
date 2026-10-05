// Le Mot — trouve le mot caché en cinq lettres. Vert : bonne lettre, bonne place.
// Orange : la lettre est dans le mot, ailleurs. Comme à la télé, la première lettre
// est donnée. Trois mots par partie.
//
// Mots sans accent uniquement : le clavier de la borne n'en a pas, et la liste sert
// à la fois de solutions et de dictionnaire d'acceptation.
const WORDS = `ABOIS AIDER AIMER ALLER AMOUR ANGLE ARBRE ARGOT ASILE ASSEZ ATOUT AUCUN AUTRE AVION AVOIR
BAGUE BALAI BANAL BANDE BANJO BARBE BARIL BASER BERGE BIAIS BIBLE BICHE BIDON BILAN BILLE BLANC BLEUE
BLOND BOEUF BOIRE BOMBE BONNE BORNE BOUGE BOULE BOXER BRAVE BRAVO BRIDE BRUIT BRUME BRUTE BUTIN
CABAS CACHE CADRE CALME CANAL CANNE CANOT CARTE CAUSE CESSE CHAIR CHAMP CHANT CHAOS CHAUD CHEFS CHIEN
CHOIX CHOSE CHUTE CIBLE CIEUX CITER CIVIL CLAIR CLEFS CLERC CLONE CLOUS COEUR COINS COLLE COLON COMME
COMTE CONTE CORDE CORNE CORPS COUDE COUPE COURS COURT CRABE CRAIE CREUX CRIER CRIME CRISE CROIX CRUEL
CUIRE CYCLE DANSE DENTS DETTE DEUIL DEVIN DIGNE DIVIN DOIGT DONNE DOUTE DOUZE DRAME DRAPS DROIT EFFET
EMAIL ENFIN ENGIN ENNUI ENTRE ESSAI ESSOR EXACT FABLE FAIRE FAITE FARCE FAUNE FAUTE FAUVE FEMME FENTE
FERME FIBRE FICHE FIGUE FILLE FILMS FINAL FINIR FLAIR FLANC FLEUR FLOTS FOIRE FOLIE FORCE FORGE FORME
FORTE FOSSE FOULE FRAIS FREIN FRISE FROID FRUIT FUSIL GAGNE GAINE GALOP GANTS GARDE GAZON GENOU GENRE
GESTE GIFLE GLACE GLAND GLOBE GOMME GORGE GRADE GRAIN GRAND GRAVE GUIDE HACHE HALTE HAUTE HERBE HEURE
HIBOU HIVER HOMME HONTE HUILE INDEX INFOS ISSUE JADIS JAMBE JAUNE JETER JEUNE JOLIE JOUER JOUET JOURS
JUGER JURER JUSTE LACET LAINE LANCE LAPIN LARGE LARME LASSE LAVER LEVER LIBRE LIEUX LIGNE LINGE LIONS
LISTE LITRE LIVRE LOCAL LOGER LOGIS LONGE LOUER LOUPE LOURD LOYAL LUEUR LUNDI LUTTE MAGIE MAGOT MAINS
MAIRE MALIN MANGE MANIE MARDI MARGE MARIN MASSE MATIN MAUVE MENER MENUS MERCI MERDE MESSE MEUTE MILLE
MINCE MINES MISER MIXER MOINE MOINS MONDE MORAL MORSE MOTIF MOTOS MOULE MOYEN MULET MYTHE NAGER NAINS
NAPPE NATAL NAVET NEIGE NERFS NEUVE NIAIS NICHE NOBLE NOCES NOEUD NOIRE NORME NOTER NOUER NOYAU NUAGE
NUQUE OASIS OBJET ODEUR OEUFS OFFRE OISIF OMBRE ONCLE ONDES ONGLE ORAGE ORDRE ORGUE OSIER OTAGE OUBLI
OURSE OUTIL PACTE PALME PANDA PANNE PARIS PARLE PAROI PARTI PASSE PATTE PAUSE PAYER PEAUX PEINE PEINT
PELLE PENDU PENSE PENTE PERCE PERDU PERLE PERTE PESER PESTE PETIT PEURS PHARE PHASE PHOTO PIANO PIEDS
PILON PINCE PIQUE PISTE PLACE PLAGE PLAIE PLANS PLATS PLEIN PLIER PLOMB PLUIE PLUME POCHE POIDS POING
POINT POIRE POMME POMPE PONTS PORTE POSER POSTE POUCE POULE PROIE PROSE PRUNE PUITS PULPE PUNIR QUART
QUEUE RABOT RADAR RADIO RAIDE RAMPE RANGE RATER RAVIN RAYON REBUT REFUS REINE REINS RENTE REPAS REPLI
RHUME RICHE ROBOT ROCHE ROMAN RONDE ROUGE ROUTE RUBAN RUCHE RUINE RURAL SABLE SABRE SACRE SAINE SAINT
SALLE SALON SALUT SAUCE SAULE SAVON SCEAU SEAUX SECTE SEIZE SELLE SELON SEMER SEPIA SERRE SERVI SEUIL
SIGNE SILEX SINGE SIROP SOEUR SOINS SOLDE SOMME SONGE SORTE SORTI SOUCI SOUPE SOURD SPORT STADE STAGE
STYLE STYLO SUAVE SUCRE SUEUR SUITE SUIVI SUJET SUPER TABAC TABLE TACHE TAIRE TALON TAPIS TARIF TASSE
TAUPE TEINT TEMPE TEMPS TENIR TENTE TERME TERRE TEXTE TIERS TIGRE TIRER TISSU TITRE TOILE TOMBE TONNE
TORSE TOTAL TOURS TRACE TRAIN TRAIT TRAME TRIBU TRIER TROIS TRONC TROUS TRUIE TUILE TUYAU UNION USAGE
USINE USURE UTILE VACHE VAGUE VAINE VALET VALSE VANNE VEAUX VEINE VENIR VENTE VENTS VERBE VERRE VERTE
VESTE VEUVE VIDER VIEUX VIGNE VILLA VILLE VINGT VOEUX VOGUE VOILE VOLER VOLET VOTER VOTRE VRAIE WAGON
YACHT ZESTE`.split(/\s+/).filter((w) => w.length === 5);

const ROWS = ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN'];
const C = {
  bg: '#08070A', tile: '#1B1A21', edge: '#3A3844', text: '#F5F5F7', dim: '#9E9AAA',
  right: '#12C98C', near: '#FFB020', absent: '#2A2832', ink: '#FF5C8A',
};

export function createGame(canvas, host, opts = {}) {
  const lvl = opts.difficulty ?? 1;
  const TRIES = [7, 6, 5][lvl];
  const WORDS_PER_RUN = 3;

  const TILE = 44, GAP = 6, TOP = 50, KEY_H = 34, KEY_GAP = 4;
  const boardW = TILE * 5 + GAP * 4;
  const kbW = 10 * 30 + 9 * KEY_GAP;
  canvas.width = Math.max(boardW, kbW) + 24;
  canvas.height = TOP + TRIES * (TILE + GAP) + 18 + 3 * (KEY_H + KEY_GAP) + 10;
  const ctx = canvas.getContext('2d');
  const KEY_W = Math.floor((canvas.width - 24 - 9 * KEY_GAP) / 10);

  let answer, guesses, current, round, total, message, msgT, shake, letters, done, win;
  let paused = false, running = false, rafId = null, last = 0, alive = true;

  const pick = () => WORDS[(Math.random() * WORDS.length) | 0];

  /** Motus scoring, two passes: placed letters first, so a doubled letter cannot
      be reported twice when the answer holds only one. */
  function mark(guess) {
    const out = new Array(5).fill('absent');
    const pool = {};
    for (let i = 0; i < 5; i++) if (guess[i] !== answer[i]) pool[answer[i]] = (pool[answer[i]] || 0) + 1;
    for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) out[i] = 'right';
    for (let i = 0; i < 5; i++) {
      if (out[i] === 'right') continue;
      if (pool[guess[i]] > 0) { out[i] = 'near'; pool[guess[i]]--; }
    }
    return out;
  }

  const RANK = { absent: 0, near: 1, right: 2 };
  function remember(guess, marks) {
    for (let i = 0; i < 5; i++) {
      const prev = letters[guess[i]];
      if (!prev || RANK[marks[i]] > RANK[prev]) letters[guess[i]] = marks[i];
    }
  }

  function newWord() {
    answer = pick();
    guesses = [];
    current = answer[0];        // the first letter is given, as on the show
    letters = {};
    message = '';
  }

  function say(m) { message = m; msgT = 0; }

  function submit() {
    if (done || paused || !running) return;
    if (current.length < 5) { say('Il manque des lettres'); shake = 1; host.sfx.hit(); return; }
    if (!WORDS.includes(current)) { say(`${current} : mot inconnu`); shake = 1; host.sfx.hit(); return; }
    if (current[0] !== answer[0]) { say(`Commence par ${answer[0]}`); shake = 1; host.sfx.hit(); return; }
    const marks = mark(current);
    guesses.push({ word: current, marks });
    remember(current, marks);
    const solved = current === answer;
    current = answer[0];
    if (solved) {
      const left = TRIES - guesses.length;
      const gain = 400 + left * 150 + lvl * 100;
      total += gain;
      host.sfx.win();
      say(`Trouvé ! +${gain}`);
      nextRound(true);
    } else if (guesses.length >= TRIES) {
      host.sfx.gameover();
      say(`C'était ${answer}`);
      nextRound(false);
    } else {
      host.sfx.score();
    }
    report();
  }

  function nextRound(ok) {
    if (round + 1 >= WORDS_PER_RUN) {
      done = true; win = ok && total > 0;
      running = false;
      draw();
      // a beat on the last word before the end screen
      setTimeout(() => { if (alive) host.onGameOver(total, total >= WORDS_PER_RUN * 500); }, 900);
      return;
    }
    setTimeout(() => {
      if (!alive || !running) return;
      round++;
      newWord();
      report();
    }, 1100);
  }

  function report() {
    host.onStats({ score: total, level: round + 1, lives: Math.max(0, TRIES - guesses.length) });
  }

  function type(ch) {
    if (done || paused || !running) return;
    if (current.length >= 5) return;
    current += ch;
    host.sfx.move();
  }

  function back() {
    if (done || paused || !running) return;
    if (current.length > 1) current = current.slice(0, -1);   // the given first letter stays
  }

  /* --- drawing ----------------------------------------------------------- */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const fill = (state) => (state === 'right' ? C.right : state === 'near' ? C.near : C.absent);

  function draw() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textBaseline = 'middle';
    ctx.font = '600 13px ui-monospace, Consolas, monospace';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'left';
    ctx.fillText(`MOT ${round + 1}/${WORDS_PER_RUN}`, 12, 16);
    ctx.textAlign = 'right';
    ctx.fillText(`ESSAIS ${Math.max(0, TRIES - guesses.length)}`, canvas.width - 12, 16);

    if (message) {
      ctx.textAlign = 'center';
      ctx.fillStyle = /Trouv/.test(message) ? C.right : C.ink;
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(message, canvas.width / 2, 36);
    }

    const x0 = (canvas.width - boardW) / 2;
    const jitter = shake > 0 ? Math.sin(shake * 28) * 6 * shake : 0;

    for (let r = 0; r < TRIES; r++) {
      const y = TOP + r * (TILE + GAP);
      const g = guesses[r];
      const typing = r === guesses.length && !done;
      for (let i = 0; i < 5; i++) {
        const x = x0 + i * (TILE + GAP) + (typing ? jitter : 0);
        if (g) {
          ctx.fillStyle = fill(g.marks[i]);
          roundRect(x, y, TILE, TILE, 8);
          ctx.fill();
        } else {
          ctx.fillStyle = C.tile;
          roundRect(x, y, TILE, TILE, 8);
          ctx.fill();
          ctx.strokeStyle = typing && i === current.length ? C.ink : C.edge;
          ctx.lineWidth = typing && i === current.length ? 2.5 : 1.5;
          roundRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1, 8);
          ctx.stroke();
        }
        const ch = g ? g.word[i] : (typing ? current[i] : '');
        if (ch) {
          ctx.fillStyle = g && g.marks[i] !== 'absent' ? '#0A0A0C' : C.text;
          ctx.font = '700 22px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(ch, x + TILE / 2, y + TILE / 2 + 1);
        }
      }
    }

    // keyboard
    const kbY = TOP + TRIES * (TILE + GAP) + 14;
    ROWS.forEach((row, ri) => {
      const w = row.length * KEY_W + (row.length - 1) * KEY_GAP + (ri === 2 ? 2 * (KEY_W + KEY_GAP) : 0);
      let x = (canvas.width - w) / 2;
      const y = kbY + ri * (KEY_H + KEY_GAP);
      const keys = ri === 2 ? ['⌫', ...row, '⏎'] : [...row];
      for (const k of keys) {
        const kw = KEY_W;
        const st = letters[k];
        ctx.fillStyle = st ? fill(st) : '#232130';
        roundRect(x, y, kw, KEY_H, 6);
        ctx.fill();
        ctx.fillStyle = st && st !== 'absent' ? '#0A0A0C' : C.text;
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(k, x + kw / 2, y + KEY_H / 2 + 1);
        x += kw + KEY_GAP;
      }
    });

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /** Which key is under this point, if any. */
  function keyAt(px, py) {
    const kbY = TOP + TRIES * (TILE + GAP) + 14;
    for (let ri = 0; ri < 3; ri++) {
      const row = ROWS[ri];
      const keys = ri === 2 ? ['⌫', ...row, '⏎'] : [...row];
      const w = keys.length * KEY_W + (keys.length - 1) * KEY_GAP;
      let x = (canvas.width - w) / 2;
      const y = kbY + ri * (KEY_H + KEY_GAP);
      if (py < y || py > y + KEY_H) { continue; }
      for (const k of keys) {
        if (px >= x && px <= x + KEY_W) return k;
        x += KEY_W + KEY_GAP;
      }
    }
    return null;
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(64, last ? t - last : 16);
    last = t;
    if (!paused) {
      if (shake > 0) shake = Math.max(0, shake - dt / 260);
      if (message) { msgT += dt; if (msgT > 2600) message = ''; }
      draw();
    }
    rafId = requestAnimationFrame(loop);
  }

  const onDown = (e) => {
    e.preventDefault();
    const b = canvas.getBoundingClientRect();
    const k = keyAt((e.clientX - b.left) * (canvas.width / b.width), (e.clientY - b.top) * (canvas.height / b.height));
    if (!k) return;
    if (k === '⌫') back();
    else if (k === '⏎') submit();
    else type(k);
  };

  // This borne reads the keyboard itself: letters have to reach the grid, not the page.
  // But a control the player reached with Tab keeps its own keys — Entrée on the
  // « Bornes » link must leave the borne, not validate a word.
  const onKey = (e) => {
    const a = document.activeElement;
    if (a && a !== document.body && a.tagName !== 'CANVAS') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
    if (e.key === 'Escape') return;            // the page keeps Escape for the pause
    const ch = e.key.toUpperCase();
    if (/^[A-Z]$/.test(ch)) { e.preventDefault(); type(ch); }
  };

  return {
    ownsKeyboard: true,
    start() {
      round = 0; total = 0; done = false; win = false; shake = 0; msgT = 0;
      paused = false; running = true; last = 0;
      newWord();
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
      report();
      draw();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    },
    togglePause() { paused = !paused; return paused; },
    setPaused(v) { paused = v; return paused; },
    input(a, down) {
      if (!down) return;
      if (a === 'action') submit();
      else if (a === 'hold') back();
    },
    destroy() {
      running = false; alive = false;   // a pending round/end timer must not outlive the page
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    },
  };
}
