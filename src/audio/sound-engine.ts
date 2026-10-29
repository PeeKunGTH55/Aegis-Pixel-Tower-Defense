export class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtor();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    waveType: OscillatorType,
    gainPeak = 0.08
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + durationSec);
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  public playDeploy(): void {
    this.playTone(320, 640, 0.12, "square", 0.07);
  }

  public playAttack(): void {
    this.playTone(520, 240, 0.06, "triangle", 0.04);
  }

  public playSkillCast(): void {
    this.playTone(260, 880, 0.24, "sawtooth", 0.1);
  }

  public playWaveStart(): void {
    this.playTone(220, 440, 0.2, "square", 0.08);
  }

  public playGachaPull(isLegendary: boolean): void {
    if (isLegendary) {
      this.playTone(440, 1120, 0.35, "square", 0.11);
    } else {
      this.playTone(330, 660, 0.18, "triangle", 0.08);
    }
  }
}
