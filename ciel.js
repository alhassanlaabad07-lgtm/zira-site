/*
  ciel.js — le ciel de l'heure, calculé dans la page (2026-10-11).

  La page n'a plus de captures d'écran : elle MONTRE le ciel. Ce fichier
  calcule, avec astronomy-engine (MIT, la bibliothèque de l'app), où sont le
  Soleil, la Lune et les planètes en ce moment le long du zodiaque, vus de la
  Terre, puis dessine l'instrument et remplit le relevé et l'almanach.

  MÊMES CONVENTIONS QUE L'APP (zira-v4-app/src/engine/liveSky.js) : positions
  géocentriques, écliptique de la date, zodiaque tropical, Bélier = 0°. Une
  planète est rétrograde quand sa longitude recule sur 24 h centrées sur
  l'instant. Ne rien inventer ici qui s'en écarte : la page promet « la même
  bibliothèque que l'app ».

  CE QUE LA PAGE NE DIT PAS, exprès : lever, coucher, « au-dessus de
  l'horizon », crépuscules. Tout cela dépend du lieu du visiteur, que la page
  ne connaît pas et ne demande pas. Les éclipses sont annoncées « quelque part
  sur Terre », jamais « visible chez vous ».

  Le calcul (ZiraCiel.etat, .evenements) ne touche pas au DOM : il se teste
  avec node. Le dessin vit plus bas et ne démarre que dans un navigateur.
*/
(function (racine) {
  'use strict';

  // De la Terre vers l'extérieur, dans l'ordre des sphères de l'ancien modèle ;
  // puis les trois astres que la lunette et le calcul ont ajoutés.
  var CORPS = ['Moon', 'Mercury', 'Venus', 'Sun', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  var SIGNES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  var ABREGES = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];
  var PHASES = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  var DEMI_JOUR_MS = 43200000;
  // La phase avance d'environ 12,19° par jour : à moins de 12 h d'une phase
  // principale, on la nomme ; sinon on nomme l'intervalle.
  var DEMI_JOUR_DE_PHASE = 6.1;

  function norm360(x) {
    x = x % 360;
    return x < 0 ? x + 360 : x;
  }

  function longitude(A, nom, date) {
    if (nom === 'Sun') return norm360(A.SunPosition(date).elon);
    if (nom === 'Moon') return norm360(A.EclipticGeoMoon(date).lon);
    return norm360(A.Ecliptic(A.GeoVector(nom, date, true)).elon);
  }

  function retrograde(A, nom, date) {
    if (nom === 'Sun' || nom === 'Moon') return false;
    var d = longitude(A, nom, new Date(date.getTime() + DEMI_JOUR_MS))
      - longitude(A, nom, new Date(date.getTime() - DEMI_JOUR_MS));
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d < 0;
  }

  function nomDePhase(angle) {
    var quart = Math.round(angle / 90) % 4;
    var ecart = Math.abs(angle - Math.round(angle / 90) * 90);
    if (ecart <= DEMI_JOUR_DE_PHASE) return PHASES[quart * 2];
    return PHASES[(Math.floor(angle / 90) % 4) * 2 + 1];
  }

  /** Les positions de l'instant : rapide, refait à chaque minute et à chaque cran du curseur. */
  function etat(A, date) {
    var corps = CORPS.map(function (nom) {
      var lon = longitude(A, nom, date);
      var dansLeSigne = lon % 30;
      return {
        nom: nom,
        lon: lon,
        signe: Math.floor(lon / 30) % 12,
        degre: Math.floor(dansLeSigne),
        minute: Math.floor((dansLeSigne % 1) * 60),
        retro: retrograde(A, nom, date),
      };
    });
    var angle = A.MoonPhase(date);
    return {
      date: date,
      corps: corps,
      lune: {
        angle: angle,
        eclairee: A.Illumination('Moon', date).phase_fraction,
        phase: nomDePhase(angle),
        croissante: angle < 180,
      },
    };
  }

  /** Les prochains rendez-vous : des recherches plus lourdes, une fois par chargement. */
  function evenements(A, date) {
    var lunaire = A.SearchLunarEclipse(date);
    var solaire = A.SearchGlobalSolarEclipse(date);
    return {
      nouvelleLune: A.SearchMoonPhase(0, date, 40).date,
      pleineLune: A.SearchMoonPhase(180, date, 40).date,
      eclipseLunaire: { date: lunaire.peak.date, genre: lunaire.kind },
      eclipseSolaire: { date: solaire.peak.date, genre: solaire.kind },
    };
  }

  racine.ZiraCiel = {
    CORPS: CORPS, SIGNES: SIGNES, ABREGES: ABREGES, PHASES: PHASES,
    norm360: norm360, etat: etat, evenements: evenements,
  };

  if (typeof document === 'undefined') return; // node : le calcul seul

  /* ───────────────────────── LE DESSIN ─────────────────────────
     Une plaque d'instrument : la Terre au centre, une sphère par astre dans
     l'ordre de l'ancien modèle, la bande du zodiaque au bord. Le Bélier est à
     gauche et les signes tournent dans le sens inverse des aiguilles, comme
     sur une carte du ciel. Les signes et les astres sont écrits en LETTRES :
     les glyphes Unicode deviennent des émojis de couleur sur les téléphones. */

  var NS = 'http://www.w3.org/2000/svg';
  var C = 320;                       // centre du viewBox 640 × 640
  var BANDE_INT = 268, BANDE_EXT = 306;
  var RAYONS = { Moon: 44, Mercury: 68, Venus: 92, Sun: 116, Mars: 140, Jupiter: 166, Saturn: 192, Uranus: 216, Neptune: 236, Pluto: 254 };
  var ASPECT = {
    Moon: { r: 6, c: '#E9EEF8' }, Mercury: { r: 3.6, c: '#B9B4AA' }, Venus: { r: 4.8, c: '#EADBB0' },
    Sun: { r: 8.5, c: '#F2C94C' }, Mars: { r: 4.2, c: '#E0704F' }, Jupiter: { r: 6.6, c: '#D9B48A' },
    Saturn: { r: 5.4, c: '#DCC79A' }, Uranus: { r: 4.2, c: '#9FD8E0' }, Neptune: { r: 4.2, c: '#6F8FE8' },
    Pluto: { r: 3, c: '#B7A6A0' },
  };
  var MODERNES = { Uranus: 1, Neptune: 1, Pluto: 1 };

  function el(nom, attrs, texte) {
    var e = document.createElementNS(NS, nom);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (texte != null) e.textContent = texte;
    return e;
  }

  /** Longitude écliptique → point de la plaque. */
  function point(r, lon) {
    var phi = (180 + lon) * Math.PI / 180;
    return [C + r * Math.cos(phi), C - r * Math.sin(phi)];
  }

  function f(x) { return x.toFixed(2); }

  /** Un arc de cercle qui se lit de gauche à droite, pour y coucher un texte. */
  function arcLisible(r, lonCentre, demiLargeur) {
    var enHaut = Math.sin((180 + lonCentre) * Math.PI / 180) > 0;
    var a = point(r, lonCentre + (enHaut ? demiLargeur : -demiLargeur));
    var b = point(r, lonCentre + (enHaut ? -demiLargeur : demiLargeur));
    return 'M' + f(a[0]) + ' ' + f(a[1]) + 'A' + r + ' ' + r + ' 0 0 ' + (enHaut ? 1 : 0) + ' ' + f(b[0]) + ' ' + f(b[1]);
  }

  function texteSurArc(id, classe, texte, rHaut, rBas, lonCentre, demiLargeur) {
    var enHaut = Math.sin((180 + lonCentre) * Math.PI / 180) > 0;
    var g = el('g', {});
    g.appendChild(el('path', { id: id, d: arcLisible(enHaut ? rHaut : rBas, lonCentre, demiLargeur), fill: 'none' }));
    var t = el('text', { 'class': classe });
    var tp = el('textPath', { href: '#' + id, startOffset: '50%', 'text-anchor': 'middle' }, texte);
    t.appendChild(tp);
    g.appendChild(t);
    return g;
  }

  function Instrument(svg) {
    this.svg = svg;
    this.astres = {};
    this.noms = {};
    this.nomEnHaut = {};
    this.etroit = null;
    this.signes = null;
    this.construire();
  }

  Instrument.prototype.construire = function () {
    var svg = this.svg, i, lon, a, b;
    while (svg.lastChild && svg.lastChild.nodeName !== 'desc' && svg.lastChild.nodeName !== 'title') svg.removeChild(svg.lastChild);

    var defs = el('defs', {});
    var terre = el('radialGradient', { id: 'i-terre', cx: '38%', cy: '34%', r: '75%' });
    terre.appendChild(el('stop', { offset: '0', 'stop-color': '#5FA8F5' }));
    terre.appendChild(el('stop', { offset: '.55', 'stop-color': '#1B57B8' }));
    terre.appendChild(el('stop', { offset: '1', 'stop-color': '#0A2A66' }));
    defs.appendChild(terre);
    svg.appendChild(defs);

    var plaque = el('g', { 'class': 'i-plaque' });
    // les sphères
    ZiraCiel.CORPS.forEach(function (nom) {
      plaque.appendChild(el('circle', { cx: C, cy: C, r: RAYONS[nom], 'class': 'i-orbe' + (MODERNES[nom] ? ' tard' : '') }));
    });
    // la bande du zodiaque
    plaque.appendChild(el('circle', { cx: C, cy: C, r: BANDE_INT, 'class': 'i-bande' }));
    plaque.appendChild(el('circle', { cx: C, cy: C, r: BANDE_EXT, 'class': 'i-bande' }));
    for (lon = 0; lon < 360; lon += 5) {
      var long = lon % 30 === 0, moyen = lon % 10 === 0;
      a = point(BANDE_INT, lon);
      b = point(long ? BANDE_EXT : BANDE_INT + (moyen ? 8 : 4), lon);
      plaque.appendChild(el('line', { x1: f(a[0]), y1: f(a[1]), x2: f(b[0]), y2: f(b[1]), 'class': long ? 'i-div' : 'i-tic' }));
    }
    svg.appendChild(plaque);

    this.signes = el('g', { 'class': 'i-signes' });
    svg.appendChild(this.signes);

    // les noms gravés sur chaque sphère
    var noms = el('g', { 'class': 'i-noms' });
    for (i = 0; i < ZiraCiel.CORPS.length; i++) {
      var nom = ZiraCiel.CORPS[i];
      var g = el('g', {});
      this.noms[nom] = g;
      noms.appendChild(g);
    }
    svg.appendChild(noms);

    // la Terre
    var centre = el('g', {});
    centre.appendChild(el('circle', { cx: C, cy: C, r: 13, fill: 'url(#i-terre)' }));
    centre.appendChild(el('circle', { cx: C, cy: C, r: 13, 'class': 'i-terre-bord' }));
    centre.appendChild(el('text', { x: C, y: C + 27, 'class': 'i-nom i-centre', 'text-anchor': 'middle' }, 'EARTH'));
    svg.appendChild(centre);

    // les astres : un rayon vers la bande, un halo, le disque, la marque de rétrogradation
    var couche = el('g', { 'class': 'i-astres' });
    for (i = 0; i < ZiraCiel.CORPS.length; i++) {
      var n = ZiraCiel.CORPS[i], asp = ASPECT[n];
      var ga = el('g', { 'class': 'astre', 'data-nom': n });
      var rayon = el('line', { 'class': 'i-rayon' });
      var corps = el('g', {});
      corps.appendChild(el('circle', { r: asp.r + 6, 'class': 'i-halo' }));
      if (n === 'Sun') corps.appendChild(el('circle', { r: asp.r + 5, fill: asp.c, opacity: '.2' }));
      if (n === 'Saturn') corps.appendChild(el('ellipse', { rx: asp.r + 4.5, ry: 2.6, fill: 'none', stroke: asp.c, 'stroke-width': '1.1', transform: 'rotate(-18)' }));
      corps.appendChild(el('circle', { r: asp.r, fill: asp.c }));
      var retro = el('text', { 'class': 'i-retro', x: asp.r + 4, y: -asp.r - 1 }, 'R');
      corps.appendChild(retro);
      ga.appendChild(rayon);
      ga.appendChild(corps);
      couche.appendChild(ga);
      this.astres[n] = { g: ga, rayon: rayon, corps: corps, retro: retro };
    }
    svg.appendChild(couche);
    this.ajuster();
  };

  /** Sur un petit écran : des abréviations plus grosses, et plus de noms sur les sphères. */
  Instrument.prototype.ajuster = function () {
    var largeur = this.svg.getBoundingClientRect().width || 600;
    var etroit = largeur < 470;
    if (etroit === this.etroit) return;
    this.etroit = etroit;
    this.svg.classList.toggle('etroit', etroit);
    while (this.signes.firstChild) this.signes.removeChild(this.signes.firstChild);
    for (var i = 0; i < 12; i++) {
      var texte = (etroit ? ZiraCiel.ABREGES[i] : ZiraCiel.SIGNES[i]).toUpperCase();
      this.signes.appendChild(texteSurArc('i-s' + i, 'i-signe', texte,
        etroit ? 279.5 : 282.5, etroit ? 295 : 291.5, i * 30 + 15, 14));
    }
    this.nomEnHaut = {};
  };

  Instrument.prototype.placer = function (e) {
    for (var i = 0; i < e.corps.length; i++) {
      var c = e.corps[i], a = this.astres[c.nom], r = RAYONS[c.nom];
      var p = point(r, c.lon), q = point(BANDE_INT, c.lon);
      a.corps.setAttribute('transform', 'translate(' + f(p[0]) + ' ' + f(p[1]) + ')');
      a.rayon.setAttribute('x1', f(p[0])); a.rayon.setAttribute('y1', f(p[1]));
      a.rayon.setAttribute('x2', f(q[0])); a.rayon.setAttribute('y2', f(q[1]));
      a.retro.style.display = c.retro ? '' : 'none';
      // Le nom de la sphère se grave en haut ; si l'astre passe dessous, il descend en bas.
      var phi = norm360(180 + c.lon);
      var presDuHaut = Math.abs(phi - 90) < 32;
      if (this.nomEnHaut[c.nom] !== !presDuHaut) {
        this.nomEnHaut[c.nom] = !presDuHaut;
        var g = this.noms[c.nom];
        while (g.firstChild) g.removeChild(g.firstChild);
        g.appendChild(texteSurArc('i-n' + i, 'i-nom', c.nom.toUpperCase(), r + 3.5, r - 3.5, presDuHaut ? 90 : 270, 40));
      }
    }
  };

  Instrument.prototype.activer = function (nom) {
    for (var n in this.astres) this.astres[n].g.classList.toggle('actif', n === nom);
  };

  /* ───────────────────────── LA PAGE ───────────────────────── */

  var PAS_HEURES = 6;                // un cran du curseur
  function $(id) { return document.getElementById(id); }

  function dateLongue(d) {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }
  function heureLocale(d) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function heureUTC(d) {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d);
  }
  function rendezVous(d) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  /** La Lune dessinée : le limbe éclairé à droite quand elle croît (vue de l'hémisphère nord). */
  function cheminDePhase(r, eclairee) {
    var k = Math.max(0.001, Math.min(0.999, eclairee));
    var rx = (r * Math.abs(1 - 2 * k)).toFixed(2);
    return 'M0 ' + (-r) + 'A' + r + ' ' + r + ' 0 0 1 0 ' + r + 'A' + rx + ' ' + r + ' 0 0 ' + (k < 0.5 ? 0 : 1) + ' 0 ' + (-r) + 'Z';
  }

  function demarrer() {
    var A = racine.Astronomy, svg = $('ciel-svg');
    if (!A || !svg) return;
    var instrument = new Instrument(svg);
    var curseur = $('ciel-temps'), sortie = $('ciel-quand'), retour = $('ciel-maintenant');
    var corpsTable = $('ciel-releve'), desc = $('ciel-desc'), titreReleve = $('ciel-releve-titre');
    var lignes = {};

    ZiraCiel.CORPS.forEach(function (nom) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-nom', nom);
      tr.innerHTML = '<th scope="row"><span class="pastille" style="background:' + ASPECT[nom].c + '"></span>' + nom + '</th><td></td><td class="chiffres"></td><td></td>';
      var surligner = function () { instrument.activer(nom); for (var n in lignes) lignes[n].classList.toggle('actif', n === nom); };
      // Un confort de lecture, pas une information : tout est déjà dans le tableau.
      tr.addEventListener('pointerenter', surligner);
      tr.addEventListener('click', surligner);
      lignes[nom] = tr;
    });
    // Le relevé se lit du Soleil et de la Lune vers les planètes lentes.
    corpsTable.textContent = '';
    ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].forEach(function (nom) {
      corpsTable.appendChild(lignes[nom]);
    });

    function afficher(decalageCrans) {
      var maintenant = new Date();
      var date = new Date(maintenant.getTime() + decalageCrans * PAS_HEURES * 3600000);
      var e = ZiraCiel.etat(A, date);
      instrument.placer(e);
      var phrases = [];
      e.corps.forEach(function (c) {
        var td = lignes[c.nom].children;
        td[1].textContent = ZiraCiel.SIGNES[c.signe];
        td[2].textContent = c.degre + '°' + (c.minute < 10 ? '0' : '') + c.minute + '′';
        td[3].textContent = (c.nom === 'Sun' || c.nom === 'Moon') ? '—' : (c.retro ? 'retrograde' : 'direct');
        td[3].className = c.retro ? 'retro' : '';
        phrases.push(c.nom + ' in ' + ZiraCiel.SIGNES[c.signe] + ' ' + c.degre + '°' + (c.retro ? ' (retrograde)' : ''));
      });
      desc.textContent = 'Earth at the centre. ' + phrases.join('; ') + '.';
      if (decalageCrans === 0) {
        sortie.textContent = dateLongue(date) + ' · ' + heureLocale(date) + ' your time · ' + heureUTC(date) + ' UTC';
        titreReleve.textContent = 'right now';
      } else {
        var heures = Math.abs(decalageCrans) * PAS_HEURES;
        var ecart = heures < 24 ? heures + ' hours'
          : (heures % 24 === 0 ? heures / 24 : (heures / 24).toFixed(1)) + (heures === 24 ? ' day' : ' days');
        sortie.textContent = dateLongue(date) + ' · ' + ecart + (decalageCrans > 0 ? ' from now' : ' ago');
        titreReleve.textContent = 'on ' + dateLongue(date);
      }
      retour.hidden = decalageCrans === 0;
      curseur.setAttribute('aria-valuetext', sortie.textContent);
      return e;
    }

    var e0 = afficher(0);

    // La Lune et les rendez-vous : toujours à partir de l'instant réel.
    $('lune-phase').textContent = e0.lune.phase;
    $('lune-eclairee').textContent = Math.round(e0.lune.eclairee * 100) + '% lit';
    var disque = $('lune-dessin');
    if (disque) {
      disque.setAttribute('d', cheminDePhase(15, e0.lune.eclairee));
      disque.setAttribute('transform', 'translate(20 20)' + (e0.lune.croissante ? '' : ' scale(-1 1)'));
    }
    var genres = { penumbral: 'Penumbral', partial: 'Partial', annular: 'Annular', total: 'Total' };
    setTimeout(function () {
      var ev = ZiraCiel.evenements(A, new Date());
      $('ev-nouvelle').textContent = rendezVous(ev.nouvelleLune);
      $('ev-pleine').textContent = rendezVous(ev.pleineLune);
      $('ev-lunaire').textContent = rendezVous(ev.eclipseLunaire.date);
      $('ev-lunaire-genre').textContent = genres[ev.eclipseLunaire.genre] ? genres[ev.eclipseLunaire.genre] + '.' : '';
      $('ev-solaire').textContent = rendezVous(ev.eclipseSolaire.date);
      $('ev-solaire-genre').textContent = genres[ev.eclipseSolaire.genre] ? genres[ev.eclipseSolaire.genre] + '.' : '';
    }, 0);

    curseur.addEventListener('input', function () { afficher(parseInt(curseur.value, 10)); });
    retour.addEventListener('click', function () { curseur.value = 0; afficher(0); curseur.focus(); });
    setInterval(function () { if (parseInt(curseur.value, 10) === 0) afficher(0); }, 60000);

    var attente = null;
    addEventListener('resize', function () {
      clearTimeout(attente);
      attente = setTimeout(function () { instrument.ajuster(); afficher(parseInt(curseur.value, 10)); }, 150);
    }, { passive: true });

    document.documentElement.classList.add('ciel-vivant');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})(typeof window !== 'undefined' ? window : globalThis);
