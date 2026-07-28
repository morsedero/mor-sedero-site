// ---------- logo mark: interactive 3D tilt following the cursor ----------
(function logoTilt(){
  const mark = document.querySelector('.site-logo-mark');
  const img = document.querySelector('.site-logo-mark-img');
  if(!mark || !img) return;
  const MAX_TILT = 20; // degrees

  mark.addEventListener('mousemove', (e) => {
    const rect = mark.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * MAX_TILT * 2;
    const rotateX = (0.5 - py) * MAX_TILT * 2;
    img.style.transform = `perspective(500px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.1)`;
  });
  mark.addEventListener('mouseleave', () => {
    img.style.transform = '';
  });
})();

// ---------- about section: "more" opens a third column with the rest of the bio ----------
(function aboutMore(){
  const row = document.getElementById('aboutRow');
  if(!row) return;
  const toggle = row.querySelector('.about-more-toggle');
  const label = toggle.childNodes[0];

  toggle.addEventListener('click', () => {
    const isExpanded = row.classList.toggle('expanded');
    toggle.setAttribute('aria-expanded', String(isExpanded));
    label.textContent = isExpanded ? 'Read less ' : 'Read more ';
  });
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
  const MAX_FLING_VELOCITY = 2200, VELOCITY_SAMPLE_WINDOW = 100, DRAG_THRESHOLD = 6;

  let ambientTarget = NORMAL_SPEED;
  let velocity = NORMAL_SPEED;
  let position = 0;
  let halfWidth = track.scrollWidth / 2;
  let lastTime = performance.now();

  let isDragging = false;
  let isReleasing = false;
  let justDragged = false;
  let activePointerId = null;
  let startX = 0;
  let lastX = 0;
  let lastMoveTime = 0;
  let moveSamples = [];

  window.addEventListener('resize', () => { halfWidth = track.scrollWidth / 2; });
  new MutationObserver(() => { halfWidth = track.scrollWidth / 2; })
    .observe(track, { childList: true });

  outer.addEventListener('mouseenter', () => { if(!isDragging) ambientTarget = SLOW_SPEED; });
  outer.addEventListener('mouseleave', () => { if(!isDragging) ambientTarget = NORMAL_SPEED; });

  track.addEventListener('pointerdown', (e) => {
    isDragging = true;
    isReleasing = false;
    activePointerId = e.pointerId;
    startX = e.clientX;
    lastX = e.clientX;
    lastMoveTime = performance.now();
    moveSamples = [];
    outer.classList.add('dragging');
    // Deliberately no setPointerCapture: it would retarget the toggle buttons'
    // own click events to the track and silently break card expansion entirely.
  });
  window.addEventListener('pointermove', (e) => {
    if(!isDragging || e.pointerId !== activePointerId) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(now - lastMoveTime, 1000 / 120);
    position -= dx;
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
    if(Math.abs(e ? (e.clientX - startX) : 0) > DRAG_THRESHOLD) justDragged = true;
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
  const MAX_FLING_VELOCITY = 2200; // px/sec cap, so a fast flick feels punchy but stays controlled
  const VELOCITY_SAMPLE_WINDOW = 100; // ms of recent movement used to compute release momentum

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
    try{ track.setPointerCapture(activePointerId); } catch(err){}
    marquee.classList.add('dragging');
  });

  window.addEventListener('pointermove', (e) => {
    if(!isDragging || e.pointerId !== activePointerId) return;
    const now = performance.now();
    const dx = e.clientX - lastX;
    const dt = Math.max(now - lastMoveTime, 1000 / 120); // ms
    position -= dx;
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
