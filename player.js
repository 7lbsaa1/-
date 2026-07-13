/**
 * Clean YouTube Player Enhancement
 * 
 * ما يفعله فعلياً:
 *  - يتحكم بالمشغل عبر YouTube IFrame API (official)
 *  - يطبق CSS خارج iframe (للكلاسات المستقرة فقط)
 *  - يراقب DOM بذكاء (لا subtree:none المكلفة)
 *  - لا setInterval متعددة — RAF واحد فقط
 *  - لا محاولة حقن CSS داخل iframe
 *  - لا كلاسات يوتيوب غير المستقرة (.ytp-ce-*, etc.)
 *
 * ما لا يفعله:
 *  - لا يخفي عناصر داخل iframe (مستحيل بدون injectCSS)
 *  - لا يعتمد على كلاسات يوتيوب الداخلية
 *  - لا يستخدم MutationObserver مع subtree:true على المشغل
 */

(function () {
  'use strict';

  // معرف الفيديو المطلوب تشغيله والمستخرج من الرابط المرسل
  const VIDEO_ID = 'RYPyrVDTZT0'; 

  // ─────────────────────────────────────────────
  // CONFIG — only official YouTube embed params
  // ─────────────────────────────────────────────
  const YT_PARAMS = {
    enablejsapi: 1,
    playsinline: 1,
    rel: 0,           // hide related videos in same-domain embed
    modestbranding: 1, // minimal YouTube logo
    iv_load_policy: 3, // hide video annotations
    cc_load_policy: 0,
    fs: 0,             // hide default fullscreen button
    controls: 0,      // we build our own controls
    showinfo: 0,
    color: 'white',   // progress bar color
    hl: 'en',
    cc_lang_pref: 'en',
    playlist: VIDEO_ID // لتفادي تشغيل فيديوهات عشوائية تالية
  };

  // CSS خارج الـ iframe — فقط للكلاسات المستقرة
  const EXTERNAL_CSS = `
    /* YouTube wraps our iframe in a div — نتحكم بالخارج فقط */
    .ytp-chrome-bottom,
    .ytp-chrome-top {
      display: none !important;
    }
  `;

  // ─────────────────────────────────────────────
  // SINGLETON TIMER — one RAF, not multiple setInterval
  // ─────────────────────────────────────────────
  class SmoothTimer {
    constructor() {
      this._callbacks = [];
      this._id = null;
      this._running = false;
    }

    add(cb, key) {
      if (!this._callbacks.find(c => c.key === key)) {
        this._callbacks.push({ key, cb });
      }
      if (!this._running) this._start();
    }

    remove(key) {
      this._callbacks = this._callbacks.filter(c => c.key !== key);
      if (!this._callbacks.length) this._stop();
    }

    _start() {
      this._running = true;
      const loop = (ts) => {
        if (!this._running) return;
        this._callbacks.forEach(c => {
          try { c.cb(ts); } catch (_) {}
        });
        this._id = requestAnimationFrame(loop);
      };
      this._id = requestAnimationFrame(loop);
    }

    _stop() {
      this._running = false;
      if (this._id) { cancelAnimationFrame(this._id); this._id = null; }
    }
  }

  const timer = new SmoothTimer();

  // ─────────────────────────────────────────────
  // INJECT EXTERNAL CSS (outside iframe)
  // ─────────────────────────────────────────────
  function injectExternalCSS(css) {
    if (document.getElementById('yt-external-css')) return;
    const style = document.createElement('style');
    style.id = 'yt-external-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // PERFORMANCE: single IntersectionObserver on wrapper
  // ─────────────────────────────────────────────
  let _observerInstance = null;
  const _processedNodes = new WeakSet();

  function startSmartObserver() {
    const wrapper = document.getElementById('playerWrapper') ||
                    document.querySelector('.player-wrapper');
    if (!wrapper) return;

    if (_observerInstance) return;

    _observerInstance = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          timer.remove('timeUpdate');
        } else {
          timer.add(window._ytTimeUpdateCb || (() => {}), 'timeUpdate');
        }
      });
    }, {
      threshold: 0,
    });

    _observerInstance.observe(wrapper);
  }

  // ─────────────────────────────────────────────
  // SMART MUTATION OBSERVER
  // ─────────────────────────────────────────────
  function startSmartMutationObserver() {
    const targets = [
      document.getElementById('playerWrapper'),
      document.getElementById('player'),
    ].filter(Boolean);

    if (!targets.length) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (_processedNodes.has(node)) continue;
          _processedNodes.add(node);
        }
      }
    });

    targets.forEach(target => {
      observer.observe(target, {
        childList: true,
      });
    });
  }

  // ─────────────────────────────────────────────
  // YT IFRAME API INIT
  // ─────────────────────────────────────────────
  let _player = null;
  let _ready = false;

  window.onYouTubeIframeAPIReady = function () {
    const container = document.getElementById('player');
    if (!container) return;

    _player = new YT.Player(container, {
      videoId: VIDEO_ID,
      events: {
        onReady: onReady,
        onStateChange: onStateChange,
      },
      playerVars: YT_PARAMS,
    });
  };

  function onReady(event) {
    _ready = true;
    
    const vol = event.target.getVolume();
    if (vol !== undefined) {
      const slider = document.getElementById('volumeSlider');
      if (slider) slider.value = vol;
    }

    startSmartObserver();
    startSmartMutationObserver();
    setupPlayerControls(); // تفعيل أزرار التحكم بعد الجاهزية
  }

  function onStateChange(event) {
    const state = event.data;
    const playPauseBtn = document.getElementById('playPauseBtn');

    if (state === YT.PlayerState.BUFFERING) {
      showSpinner(true);
    } else {
      showSpinner(false);
    }

    if (state === YT.PlayerState.PLAYING) {
      if (playPauseBtn) playPauseBtn.textContent = '⏸';
      timer.add(window._ytTimeUpdateCb || (() => {}), 'timeUpdate');
    } else {
      if (playPauseBtn) playPauseBtn.textContent = '▶';
      timer.remove('timeUpdate');
    }
  }

  function showSpinner(show) {
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.classList.toggle('show', show);
  }

  // ─────────────────────────────────────────────
  // TIME UPDATE CALLBACK
  // ─────────────────────────────────────────────
  window._ytTimeUpdateCb = function () {
    if (!_player || !_ready) return;

    try {
      const current = _player.getCurrentTime();
      const duration = _player.getDuration();
      if (!duration || isNaN(duration)) return;

      const pct = Math.min(100, (current / duration) * 100);

      const progressBar = document.getElementById('progressBar');
      const bufferBar = document.getElementById('bufferBar');
      const timeThumb = document.getElementById('timeThumb');
      const timeDisplay = document.getElementById('timeDisplay');

      if (progressBar) progressBar.style.width = pct + '%';
      if (timeThumb) timeThumb.style.left = pct + '%';

      if (bufferBar) {
        const loaded = _player.getVideoLoadedFraction();
        bufferBar.style.width = (loaded * 100) + '%';
      }

      if (timeDisplay) {
        timeDisplay.innerHTML =
          `${fmt(current)} <span>/</span> ${fmt(duration)}`;
      }
    } catch (_) {}
  };

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  function fmt(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // ─────────────────────────────────────────────
  // ربط أزرار التحكم والواجهة بالـ API
  // ─────────────────────────────────────────────
  function setupPlayerControls() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const muteBtn = document.getElementById('muteBtn');
    const progressContainer = document.getElementById('progressContainer');

    // 1. تشغيل / إيقاف مؤقت
    playPauseBtn.addEventListener('click', () => {
      const state = _player.getPlayerState();
      if (state === YT.PlayerState.PLAYING) {
        _player.pauseVideo();
      } else {
        _player.playVideo();
      }
    });

    // 2. تغيير مستوى الصوت
    volumeSlider.addEventListener('input', (e) => {
      const volumeValue = e.target.value;
      _player.setVolume(volumeValue);
      if (_player.isMuted() && volumeValue > 0) {
        _player.unMute();
        muteBtn.textContent = '🔊';
      }
    });

    // 3. كتم أو تفعيل الصوت
    muteBtn.addEventListener('click', () => {
      if (_player.isMuted()) {
        _player.unMute();
        muteBtn.textContent = '🔊';
        volumeSlider.value = _player.getVolume();
      } else {
        _player.mute();
        muteBtn.textContent = '🔇';
        volumeSlider.value = 0;
      }
    });

    // 4. الانتقال لوقت محدد عبر النقر على شريط التقدم
    progressContainer.addEventListener('click', (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const clickPercentage = clickX / width;
      const duration = _player.getDuration();
      
      if (duration && !isNaN(duration)) {
        const seekTime = clickPercentage * duration;
        _player.seekTo(seekTime, true);
      }
    });
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────
  function init() {
    injectExternalCSS(EXTERNAL_CSS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // جلب مكتبة API الخاصة بـ Youtube رسمياً إذا لم تكن موجودة
  if (!window.YT || !window.YT.Player) {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  } else {
    window.onYouTubeIframeAPIReady();
  }

})();
