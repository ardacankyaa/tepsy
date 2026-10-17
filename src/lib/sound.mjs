// Yüksek Performanslı, Lazy Singleton Web Audio API Ses Motoru
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
  }

  // Kullanıcı ilk dokunduğunda AudioContext'i ayağa kaldırır (tarayıcı autoplay politikası)
  getContext() {
    if (typeof window === "undefined") return null;
    try {
      if (window.localStorage.getItem("soundEnabled") === "false") return null;
    } catch {
      /* Storage may be unavailable in a restricted browser session. */
    }

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }

    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  // Kısa, zarif ton üretici
  playTone(freq, type = "sine", duration = 0.15, gainVal = 0.1) {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  // 1. Yeni Sipariş Geldi (Mutfak Zil Efekti - Çift Çan)
  playNewOrder() {
    const ctx = this.getContext();
    if (!ctx) return;

    this.playTone(880, "sine", 0.35, 0.15); // A5
    setTimeout(() => {
      this.playTone(1318.5, "sine", 0.45, 0.18); // E6
    }, 120);
  }

  // 2. Sipariş Hazırlandı (Garson Bildirim Zili)
  playReady() {
    const ctx = this.getContext();
    if (!ctx) return;

    this.playTone(659.25, "triangle", 0.2, 0.12);
    setTimeout(() => {
      this.playTone(880, "sine", 0.35, 0.15);
    }, 100);
  }

  // 3. Hesap / Garson Çağrısı (Dikkat Çekici Uyarı)
  playBillRequested() {
    const ctx = this.getContext();
    if (!ctx) return;

    this.playTone(523.25, "sine", 0.2, 0.15);
    setTimeout(() => {
      this.playTone(659.25, "sine", 0.2, 0.15);
    }, 100);
    setTimeout(() => {
      this.playTone(783.99, "sine", 0.35, 0.2);
    }, 200);
  }

  // 4. Kasa Ödeme Alındı (Ka-Ching / Kasa Çekmece Sesi)
  playCash() {
    const ctx = this.getContext();
    if (!ctx) return;

    this.playTone(987.77, "triangle", 0.15, 0.12);
    setTimeout(() => {
      this.playTone(1318.5, "sine", 0.3, 0.15);
    }, 80);
  }
}

const soundEngine = new SoundEngine();
export default soundEngine;
