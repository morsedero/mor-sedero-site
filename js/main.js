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
(function levelCards(){
  const cards = Array.from(document.querySelectorAll('.level-card'));
  if(!cards.length) return;

  cards.forEach(card => {
    const toggle = card.querySelector('.level-toggle');
    if(!toggle) return;
    toggle.addEventListener('click', () => {
      const isExpanded = card.classList.contains('expanded');
      cards.forEach(other => {
        other.classList.remove('expanded');
        other.querySelector('.level-toggle').setAttribute('aria-expanded', 'false');
      });
      if(!isExpanded){
        card.classList.add('expanded');
        toggle.setAttribute('aria-expanded', 'true');
        card.querySelectorAll('.video-embed iframe[data-src], .music-embed iframe[data-src]').forEach(iframe => {
          iframe.src = iframe.dataset.src;
          iframe.removeAttribute('data-src');
        });
        requestAnimationFrame(() => {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    });
  });
})();

// ---------- sound redesign cards: click thumbnail to play video inline ----------
(function redesignCards(){
  document.querySelectorAll('.redesign-card').forEach(card => {
    const thumb = card.querySelector('.redesign-thumb');
    const videoSrc = card.dataset.video;
    if(!thumb || !videoSrc) return;
    thumb.addEventListener('click', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'redesign-video';
      const iframe = document.createElement('iframe');
      iframe.src = videoSrc + (videoSrc.includes('?') ? '&' : '?') + 'autoplay=1';
      iframe.title = card.dataset.title || '';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      wrapper.appendChild(iframe);
      thumb.replaceWith(wrapper);
    }, { once: true });
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

  nodes.forEach(node => {
    node.addEventListener('click', () => {
      const target = document.getElementById(node.dataset.target);
      if(target) target.scrollIntoView({ behavior:'smooth' });
    });
  });

  const observer = new IntersectionObserver((entries) => {
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
