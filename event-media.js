/* HOD event media
 *
 * This is deliberately a small, dependency-free browser module.  The event
 * document is still owned by the public events API; this file only validates
 * and presents its optional music/reels fields.
 */
(function (root, factory) {
  var api = factory(root);
  if (root) root.HODEventMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var CLIP_SECONDS = {10: true, 15: true};
  var MAX_REELS = 5;
  var active = null;
  var entries = [];
  var soundPreference = false;
  var observerStarted = false;
  var mutationObserver = null;
  var playGeneration = 0;
  var pausedOwner = null;

  function finiteNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function positiveDuration(value) {
    var n = finiteNumber(value);
    return n !== null && n > 0 && n <= 86400 ? n : null;
  }

  function firebaseMediaUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      var u = new URL(value);
      return u.protocol === 'https:' &&
        u.hostname.toLowerCase() === 'firebasestorage.googleapis.com' &&
        u.pathname.indexOf('/v0/b/hod-tickets.firebasestorage.app/o/') === 0;
    } catch (_) {
      return false;
    }
  }

  function safeTitle(value, fallback) {
    var title = value === undefined || value === null ? '' : String(value);
    title = title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    return title || (fallback || 'Event media');
  }

  function normalizeMusic(value) {
    if (!value || typeof value !== 'object' || !firebaseMediaUrl(value.url) ||
        !String(value.trackId || '').trim() || !String(value.title || '').trim()) return null;
    var duration = positiveDuration(value.durationSec);
    var clip = Number(value.clipSeconds);
    var start = finiteNumber(value.startSec);
    if (!duration || !CLIP_SECONDS[clip] || start === null || start < 0 ||
        start + clip > duration) return null;
    return {
      trackId: safeTitle(value.trackId, 'Event music').slice(0, 120),
      title: safeTitle(value.title, 'Event music'),
      url: String(value.url),
      durationSec: duration,
      startSec: start,
      clipSeconds: clip
    };
  }

  function normalizeReel(value) {
    if (!value || typeof value !== 'object' || !firebaseMediaUrl(value.url) ||
        !String(value.id || '').trim() || !String(value.title || '').trim()) return null;
    var duration = positiveDuration(value.durationSec);
    if (!duration) return null;
    var reel = {
      id: safeTitle(value.id, 'Event reel').slice(0, 120),
      url: String(value.url),
      title: safeTitle(value.title, 'Event reel'),
      durationSec: duration
    };
    if (value.storagePath !== undefined && value.storagePath !== null) {
      var path = String(value.storagePath).replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (path) reel.storagePath = path.slice(0, 500);
    }
    return reel;
  }

  /*
   * Normalize only the optional media fields, retaining every other event
   * property exactly as received.  This matters because the customer build
   * receives event documents from both the public endpoint and its fallback.
   */
  function normalizeEvent(event) {
    var out = {};
    event = event && typeof event === 'object' ? event : {};
    Object.keys(event).forEach(function (key) { out[key] = event[key]; });
    out.music = normalizeMusic(event.music);
    out.reels = [];
    if (Array.isArray(event.reels)) {
    event.reels.forEach(function (item) {
      if (out.reels.length >= MAX_REELS) return;
        var reel = normalizeReel(item);
        if (reel) out.reels.push(reel);
      });
    }
    return out;
  }

  function stopElement(element) {
    if (!element) return;
    try { element.pause(); } catch (_) {}
  }

  function nextGeneration() {
    playGeneration += 1;
    return playGeneration;
  }

  function rootIsVisible(rootNode) {
    if (!rootNode || rootNode.isConnected === false) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    if (rootNode._hodMediaVisibilityKnown) return rootNode._hodMediaVisible === true;
    if (rootNode.getBoundingClientRect) {
      var rect = rootNode.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    }
    return rootNode.isConnected !== false;
  }

  function entryIsVisible(entry) {
    return !!entry && entry.rootVisible === true && rootIsVisible(entry.root);
  }

  function playIsCurrent(entry, token) {
    return !!entry && active === entry && entry.playGeneration === token &&
      entry.selected === true && entryIsVisible(entry);
  }

  function setButton(button, on, kind) {
    if (!button) return;
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.setAttribute('aria-label', on ? 'Mute ' + kind : 'Turn sound on for ' + kind);
    button.textContent = on ? '🔊' : '🔇';
  }

  function stopEntry(entry) {
    if (!entry) return;
    nextGeneration();
    entry.pendingPlayToken = null;
    entry.audioPlayToken = null;
    stopElement(entry.audio);
    stopElement(entry.video);
    if (entry.audio) {
      try { entry.audio.currentTime = entry.musicStart || 0; } catch (_) {}
    }
    if (entry.video) entry.video.muted = true;
    entry.playing = false;
    setButton(entry.soundButton, false, entry.kind === 'reel' ? 'this reel' : 'this event');
    if (entry.playFallback) entry.playFallback.hidden = true;
    if (active === entry) active = null;
  }

  function stopAll(preserveOwner) {
    var owner = preserveOwner ? active : null;
    entries.slice().forEach(stopEntry);
    active = null;
    pausedOwner = owner || null;
  }

  function claim(entry) {
    if (!entry) return;
    entries.slice().forEach(function (other) {
      if (other !== entry && (other.audio || other.video)) stopEntry(other);
    });
    active = entry;
    pausedOwner = null;
    entry.playGeneration = nextGeneration();
    return entry.playGeneration;
  }

  function showPlayFallback(entry) {
    if (entry && entry.video && entry.video.style) entry.video.style.display = 'none';
    if (entry.playFallback) entry.playFallback.hidden = false;
  }

  function hidePlayFallback(entry) {
    if (entry && entry.video && entry.video.style) entry.video.style.display = '';
    if (entry.playFallback) entry.playFallback.hidden = true;
  }

  function startAudio(entry, fromGesture) {
    if (!entry || !entry.music) return;
    if (!fromGesture && !soundPreference) return;
    if (!entry.selected || !entryIsVisible(entry)) return;
    var token = claim(entry);
    if (!entry.audio) {
      var audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.muted = false;
      audio.setAttribute('aria-hidden', 'true');
      audio.addEventListener('loadedmetadata', function () {
        try { audio.currentTime = entry.musicStart; } catch (_) {}
      });
      var keepInSegment = function () {
        if (!playIsCurrent(entry, entry.audioPlayToken)) return;
        var end = entry.musicStart + entry.musicClip;
        if (audio.currentTime >= end || audio.currentTime < entry.musicStart - 0.25) {
          try { audio.currentTime = entry.musicStart; } catch (_) {}
          if (entry.playing) {
            var again = audio.play();
            if (again && again.catch) again.catch(function () { showPlayFallback(entry); });
          }
        }
      };
      audio.addEventListener('timeupdate', keepInSegment);
      audio.addEventListener('ended', function () {
        if (!playIsCurrent(entry, entry.audioPlayToken)) return;
        try { audio.currentTime = entry.musicStart; } catch (_) {}
        if (entry.playing) {
          var again = audio.play();
          if (again && again.catch) again.catch(function () { showPlayFallback(entry); });
        }
      });
      audio.addEventListener('error', function () {
        if (playIsCurrent(entry, entry.audioPlayToken)) showPlayFallback(entry);
      });
      entry.audio = audio;
    }
    entry.audio.muted = false;
    entry.musicStart = Number(entry.music.startSec) || 0;
    entry.musicClip = Number(entry.music.clipSeconds);
    entry.audio.src = entry.music.url;
    entry.audio.preload = 'metadata';
    entry.playing = true;
    entry.pendingPlayToken = token;
    entry.audioPlayToken = token;
    soundPreference = true;
    setButton(entry.soundButton, true, 'this event');
    hidePlayFallback(entry);
    try { entry.audio.currentTime = entry.musicStart; } catch (_) {}
    var promise;
    try { promise = entry.audio.play(); } catch (_) { promise = null; }
    if (promise && promise.then) {
      promise.then(function () {
        if (!playIsCurrent(entry, token)) {
          stopElement(entry.audio);
          return;
        }
        entry.pendingPlayToken = null;
        entry.playing = true;
      }).catch(function () {
        if (!playIsCurrent(entry, token)) return;
        entry.pendingPlayToken = null;
        entry.playing = false;
        active = null;
        showPlayFallback(entry);
        setButton(entry.soundButton, false, 'this event');
      });
    }
  }

  function toggleAudio(entry) {
    if (!entry) return;
    if (entry.playing && entry.audio && !entry.audio.muted) {
      soundPreference = false;
      stopEntry(entry);
      return;
    }
    startAudio(entry, true);
  }

  function ensureVideo(entry) {
    if (!entry || entry.video || typeof document === 'undefined') return entry && entry.video;
    var video = document.createElement('video');
    video.className = 'event-reel-video';
    video.controls = true;
    video.playsInline = true;
    video.muted = true;
    video.defaultMuted = true;
    video.preload = 'none';
    video.setAttribute('aria-label', entry.title);
    video.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    video.addEventListener('play', function () {
      if (!entry.selected || !entryIsVisible(entry)) {
        stopElement(video);
        return;
      }
      if (entry.pendingPlayToken && !playIsCurrent(entry, entry.pendingPlayToken)) {
        stopElement(video);
        return;
      }
      // A delayed synthetic/programmatic play event from an old generation
      // must not steal ownership back. Native controls carry isTrusted=true
      // and are still allowed to claim the global owner.
      if (active !== entry && (!event || event.isTrusted !== true) &&
          entry.playGeneration !== playGeneration) {
        stopElement(video);
        return;
      }
      if (active !== entry) claim(entry);
      entry.playing = true;
    });
    video.addEventListener('pause', function () {
      entry.playing = false;
      if (active === entry) active = null;
    });
    video.addEventListener('ended', function () {
      entry.playing = false;
      if (active === entry) active = null;
    });
    video.addEventListener('error', function () {
      if (active === entry && entry.selected && entryIsVisible(entry)) showPlayFallback(entry);
    });
    entry.video = video;
    if (entry.videoHost) entry.videoHost.appendChild(video);
    return video;
  }

  function playVideo(entry, unmute) {
    if (!entry || !entry.reel) return;
    if (!entry.selected || !entryIsVisible(entry)) return;
    var token = claim(entry);
    var video = ensureVideo(entry);
    if (!video) return;
    if (video.getAttribute('src') !== entry.reel.url) {
      video.setAttribute('src', entry.reel.url);
      video.preload = 'none';
      try { video.load(); } catch (_) {}
    }
    if (unmute) {
      video.muted = false;
      video.defaultMuted = false;
      soundPreference = true;
      setButton(entry.soundButton, true, 'this reel');
    } else {
      video.muted = true;
      setButton(entry.soundButton, false, 'this reel');
    }
    hidePlayFallback(entry);
    entry.pendingPlayToken = token;
    entry.playing = false;
    var promise;
    try { promise = video.play(); } catch (_) { promise = null; }
    if (promise && promise.then) {
      promise.then(function () {
        if (!playIsCurrent(entry, token)) {
          stopElement(video);
          return;
        }
        entry.pendingPlayToken = null;
        entry.playing = true;
      }).catch(function () {
        if (!playIsCurrent(entry, token)) return;
        entry.pendingPlayToken = null;
        entry.playing = false;
        active = null;
        showPlayFallback(entry);
      });
    }
  }

  function toggleVideo(entry) {
    if (!entry) return;
    if (!entry.selected || !entryIsVisible(entry)) return;
    var video = ensureVideo(entry);
    if (!video) return;
    if (!video.paused && !video.muted) {
      soundPreference = false;
      video.muted = true;
      setButton(entry.soundButton, false, 'this reel');
      return;
    }
    playVideo(entry, true);
  }

  function addSoundButton(slide, entry) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-media-sound';
    button.setAttribute('data-event-media-control', 'true');
    button.textContent = '🔇';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', entry.kind === 'reel' ? 'Turn sound on for this reel' : 'Turn sound on for this event');
    button.title = entry.kind === 'reel' ? 'Turn reel sound on' : 'Play event music';
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (entry.kind === 'reel') toggleVideo(entry);
      else toggleAudio(entry);
    });
    entry.soundButton = button;
    slide.appendChild(button);
  }

  function addPlayFallback(slide, entry) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'event-media-play';
    button.setAttribute('data-event-media-control', 'true');
    button.textContent = 'Tap to play reel';
    button.hidden = true;
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      playVideo(entry, false);
    });
    entry.playFallback = button;
    slide.appendChild(button);
  }

  function createFallback(event) {
    var wrap = document.createElement('div');
    wrap.className = 'event-media-fallback';
    var icon = document.createElement('span');
    icon.textContent = '🎧';
    var title = document.createElement('span');
    title.textContent = safeTitle(event && (event.dj || event.title), 'HOD event');
    wrap.appendChild(icon);
    wrap.appendChild(title);
    return wrap;
  }

  function indexForTrack(track) {
    return Math.max(0, Math.min(track.children.length - 1,
      Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))));
  }

  function buildCarousel(event, fallbackBuilder) {
    if (typeof document === 'undefined') return null;
    var normalized = normalizeEvent(event);
    var images = [];
    if (Array.isArray(normalized.images)) {
      images = normalized.images.filter(function (value) {
        return typeof value === 'string' &&
          (value.indexOf('data:') === 0 || /^https?:\/\//i.test(value));
      });
    }
    if (!images.length && normalized.image &&
        (String(normalized.image).indexOf('data:') === 0 || /^https?:\/\//i.test(String(normalized.image)))) {
      images = [normalized.image];
    }
    var reels = normalized.reels || [];
    if (!images.length && !reels.length) {
      var oldFallback = fallbackBuilder ? fallbackBuilder(event) : createFallback(event);
      var single = document.createElement('div');
      single.className = 'poster-carousel event-media-carousel event-media-static';
      single.appendChild(oldFallback || createFallback(event));
      if (normalized.music) {
        var fallbackEntry = {
          kind: 'poster',
          root: single,
          slide: single,
          music: normalized.music,
          title: safeTitle(normalized.title, 'Event music'),
          musicStart: 0,
          musicClip: 0,
          selected: true,
          rootVisible: false,
          playing: false
        };
        addSoundButton(single, fallbackEntry);
        single._hodMediaEntries = [fallbackEntry];
        entries.push(fallbackEntry);
        registerRoot(single);
      }
      return single;
    }

    var wrap = document.createElement('div');
    wrap.className = 'poster-carousel event-media-carousel';
    var track = document.createElement('div');
    track.className = 'pc-track event-media-track';
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', safeTitle(normalized.title, 'Event media'));
    var dots = document.createElement('div');
    dots.className = 'pc-dots event-media-dots';
    var slides = [];
    var mediaEntries = [];

    function addSlide(kind, source, position) {
      var slide = document.createElement('div');
      slide.className = 'pc-slide event-media-slide';
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-label', (position + 1) + ' of ' + (images.length + reels.length));
      var entry = {
        kind: kind,
        root: wrap,
        slide: slide,
        music: kind === 'poster' ? normalized.music : null,
        reel: kind === 'reel' ? source : null,
        title: kind === 'reel' ? source.title : safeTitle(normalized.title, 'Event music'),
        musicStart: 0,
        musicClip: 0,
        selected: false,
        rootVisible: false,
        playing: false
      };
      if (kind === 'poster') {
        var image = document.createElement('img');
        image.loading = position === 0 ? 'eager' : 'lazy';
        image.decoding = 'async';
        image.src = source;
        image.alt = safeTitle(normalized.title, 'Event poster') + (images.length > 1 ? ' ' + (position + 1) : '');
        slide.appendChild(image);
        if (normalized.music) addSoundButton(slide, entry);
      } else {
        entry.videoHost = document.createElement('div');
        entry.videoHost.className = 'event-reel-host';
        var poster = document.createElement('div');
        poster.className = 'event-reel-placeholder';
        var reelTitle = document.createElement('span');
        reelTitle.textContent = source.title;
        poster.appendChild(reelTitle);
        entry.videoHost.appendChild(poster);
        slide.appendChild(entry.videoHost);
        addSoundButton(slide, entry);
        addPlayFallback(slide, entry);
      }
      track.appendChild(slide);
      slides.push(slide);
      mediaEntries.push(entry);
      entries.push(entry);
    }

    images.forEach(function (src, index) { addSlide('poster', src, index); });
    reels.forEach(function (reel, index) { addSlide('reel', reel, images.length + index); });

    function paint(index) {
      Array.prototype.forEach.call(dots.children, function (dot, dotIndex) {
        dot.className = 'pc-dot event-media-dot' + (dotIndex === index ? ' on' : '');
        dot.setAttribute('aria-current', dotIndex === index ? 'true' : 'false');
      });
      Array.prototype.forEach.call(slides, function (slide, slideIndex) {
        slide.setAttribute('aria-hidden', slideIndex === index ? 'false' : 'true');
      });
    }

    var current = 0;
    mediaEntries[0].selected = true;
    function select(index, shouldScroll) {
      if (shouldScroll === undefined) shouldScroll = true;
      index = Math.max(0, Math.min(slides.length - 1, index));
      if (index !== current) {
        mediaEntries[current].selected = false;
        stopEntry(mediaEntries[current]);
      }
      current = index;
      mediaEntries[current].selected = true;
      paint(index);
      if (shouldScroll) {
        try { track.scrollTo({left: index * track.clientWidth, behavior: 'smooth'}); }
        catch (_) { track.scrollLeft = index * track.clientWidth; }
      }
      var selected = mediaEntries[index];
      if (selected.kind === 'reel') maybeStartSelected(selected, true);
      else if (soundPreference && selected.music && !active) startAudio(selected, false);
    }

    images.concat(reels).forEach(function (_, index) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pc-dot event-media-dot' + (index === 0 ? ' on' : '');
      dot.setAttribute('data-event-media-control', 'true');
      dot.setAttribute('aria-label', 'Show media ' + (index + 1));
      dot.setAttribute('aria-current', index === 0 ? 'true' : 'false');
      dot.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        select(index, true);
      });
      dots.appendChild(dot);
    });

    function arrow(label, direction, className) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pc-arrow ' + className;
      button.textContent = direction < 0 ? '‹' : '›';
      button.setAttribute('data-event-media-control', 'true');
      button.setAttribute('aria-label', label);
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        select(current + direction, true);
      });
      return button;
    }

    wrap.appendChild(track);
    if (slides.length > 1) {
      wrap.appendChild(dots);
      wrap.appendChild(arrow('Previous media', -1, 'pc-prev'));
      wrap.appendChild(arrow('Next media', 1, 'pc-next'));
    }

    var scrollTimer = null;
    track.addEventListener('scroll', function () {
      var scrollingTo = indexForTrack(track);
      if (scrollingTo !== current) stopEntry(mediaEntries[current]);
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        var next = indexForTrack(track);
        if (next !== current) select(next, false);
        else paint(current);
      }, 80);
    }, {passive: true});

    wrap._hodMediaEntries = mediaEntries;
    wrap._hodMediaSelect = select;
    paint(0);
    registerRoot(wrap);
    return wrap;
  }

  function registerRoot(rootNode) {
    if (!rootNode) return;
    rootNode._hodMediaVisibilityKnown = false;
    rootNode._hodMediaVisible = false;
    (rootNode._hodMediaEntries || []).forEach(function (entry) {
      entry.rootVisible = false;
    });
    if (typeof IntersectionObserver !== 'undefined') {
      var io = new IntersectionObserver(function (records) {
        records.forEach(function (record) {
          setRootVisibility(rootNode, record.isIntersecting === true);
        });
      }, {threshold: 0.05});
      io.observe(rootNode);
      rootNode._hodMediaIntersection = io;
    }
    startObservers();
    // IntersectionObserver is not available in a few embedded browsers.  Do
    // not autoplay while detached; after the caller mounts the root, this
    // fallback still requires a non-zero visible box.
    if (typeof IntersectionObserver === 'undefined' && typeof setTimeout === 'function') {
      setTimeout(function () {
        if (!rootNode._hodMediaVisibilityKnown && rootIsVisible(rootNode)) {
          setRootVisibility(rootNode, true);
        }
      }, 0);
    }
  }

  function unregisterRoot(rootNode) {
    if (!rootNode) return;
    if (pausedOwner && pausedOwner.root === rootNode) pausedOwner = null;
    rootNode._hodMediaVisibilityKnown = true;
    rootNode._hodMediaVisible = false;
    (rootNode._hodMediaEntries || []).forEach(function (entry) {
      entry.rootVisible = false;
      stopEntry(entry);
      var at = entries.indexOf(entry);
      if (at >= 0) entries.splice(at, 1);
    });
    if (rootNode._hodMediaIntersection) {
      try { rootNode._hodMediaIntersection.disconnect(); } catch (_) {}
    }
  }

  function maybeStartSelected(entry, force) {
    if (!entry || !entry.selected || !entry.rootVisible || !rootIsVisible(entry.root)) return;
    if (active && !force) return;
    if (entry.kind === 'reel') playVideo(entry, false);
    else if (soundPreference && entry.music) startAudio(entry, false);
  }

  function setRootVisibility(rootNode, visible) {
    if (!rootNode) return;
    rootNode._hodMediaVisibilityKnown = true;
    rootNode._hodMediaVisible = visible === true;
    var rootEntries = rootNode._hodMediaEntries || [];
    rootEntries.forEach(function (entry) { entry.rootVisible = visible === true; });
    if (!visible) {
      if (active && active.root === rootNode) pausedOwner = active;
      rootEntries.forEach(function (entry) {
        if (entry.playing || active === entry || entry.pendingPlayToken) stopEntry(entry);
      });
      return;
    }

    // A hidden-page/offscreen owner gets first refusal on re-entry.  If the
    // user selected a different carousel while it was hidden, that explicit
    // selection will have replaced pausedOwner.
    if (pausedOwner && pausedOwner.root === rootNode) {
      var owner = pausedOwner;
      pausedOwner = null;
      if (owner.selected) {
        if (owner.kind === 'reel') playVideo(owner, false);
        else if (owner.music && soundPreference) startAudio(owner, false);
      }
      return;
    }
    if (!active && !pausedOwner) {
      rootEntries.some(function (entry) {
        if (!entry.selected) return false;
        maybeStartSelected(entry);
        return entry.kind === 'reel' && active === entry;
      });
    }
  }

  function startObservers() {
    if (observerStarted || typeof document === 'undefined') return;
    observerStarted = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') stopAll(true);
      else if (pausedOwner) {
        var owner = pausedOwner;
        if (owner.root && owner.root._hodMediaVisible === true) {
          pausedOwner = null;
          if (owner.selected) {
            if (owner.kind === 'reel') playVideo(owner, false);
            else if (owner.music && soundPreference) startAudio(owner, false);
          }
        }
      }
    });
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      mutationObserver = new MutationObserver(function () {
        entries.slice().forEach(function (entry) {
          if (!entry.root || !entry.root.isConnected) {
            unregisterRoot(entry.root);
          }
        });
      });
      mutationObserver.observe(document.documentElement, {childList: true, subtree: true});
    }
    if (root && root.addEventListener) {
      root.addEventListener('pagehide', stopAll);
      root.addEventListener('beforeunload', stopAll);
    }
  }

  function unregisterDetached() {
    entries.slice().forEach(function (entry) {
      if (!entry.root || !entry.root.isConnected) unregisterRoot(entry.root);
    });
  }

  return {
    MAX_REELS: MAX_REELS,
    normalizeEvent: normalizeEvent,
    normalizeMusic: normalizeMusic,
    normalizeReel: normalizeReel,
    isFirebaseMediaUrl: firebaseMediaUrl,
    buildCarousel: buildCarousel,
    stopAll: stopAll,
    stopEntry: stopEntry,
    setRootVisibility: setRootVisibility,
    unregisterDetached: unregisterDetached,
    _getSoundPreference: function () { return soundPreference; },
    _getActive: function () { return active; }
  };
}));