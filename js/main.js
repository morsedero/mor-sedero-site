// ---------- showreel thumbnails: pulled live from YouTube (img.youtube.com)
// instead of a local file, so updating the video's thumbnail on YouTube
// updates the site automatically. maxresdefault.jpg doesn't 404 when a video
// has no high-res thumbnail — it silently serves a 120x90 grey placeholder
// instead — so fall back to hqdefault.jpg (always exists) when that's detected. ----------
(function youtubeThumbFallback(){
  document.querySelectorAll('img.yt-thumb').forEach(img => {
    img.addEventListener('load', () => {
      if(img.naturalWidth === 120 && img.naturalHeight === 90){
        img.src = `https://img.youtube.com/vi/${img.dataset.ytId}/hqdefault.jpg`;
      }
    });
  });
})();

// ---------- logo mark: flat 2D image, but the pupils in its eye sockets
// track the cursor anywhere on the page (small, clamped drift — the sockets
// are tiny) ----------
(function eyesFollowCursor(){
  const mark = document.querySelector('.site-logo-mark');
  const pupils = Array.from(document.querySelectorAll('.site-logo-pupil'));
  const crack = mark && mark.querySelector('.site-logo-crack');
  if(!mark || !pupils.length) return;
  const MAX_OFFSET = 2; // px the pupil can drift off-center within its socket

  // Eye socket outline traced from the logo PNG's alpha cutout (image-space px,
  // origin at the socket's own center) — a vertically-elongated hexagon, pointed
  // top/bottom with flat vertical sides. Source image is 500x476.
  const EYE_HEX_VERTS = [[0,-50],[42.5,-24.5],[42.5,24.5],[0,50],[-42.5,24.5],[-42.5,-24.5]];
  const EYE_IMG_W = 500, EYE_IMG_H = 476;

  // Max distance from the socket center to its hexagon boundary along `angle`,
  // scaled to the mark's live rendered size — keeps the click-shake jitter from
  // throwing the pupil outside its socket instead of just clamping to a circle.
  function eyeHexRadius(angle, markWidth, markHeight){
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const sx = markWidth / EYE_IMG_W, sy = markHeight / EYE_IMG_H;
    for(let i = 0; i < EYE_HEX_VERTS.length; i++){
      const [ax0, ay0] = EYE_HEX_VERTS[i];
      const [bx0, by0] = EYE_HEX_VERTS[(i + 1) % EYE_HEX_VERTS.length];
      const ax = ax0 * sx, ay = ay0 * sy;
      const ex = bx0 * sx - ax, ey = by0 * sy - ay;
      const det = ex * dy - ey * dx;
      if(Math.abs(det) < 1e-6) continue;
      const t = (ex * ay - ey * ax) / det;
      const s = (dx * ay - dy * ax) / det;
      if(t > 0 && s >= 0 && s <= 1) return t;
    }
    return MAX_OFFSET; // shouldn't be reached — safe fallback
  }

  // base position within the mark, set once — the actual per-frame screen
  // center is recomputed from this + the mark's live rect, never from the
  // pupil's own (already-offset) rect, so the drift doesn't drift itself
  pupils.forEach(p => {
    p.style.left = `${parseFloat(p.dataset.cx) * 100}%`;
    p.style.top = `${parseFloat(p.dataset.cy) * 100}%`;
  });

  let lastX = window.innerWidth / 2;
  let lastY = window.innerHeight / 2;
  let shaking = false; // true while a click's jitter burst owns the pupils
  let shakeToken = 0; // bumped on every click so stale timeouts from a superseded shake bail out
  let pendingTimeouts = [];
  // The shatter (below) runs on its OWN token/timer list, separate from the
  // shake's — every click retriggers the shake, but a shatter in progress
  // should play out its full fly/hold/return course undisturbed by those
  // ordinary clicks, only re-targeting when another full break happens.
  let shatterToken = 0;
  let shatterTimeouts = [];

  function clearPendingShake(){
    pendingTimeouts.forEach(id => clearTimeout(id));
    pendingTimeouts = [];
  }

  function clearPendingShatter(){
    shatterTimeouts.forEach(id => clearTimeout(id));
    shatterTimeouts = [];
  }

  function trackPupils(x, y){
    const rect = mark.getBoundingClientRect();
    pupils.forEach(p => {
      const cx = rect.left + rect.width * parseFloat(p.dataset.cx);
      const cy = rect.top + rect.height * parseFloat(p.dataset.cy);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const offset = Math.min(MAX_OFFSET, dist * 0.12);
      p.style.setProperty('--pupil-x', `${(dx / dist * offset).toFixed(1)}px`);
      p.style.setProperty('--pupil-y', `${(dy / dist * offset).toFixed(1)}px`);
    });
  }

  window.addEventListener('mousemove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if(shaking) return; // the jitter/settle sequence owns the pupils until it finishes
    trackPupils(lastX, lastY);
  }, { passive: true });

  // Click: shake the mark and jolt the pupils around wildly, then let them
  // ease back into normal cursor-tracking rather than snapping straight there.
  // A fresh click cancels whatever the previous click was still doing instead
  // of waiting it out, so rapid re-clicks keep retriggering the shake.
  const STEP_MS = 65; // fixed cadence for every oscillation step — never scaled, so speed always reads the same
  const BASE_STEPS = 7; // step count at strength 1x
  const BASE_HEAD_AMP = 6; // px/deg at strength 1x, step 0
  const HEX_MARGIN = 0.85; // stay a little short of the socket's true edge

  function runShake(strength, token){
    pupils.forEach(p => p.classList.remove('settling')); // stop any in-progress ease so the new jitter snaps instantly
    shaking = true;

    const steps = Math.max(4, Math.round(BASE_STEPS * strength));
    const settleMs = 600;
    pupils.forEach(p => p.style.setProperty('--pupil-settle-duration', `${settleMs}ms`));
    mark.classList.add('shaking');

    for(let i = 0; i <= steps; i++){
      pendingTimeouts.push(setTimeout(() => {
        if(token !== shakeToken) return;
        const amp = i === steps ? 0 : (1 - i / steps) * strength; // linear decay to exactly 0 on the final step
        const sign = i % 2 === 0 ? -1 : 1;

        const headMag = BASE_HEAD_AMP * amp * sign;
        mark.style.setProperty('--shake-x', `${headMag.toFixed(1)}px`);
        mark.style.setProperty('--shake-rot', `${headMag.toFixed(1)}deg`);

        const rect = mark.getBoundingClientRect();
        pupils.forEach(p => {
          const angle = Math.random() * Math.PI * 2;
          const maxR = eyeHexRadius(angle, rect.width, rect.height) * HEX_MARGIN;
          const mag = Math.min(maxR, maxR * amp); // clamped — strength varies reach, never breaches the socket
          p.style.setProperty('--pupil-x', `${(Math.cos(angle) * mag).toFixed(1)}px`);
          p.style.setProperty('--pupil-y', `${(Math.sin(angle) * mag).toFixed(1)}px`);
        });
      }, i * STEP_MS));
    }

    pendingTimeouts.push(setTimeout(() => {
      if(token !== shakeToken) return;
      pupils.forEach(p => {
        p.classList.add('settling');
        void p.offsetWidth; // force a style flush so the transition catches the next value change instead of snapping
      });
      trackPupils(lastX, lastY);
      pendingTimeouts.push(setTimeout(() => {
        if(token !== shakeToken) return;
        pupils.forEach(p => p.classList.remove('settling'));
        mark.classList.remove('shaking');
        shaking = false;
      }, settleMs + 50));
    }, (steps + 1) * STEP_MS));
  }

  // Shatter: splits the mark into 8 pre-clipped wedges (see CSS — each is a
  // full copy of the artwork, clipped to one slice, that reconstructs the
  // whole image when at rest), flings them to random offsets, holds a beat
  // scattered, then eases them back before handing off to the plain image again.
  const shards = Array.from(mark.querySelectorAll('.site-logo-shard'));
  const FLY_MS = 240;
  const HOLD_MS = 380;
  const RETURN_MS = 420;

  // Eases the shards back to identity at the natural end of the hold, then
  // schedules the eventual handoff back to the plain image.
  function beginShatterReturn(token){
    shards.forEach(s => {
      s.classList.remove('flying');
      s.classList.add('returning');
    });
    void mark.getBoundingClientRect(); // reflow so the (slower) return transition is registered before the values below retarget it
    shards.forEach(s => {
      s.style.setProperty('--shard-dx', '0px');
      s.style.setProperty('--shard-dy', '0px');
      s.style.setProperty('--shard-rot', '0deg');
      s.style.setProperty('--shard-op', '1');
    });

    shatterTimeouts.push(setTimeout(() => {
      if(token !== shatterToken) return;
      shards.forEach(s => s.classList.remove('returning'));
      mark.classList.remove('shattering');
      mark.style.setProperty('--combo-saturate', '1'); // color returns now that it's back together
    }, RETURN_MS + 40));
  }

  // Runs the full fly/hold/return course on its own timeline, independent of
  // the shake — ordinary clicks don't touch this at all, so a break always
  // plays out completely; only another full break interrupts it, by re-
  // targeting the pieces smoothly from wherever they currently are.
  function runShatter(){
    if(!shards.length) return;
    clearPendingShatter();
    shatterToken += 1;
    const token = shatterToken;

    mark.classList.add('shattering');
    shards.forEach(s => {
      s.classList.remove('returning'); // in case an in-flight return got pre-empted by a fresh break
      s.classList.add('flying');
    });
    void mark.getBoundingClientRect(); // force reflow so the transition catches the scatter values below, not the identity ones

    shards.forEach(s => {
      const dx = (Math.random() * 2 - 1) * 16;
      const dy = (Math.random() * 2 - 1) * 16;
      const rot = (Math.random() * 2 - 1) * 22;
      s.style.setProperty('--shard-dx', `${dx.toFixed(1)}px`);
      s.style.setProperty('--shard-dy', `${dy.toFixed(1)}px`);
      s.style.setProperty('--shard-rot', `${rot.toFixed(1)}deg`);
      s.style.setProperty('--shard-op', (0.72 + Math.random() * 0.2).toFixed(2));
    });

    shatterTimeouts.push(setTimeout(() => {
      if(token !== shatterToken) return;
      beginShatterReturn(token);
    }, FLY_MS + HOLD_MS));
  }

  // Rage-click easter egg: enough clicks in a row, each landing within
  // COMBO_WINDOW_MS of the last, cracks the skull — a minimal shake (kept
  // deliberately light so the shatter below reads as the main event, not a
  // shake fighting for attention), a flash of crack lines, and the shatter
  // itself (which runs on its own independent timeline, see runShatter()).
  // Any pause longer than the window drops the combo back to a fresh count of 1.
  const COMBO_WINDOW_MS = 700;
  const COMBO_THRESHOLD = 6;
  const BREAK_STRENGTH = 0.35;
  const MAX_SATURATE = 2.4; // colors get this hot right before it breaks
  let comboCount = 0;
  let lastClickTime = 0;

  mark.addEventListener('click', () => {
    // While the skull is broken (mid-shatter, however far into fly/hold/return),
    // clicks do nothing at all — no shake, no combo progress — until the pieces
    // have fully come back together and .shattering is gone.
    if(mark.classList.contains('shattering')) return;

    const now = performance.now();
    comboCount = (now - lastClickTime <= COMBO_WINDOW_MS) ? comboCount + 1 : 1;
    lastClickTime = now;

    clearPendingShake();
    shakeToken += 1;
    const token = shakeToken;

    if(comboCount >= COMBO_THRESHOLD){
      comboCount = 0; // needs a fresh combo to crack it again
      mark.style.setProperty('--combo-saturate', '0'); // drop to grey right at the break
      runShake(BREAK_STRENGTH, token);
      runShatter();
      if(crack){
        crack.classList.remove('flash');
        void crack.getBoundingClientRect(); // force reflow to restart the animation — offsetWidth doesn't exist on SVGElement
        crack.classList.add('flash');
      }
    } else {
      const intensity = comboCount / COMBO_THRESHOLD; // 0..~0.83 as the combo builds toward a break
      mark.style.setProperty('--combo-saturate', (1 + intensity * (MAX_SATURATE - 1)).toFixed(2));
      runShake(0.55 + Math.random() * 1.05, token); // ~0.55x-1.6x, a different strength each click
    }
  });
})();

// ---------- about section: "more" reveals the second text column ----------
(function aboutMore(){
  const text = document.getElementById('aboutText');
  if(!text) return;
  const toggle = text.querySelector('.about-more-toggle');
  if(!toggle) return;
  const label = toggle.childNodes[0];

  toggle.addEventListener('click', () => {
    const isExpanded = text.classList.toggle('expanded');
    toggle.setAttribute('aria-expanded', String(isExpanded));
    label.textContent = isExpanded ? 'Read less ' : 'Read more ';
  });
})();

// ---------- home hero: background photo drifts slightly on scroll (subtle parallax) ----------
(function homeParallax(){
  const photo = document.querySelector('.home-bg-photo');
  const bar = document.querySelector('.site-logo-bar');
  if(!photo) return;
  const FACTOR = 0.32;
  const MAX = 130; // px — stays inside the scale(1.3) slack in CSS so no edge ever shows

  // --banner-h drives the hard opacity cut in .home-glow::after (CSS) — measured
  // from the real logo bar instead of a guessed px value, so the cut always lands
  // exactly on the bar's own bottom edge, at any viewport width or font load state.
  if(bar){
    const setBannerHeight = () => {
      document.documentElement.style.setProperty('--banner-h', `${bar.getBoundingClientRect().height}px`);
    };
    setBannerHeight();
    window.addEventListener('resize', setBannerHeight);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(setBannerHeight);
  }

  let ticking = false;
  function update(){
    const y = Math.max(-MAX, Math.min(MAX, window.scrollY * FACTOR));
    photo.style.setProperty('--parallax-y', `${y}px`);
    ticking = false;
  }
  update(); // establish the initial value immediately rather than waiting for the first scroll event
  window.addEventListener('scroll', () => {
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
})();

// ---------- level-select cards: click to expand, accordion-style ----------
// Film cards are the one exception: they normally live in the auto-scrolling
// .film-track strip, and opening one physically relocates it into
// .film-expanded-slot (a plain .level-select), where the narrow strip-only CSS
// no longer matches it and it just falls back to looking like a Games row.
// A comment node left behind marks exactly where to put it back on close.
function moveFilmCardToSlot(card){
  const slot = document.querySelector('.film-expanded-slot');
  if(!slot || card.parentNode === slot) return;
  const placeholder = document.createComment('film-slot:' + (card.dataset.filmId || ''));
  card.before(placeholder);
  card.__filmPlaceholder = placeholder;
  slot.appendChild(card);
}
function moveFilmCardBack(card){
  const placeholder = card.__filmPlaceholder;
  if(placeholder && placeholder.parentNode){
    placeholder.replaceWith(card);
  }
  card.__filmPlaceholder = null;
}

(function levelCards(){
  const cards = Array.from(document.querySelectorAll('.level-card'));
  if(!cards.length) return;

  // Collapsing a card leaves its YouTube/SoundCloud/Spotify iframes in the DOM
  // (just visually hidden), so anything already playing keeps playing silently
  // in the background. Blanking the iframe's src stops it dead, and stashing
  // the URL back on data-src lets the existing lazy-load step reuse it next time.
  function stopCardMedia(card){
    card.querySelectorAll('.video-embed iframe, .music-embed iframe').forEach(iframe => {
      if(!iframe.src || iframe.src === 'about:blank') return;
      iframe.dataset.src = iframe.src;
      iframe.src = 'about:blank';
    });
  }

  cards.forEach(card => {
    const toggle = card.querySelector('.level-toggle');
    if(!toggle) return;
    toggle.addEventListener('click', () => {
      const isExpanded = card.classList.contains('expanded');
      // A previously-open card collapsing at the same time shifts everything
      // below it (including this card) upward over the next .4s as its own
      // .level-details shrinks — scrolling on the very next frame captures a
      // mid-collapse position that then drifts, landing short. Only wait out
      // that transition when there actually was one collapsing; otherwise
      // scroll right away so the common case (nothing else was open) stays snappy.
      const wasAnotherOpen = cards.some(other => other !== card && other.classList.contains('expanded'));
      cards.forEach(other => {
        if(other.classList.contains('expanded')){
          stopCardMedia(other);
          if(other.dataset.filmId){ moveFilmCardBack(other); }
        }
        other.classList.remove('expanded');
        other.querySelector('.level-toggle').setAttribute('aria-expanded', 'false');
      });
      if(!isExpanded){
        card.classList.add('expanded');
        toggle.setAttribute('aria-expanded', 'true');
        if(card.dataset.filmId){ moveFilmCardToSlot(card); }
        card.querySelectorAll('.video-embed iframe[data-src], .music-embed iframe[data-src]').forEach(iframe => {
          iframe.src = iframe.dataset.src;
          iframe.removeAttribute('data-src');
        });
        const scrollToCard = () => card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if(wasAnotherOpen){
          setTimeout(scrollToCard, 420); // matches .level-details' .4s collapse transition, plus a small buffer
        } else {
          requestAnimationFrame(scrollToCard);
        }
      }
    });
  });
})();

// ---------- skill-tree cards: click to expand, accordion-style (same pattern
// as levelCards() above, minus the media/film handling those need) ----------
(function skillCards(){
  const cards = Array.from(document.querySelectorAll('.skill-card'));
  if(!cards.length) return;
  // Disabled for now (per request) — cards stay static, no click-to-open.
  // Everything below is left intact so this is a one-line revert.
  return;
  // eslint-disable-next-line no-unreachable
  const servicesSection = document.getElementById('services');
  const panel = document.getElementById('skillPanel');
  const panelInner = panel ? panel.querySelector('.skill-panel-inner') : null;
  const panelVideo = panel ? panel.querySelector('.skill-panel-bg-video') : null;

  // Desktop relocates the selected card's own .skill-details into the shared
  // panel below the row instead of duplicating it in markup — this comment
  // node marks its original spot so it can be moved back (same technique as
  // moveFilmCardToSlot()/moveFilmCardBack() further down).
  const homes = new Map();
  cards.forEach(card => {
    const details = card.querySelector('.skill-details');
    if(!details) return;
    const anchor = document.createComment('skill-details-home');
    details.after(anchor);
    homes.set(card, { details, anchor });
  });

  function isDesktopLayout(){ return window.innerWidth >= 640; }

  function returnDetailsHome(card){
    const home = homes.get(card);
    if(home && home.details.parentElement !== card) home.anchor.after(home.details);
  }

  function closeAll(){
    cards.forEach(card => {
      card.classList.remove('expanded', 'active');
      card.querySelector('.skill-toggle').setAttribute('aria-expanded', 'false');
      returnDetailsHome(card);
    });
    if(panel) panel.classList.remove('active');
    if(panelVideo) panelVideo.pause();
  }

  cards.forEach(card => {
    const toggle = card.querySelector('.skill-toggle');
    if(!toggle) return;
    toggle.addEventListener('click', () => {
      const wasOpen = card.classList.contains('expanded') || card.classList.contains('active');
      const wasAnotherOpen = cards.some(other => other !== card &&
        (other.classList.contains('expanded') || other.classList.contains('active')));

      closeAll();

      if(wasOpen) return; // just closed it — nothing left to open

      toggle.setAttribute('aria-expanded', 'true');
      const desktop = isDesktopLayout();

      if(desktop && panel && panelInner){
        card.classList.add('active');
        const home = homes.get(card);
        if(home) panelInner.appendChild(home.details);

        // Relocates the panel itself to sit right after the selected card
        // (grid-auto-flow:dense on .skill-tree regroups the other cards
        // around it — see the CSS), so it always opens directly under that
        // card's own row instead of at the bottom of the whole grid.
        card.after(panel);

        // Shows the same background video as the selected card instead of a
        // flat panel color, so it reads as that card continuing downward
        // rather than a separate surface the border just happens to point at.
        if(panelVideo){
          const cardVideo = card.querySelector('.skill-bg-video');
          const src = cardVideo && (cardVideo.currentSrc || cardVideo.src);
          if(src && src !== panelVideo.dataset.currentSrc){
            panelVideo.classList.remove('is-active'); // fades out; canplay below fades the new frame back in
            panelVideo.src = src;
            panelVideo.dataset.currentSrc = src;
            panelVideo.addEventListener('canplay', () => panelVideo.classList.add('is-active'), { once: true });
            panelVideo.play().catch(() => {});
          } else if(src){
            panelVideo.classList.add('is-active');
            panelVideo.play().catch(() => {});
          }
        }

        // Sizes the connecting bridge to exactly match whichever card is now
        // selected — measured after the moves above (so left/width are
        // accurate to the new layout) but before the panel's own open
        // transition starts, since those two properties don't move during it.
        const cardRect = card.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        panel.style.setProperty('--panel-bridge-left', `${cardRect.left - panelRect.left}px`);
        panel.style.setProperty('--panel-bridge-width', `${cardRect.width}px`);
        panel.classList.add('active');
      } else {
        card.classList.add('expanded');
      }

      // Desktop always snaps to the section header, which never shifts
      // regardless of panel state, so it can happen immediately. Mobile
      // cards grow in place — a previously-open card collapsing shifts
      // everything below it, so wait that out before measuring where to scroll.
      const scrollTarget = (desktop && servicesSection) ? servicesSection : card;
      const scrollToTarget = () => scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if(!desktop && wasAnotherOpen){
        setTimeout(scrollToTarget, 420); // matches .skill-details' .4s collapse transition, plus a small buffer
      } else {
        requestAnimationFrame(scrollToTarget);
      }
    });
  });
})();

// ---------- skill-card background videos: stay srcless until the Services
// section is actually about to scroll into view, so nobody pays for four
// video downloads on page load just to never see them ----------
(function skillBgVideos(){
  const tree = document.querySelector('.skill-tree');
  const videos = Array.from(document.querySelectorAll('.skill-bg-video'));
  if(!tree || !videos.length) return;

  // Pauses (not just visually hides) once the section scrolls back out of view —
  // four decoding+blurred videos left running forever after a single visit was
  // dragging down performance sitewide, not just while actually on this section.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        videos.forEach(video => {
          if(video.dataset.src){
            video.src = video.dataset.src;
            delete video.dataset.src;
            video.addEventListener('canplay', () => video.classList.add('is-active'), { once: true });
          }
          video.play().catch(() => {}); // autoplay can still be blocked on some mobile browsers; fails silently, scrim alone still looks fine
        });
      } else {
        videos.forEach(video => { if(!video.dataset.src) video.pause(); });
      }
    });
  }, { rootMargin: '200px' });
  observer.observe(tree);
})();

// ---------- film strip: a seamless looping/draggable marquee (same physics as the
// brand marquee below), except clicking a card never expands it in place — it's
// relocated out to .film-expanded-slot by levelCards() above instead. Clones exist
// purely for the visual loop; clicking one just forwards to the real card's toggle. ----------
(function filmMarquee(){
  const outer = document.querySelector('.level-select--film');
  const track = document.querySelector('.film-track');
  if(!outer || !track) return;

  const originals = Array.from(track.children);
  const originalsById = {};
  originals.forEach(card => { if(card.dataset.filmId) originalsById[card.dataset.filmId] = card; });
  originals.forEach(node => {
    const clone = node.cloneNode(true);
    clone.dataset.clone = 'true';
    track.appendChild(clone);
  });
  track.querySelectorAll('img').forEach(img => {
    img.addEventListener('dragstart', e => e.preventDefault());
  });

  // Deliberately slower than the photo-roller/brand-marquee (which both use 40/8),
  // so the two don't read as the same motion.
  const NORMAL_SPEED = 18, SLOW_SPEED = 4, EASE_RATE = 2, RELEASE_EASE_RATE = 1.4;
  const MAX_FLING_VELOCITY = 7000, VELOCITY_SAMPLE_WINDOW = 100, DRAG_THRESHOLD = 6;
  const CATCH_TIME = 0.16; // sec — grabbing a moving strip doesn't stop it dead; it slips a little before the grip fully takes hold, like it has weight

  let ambientTarget = NORMAL_SPEED;
  let velocity = NORMAL_SPEED;
  let position = 0;
  let halfWidth = track.scrollWidth / 2;
  let lastTime = performance.now();

  let isDragging = false;
  let isReleasing = false;
  let justDragged = false;
  let activePointerId = null;
  let activePointerType = 'mouse';
  let startX = 0;
  let lastX = 0;
  let lastMoveTime = 0;
  let moveSamples = [];
  let catchStartTime = 0;
  let catchVelocity = 0; // velocity being coasted off at the moment of grab, bled out over CATCH_TIME
  // A finger drifts a few px during an ordinary tap just from the physical
  // act of touching the screen — a mouse click doesn't. DRAG_THRESHOLD alone
  // was tuned for mouse precision and was swallowing legitimate taps on
  // touch, requiring several attempts to open a card.
  const TOUCH_DRAG_THRESHOLD = 16;

  window.addEventListener('resize', () => { halfWidth = track.scrollWidth / 2; });
  new MutationObserver(() => { halfWidth = track.scrollWidth / 2; })
    .observe(track, { childList: true });

  outer.addEventListener('mouseenter', () => { if(!isDragging) ambientTarget = SLOW_SPEED; });
  outer.addEventListener('mouseleave', () => { if(!isDragging) ambientTarget = NORMAL_SPEED; });

  track.addEventListener('pointerdown', (e) => {
    isDragging = true;
    isReleasing = false;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    startX = e.clientX;
    lastX = e.clientX;
    lastMoveTime = performance.now();
    moveSamples = [];
    catchStartTime = performance.now();
    catchVelocity = velocity;
    outer.classList.add('dragging');
    // Deliberately no setPointerCapture: it would retarget the toggle buttons'
    // own click events to the track and silently break card expansion entirely.
  });
  window.addEventListener('pointermove', (e) => {
    if(!isDragging || e.pointerId !== activePointerId) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(now - lastMoveTime, 1000 / 120);
    const catchT = Math.min(1, (now - catchStartTime) / (CATCH_TIME * 1000));
    position -= dx * catchT; // grip ramps in rather than snapping to full control instantly
    lastX = e.clientX;
    lastMoveTime = now;
    moveSamples.push({ dx, dt, t: now });
    moveSamples = moveSamples.filter(s => now - s.t <= VELOCITY_SAMPLE_WINDOW);
  });
  function releaseDrag(e){
    if(!isDragging || (e && e.pointerId !== activePointerId)) return;
    isDragging = false;
    isReleasing = true;
    outer.classList.remove('dragging');
    const totalDx = moveSamples.reduce((sum, s) => sum + s.dx, 0);
    const totalDt = moveSamples.reduce((sum, s) => sum + s.dt, 0) / 1000;
    let flingVelocity = totalDt > 0 ? -(totalDx / totalDt) : 0;
    flingVelocity = Math.max(-MAX_FLING_VELOCITY, Math.min(MAX_FLING_VELOCITY, flingVelocity));
    velocity = flingVelocity;
    const threshold = activePointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
    if(Math.abs(e ? (e.clientX - startX) : 0) > threshold) justDragged = true;
  }
  window.addEventListener('pointerup', releaseDrag);
  window.addEventListener('pointercancel', releaseDrag);

  track.addEventListener('click', (ev) => {
    if(justDragged){
      justDragged = false;
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }
    const toggle = ev.target.closest('.level-toggle');
    if(!toggle) return;
    const card = toggle.closest('.level-card');
    if(card && card.dataset.clone === 'true'){
      ev.stopPropagation();
      ev.preventDefault();
      const original = originalsById[card.dataset.filmId];
      if(original) original.querySelector('.level-toggle').click();
    }
  }, { capture: true });

  function tick(now){
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if(!isDragging){
      const rate = isReleasing ? RELEASE_EASE_RATE : EASE_RATE;
      velocity += (ambientTarget - velocity) * Math.min(1, rate * dt);
      if(isReleasing && Math.abs(velocity - ambientTarget) < 0.5) isReleasing = false;
      position += velocity * dt;
    } else {
      // still bleeding off its pre-grab momentum for a moment before the grip fully takes hold
      const catchT = Math.min(1, (now - catchStartTime) / (CATCH_TIME * 1000));
      if(catchT < 1) position += catchVelocity * (1 - catchT) * dt;
    }
    if(halfWidth > 0) position = ((position % halfWidth) + halfWidth) % halfWidth;
    track.style.transform = `translateX(${-position}px)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// ---------- sound redesign cards: click thumbnail to play video inline, one open at a time ----------
(function redesignCards(){
  let openEntry = null; // { card, thumb, wrapper } currently playing, across every redesign section

  function closeOpenEntry(){
    if(!openEntry) return;
    const { card, thumb, wrapper } = openEntry;
    wrapper.replaceWith(thumb); // detaches iframe from the DOM, which stops playback
    card.classList.remove('is-playing');
    openEntry = null;
  }

  document.querySelectorAll('.redesign-card').forEach(card => {
    const thumb = card.querySelector('.redesign-thumb');
    const videoSrc = card.dataset.video;
    if(!thumb || !videoSrc) return;
    thumb.addEventListener('click', () => {
      closeOpenEntry();

      const wrapper = document.createElement('div');
      wrapper.className = 'redesign-video';
      const iframe = document.createElement('iframe');
      iframe.src = videoSrc + (videoSrc.includes('?') ? '&' : '?') + 'autoplay=1';
      iframe.title = card.dataset.title || '';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'redesign-close';
      closeBtn.setAttribute('aria-label', 'Close video');
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOpenEntry();
      });

      wrapper.appendChild(iframe);
      wrapper.appendChild(closeBtn);
      thumb.replaceWith(wrapper);
      card.classList.add('is-playing');

      openEntry = { card, thumb, wrapper };
    });
  });
})();

// ---------- HUD side nav: active state, click-to-scroll, dock-style magnify + proximity label reveal ----------
(function hudNav(){
  const nav = document.getElementById('hudNav');
  if(!nav) return;
  const nodes = Array.from(nav.querySelectorAll('.hud-node'));
  const targets = nodes.map(n => document.getElementById(n.dataset.target)).filter(Boolean);
  const RADIUS = 130; // px falloff radius around the cursor
  const MAX_SCALE = 1.8;
  let lastX = null, lastY = null;

  function applyDock(){
    nodes.forEach(node => {
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = lastX == null ? Infinity : Math.hypot(lastX - cx, lastY - cy);
      const t = Math.max(0, 1 - dist / RADIUS);
      const scale = 1 + t * (MAX_SCALE - 1);
      node.style.setProperty('--dock-scale', scale.toFixed(3));
      node.style.setProperty('--dock-label-opacity', t.toFixed(3));
    });
  }

  window.addEventListener('mousemove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    applyDock();
  }, { passive: true });
  window.addEventListener('mouseleave', () => { lastX = null; lastY = null; applyDock(); });

  // While a click-triggered smooth scroll is travelling toward its target,
  // the sections it passes over briefly satisfy the observer's mid-viewport
  // band too — ignore the observer for that stretch so the dot doesn't
  // flicker through every section it flies past, and only trust scroll
  // position again once the animation actually settles.
  let isNavigating = false;
  let navSettleTimer = null;

  function endNavigation(){
    isNavigating = false;
    window.removeEventListener('scrollend', endNavigation);
    clearTimeout(navSettleTimer);
  }

  nodes.forEach(node => {
    node.addEventListener('click', () => {
      const target = document.getElementById(node.dataset.target);
      isNavigating = true;
      nodes.forEach(n => n.classList.remove('active'));
      node.classList.add('active');
      if(target) target.scrollIntoView({ behavior:'smooth' });
      window.addEventListener('scrollend', endNavigation);
      clearTimeout(navSettleTimer);
      navSettleTimer = setTimeout(endNavigation, 1200); // fallback where scrollend isn't supported
    });
  });

  const observer = new IntersectionObserver((entries) => {
    if(isNavigating){ applyDock(); return; }
    entries.forEach(entry => {
      const idx = targets.indexOf(entry.target);
      if(idx === -1) return;
      if(entry.isIntersecting){
        nodes.forEach(n => n.classList.remove('active'));
        nodes[idx].classList.add('active');
      }
    });
    applyDock();
  }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });

  targets.forEach(t => observer.observe(t));

  // #top is a short header pinned at the very start of the page, so it never
  // crosses the observer's mid-viewport band once scrolled all the way up —
  // catch that edge case directly instead.
  window.addEventListener('scroll', () => {
    if(isNavigating) return;
    if(window.scrollY < 80){
      nodes.forEach(n => n.classList.remove('active'));
      nodes[0].classList.add('active');
    }
  }, { passive: true });

  applyDock();
})();

// ---------- scroll reveal for chapters ----------
(function reveal(){
  const chapters = document.querySelectorAll('.chapter');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        // belt-and-suspenders: some browsers fail to transition very tall
        // sections reliably via the class alone, so set it inline too.
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  chapters.forEach(c => observer.observe(c));
})();

// ---------- draggable momentum roller: reused by the brand marquee and every photo roller ----------
function initDragRoller(marquee, track){
  if(!track || !marquee) return;

  const clones = Array.from(track.children).map(node => node.cloneNode(true));
  clones.forEach(node => track.appendChild(node));
  track.querySelectorAll('img').forEach(img => {
    img.addEventListener('dragstart', e => e.preventDefault());
  });

  const NORMAL_SPEED = 40; // px/sec, ambient scroll
  const SLOW_SPEED = 8;    // px/sec, ambient scroll while hovered
  const EASE_RATE = 2;          // how fast ambient speed changes settle in
  const RELEASE_EASE_RATE = 1.4; // how fast momentum bleeds off after a drag release (friction)
  const MAX_FLING_VELOCITY = 7000; // px/sec cap, so a fast flick feels punchy but stays controlled
  const VELOCITY_SAMPLE_WINDOW = 100; // ms of recent movement used to compute release momentum
  const CATCH_TIME = 0.34; // sec — grabbing a moving roller doesn't stop it dead; it slips a little before the grip fully takes hold, like it has weight

  let ambientTarget = NORMAL_SPEED;
  let velocity = NORMAL_SPEED; // signed px/sec; direction can reverse while dragging
  let position = 0;
  let halfWidth = track.scrollWidth / 2;
  let lastTime = performance.now();

  let isDragging = false;
  let isReleasing = false;
  let activePointerId = null;
  let lastX = 0;
  let lastMoveTime = 0;
  let moveSamples = []; // recent {dx, dt} used to compute a smoothed fling velocity
  let catchStartTime = 0;
  let catchVelocity = 0; // velocity being coasted off at the moment of grab, bled out over CATCH_TIME

  window.addEventListener('resize', () => { halfWidth = track.scrollWidth / 2; });
  marquee.addEventListener('mouseenter', () => { if(!isDragging) ambientTarget = SLOW_SPEED; });
  marquee.addEventListener('mouseleave', () => { if(!isDragging) ambientTarget = NORMAL_SPEED; });

  track.addEventListener('pointerdown', (e) => {
    isDragging = true;
    isReleasing = false;
    activePointerId = e.pointerId;
    lastX = e.clientX;
    lastMoveTime = performance.now();
    moveSamples = [];
    catchStartTime = performance.now();
    catchVelocity = velocity;
    try{ track.setPointerCapture(activePointerId); } catch(err){}
    marquee.classList.add('dragging');
  });

  window.addEventListener('pointermove', (e) => {
    if(!isDragging || e.pointerId !== activePointerId) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(now - lastMoveTime, 1000 / 120); // ms
    const catchT = Math.min(1, (now - catchStartTime) / (CATCH_TIME * 1000));
    position -= dx * catchT; // grip ramps in rather than snapping to full control instantly
    lastX = e.clientX;
    lastMoveTime = now;

    moveSamples.push({ dx, dt, t: now });
    moveSamples = moveSamples.filter(s => now - s.t <= VELOCITY_SAMPLE_WINDOW);
  });

  function releaseDrag(e){
    if(!isDragging || (e && e.pointerId !== activePointerId)) return;
    isDragging = false;
    isReleasing = true;
    marquee.classList.remove('dragging');

    const totalDx = moveSamples.reduce((sum, s) => sum + s.dx, 0);
    const totalDt = moveSamples.reduce((sum, s) => sum + s.dt, 0) / 1000; // seconds
    let flingVelocity = totalDt > 0 ? -(totalDx / totalDt) : 0;
    flingVelocity = Math.max(-MAX_FLING_VELOCITY, Math.min(MAX_FLING_VELOCITY, flingVelocity));
    velocity = flingVelocity;
  }
  window.addEventListener('pointerup', releaseDrag);
  window.addEventListener('pointercancel', releaseDrag);

  function tick(now){
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if(!isDragging){
      const rate = isReleasing ? RELEASE_EASE_RATE : EASE_RATE;
      velocity += (ambientTarget - velocity) * Math.min(1, rate * dt);
      if(isReleasing && Math.abs(velocity - ambientTarget) < 0.5) isReleasing = false;
      position += velocity * dt;
    } else {
      // still bleeding off its pre-grab momentum for a moment before the grip fully takes hold
      const catchT = Math.min(1, (now - catchStartTime) / (CATCH_TIME * 1000));
      if(catchT < 1) position += catchVelocity * (1 - catchT) * dt;
    }
    if(halfWidth > 0) position = ((position % halfWidth) + halfWidth) % halfWidth;
    track.style.transform = `translateX(${-position}px)`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

initDragRoller(document.querySelector('.brand-marquee'), document.getElementById('brandTrack'));
document.querySelectorAll('.photo-roller').forEach(roller => {
  initDragRoller(roller, roller.querySelector('.photo-roller-track'));
});

// ---------- konami code easter egg ----------
(function konami(){
  const seq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let pos = 0;
  window.addEventListener('keydown', (e) => {
    pos = (e.key === seq[pos]) ? pos + 1 : 0;
    if(pos === seq.length){
      pos = 0;
      document.body.style.filter = document.body.style.filter ? '' : 'invert(1) hue-rotate(180deg)';
    }
  });
})();
