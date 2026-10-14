/**
 * audio.js - Web Audio API による完全プロシージャル音源
 * 外部音声ファイルに依存せず、ぷよぷよの操作音、設置音、ちぎり音、
 * 破裂音、連鎖アルペジオ、全消しジングルなどをリアルタイム合成します。
 */

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.isMuted = false;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.initialized = true;
        } catch (e) {
            console.warn('Web Audio API not supported', e);
        }
    }

    resume() {
        if (!this.initialized) {
            this.init();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        return this.isMuted;
    }

    // 移動音（ピピッ/カチッとした軽快な音）
    playMove() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
    }

    // 回転音（シュッ/クルッとした効果音）
    playRotate() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(1040, now + 0.06);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.07);
    }

    // ぷよ接地音（もっちりとしたポヨン音）
    playLand() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(130, now + 0.08);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.11);
    }

    // ちぎり落下音（ヒュンッ）
    playChigiri() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.09);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.1);
    }

    // ぷよが消えるときのポップ・破裂音（泡が弾けるプチッ！シュパッ！）
    playPop(chainCount = 1) {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;

        // ノイズバースト（破裂感）
        const bufferSize = this.ctx.sampleRate * 0.08;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(1800, now);
        noiseFilter.Q.setValueAtTime(3, now);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.3, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        // トーン成分（キラリ感）
        const osc = this.ctx.createOscillator();
        const toneGain = this.ctx.createGain();
        osc.type = 'sine';
        const baseFreq = 500 + Math.min(chainCount * 80, 800);
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.5, now + 0.08);

        toneGain.gain.setValueAtTime(0.25, now);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(toneGain);
        toneGain.connect(this.ctx.destination);

        noise.start(now);
        osc.start(now);
        noise.stop(now + 0.08);
        osc.stop(now + 0.08);
    }

    // 連鎖ボイス風アルペジオ＆チャイム（連鎖数に応じて音階が上昇・豪華に）
    playChain(chainCount) {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;

        // 連鎖音階（ド・レ・ミ・ファ・ソ・ラ・シ・ド…＋倍音）
        const scale = [
            261.63, // C4 (1連鎖)
            293.66, // D4 (2連鎖)
            329.63, // E4 (3連鎖)
            349.23, // F4 (4連鎖)
            392.00, // G4 (5連鎖)
            440.00, // A4 (6連鎖)
            493.88, // B4 (7連鎖)
            523.25, // C5 (8連鎖)
            587.33, // D5 (9連鎖)
            659.25, // E5 (10連鎖)
            698.46, // F5 (11連鎖)
            783.99, // G5 (12連鎖)
            880.00, // A5 (13連鎖)
            987.77, // B5 (14連鎖)
            1046.50 // C6 (15連鎖~)
        ];

        const idx = Math.min(chainCount - 1, scale.length - 1);
        const rootFreq = scale[Math.max(0, idx)];

        // 主音
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = chainCount >= 5 ? 'triangle' : 'sine';
        osc1.frequency.setValueAtTime(rootFreq, now);

        // 3度または5度上のハーモニー
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        const harmonyFreq = rootFreq * 1.5; // 5度上
        osc2.frequency.setValueAtTime(harmonyFreq, now + 0.04);

        // 高連鎖時のオクターブ上キラキラ
        let osc3 = null, gain3 = null;
        if (chainCount >= 3) {
            osc3 = this.ctx.createOscillator();
            gain3 = this.ctx.createGain();
            osc3.type = 'sine';
            osc3.frequency.setValueAtTime(rootFreq * 2, now + 0.08);
            gain3.gain.setValueAtTime(0.15, now + 0.08);
            gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc3.connect(gain3);
            gain3.connect(this.ctx.destination);
            osc3.start(now + 0.08);
            osc3.stop(now + 0.45);
        }

        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        gain2.gain.setValueAtTime(0.2, now + 0.04);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);

        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.4);
        osc2.start(now + 0.04);
        osc2.stop(now + 0.4);
    }

    // 全消しジングル（華やかなファンファーレ）
    playAllClear() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C - E - G - C

        notes.forEach((freq, i) => {
            const time = now + i * 0.1;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, time);

            const duration = (i === notes.length - 1) ? 0.6 : 0.15;
            gain.gain.setValueAtTime(0.25, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(time);
            osc.stop(time + duration);
        });
    }

    // ゲームオーバー音（下降する悲しいポヨヨン音）
    playGameOver() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.6);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.7);
    }

    // 勝利ファンファーレ音（ド・ミ・ソ・高音ドの明るい祝賀和音）
    playVictory() {
        if (this.isMuted || !this.ctx) return;
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const startTime = now + i * 0.12;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.28, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + 0.85);
        });
    }
}

window.soundEngine = new SoundEngine();
