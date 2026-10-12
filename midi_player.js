/**
 * midi_player.js - Web Audio API による Standard MIDI File (.mid) プレイヤー
 * ぷよぷよ風オリジナルチップチューンBGMをリアルタイム合成・ループ再生します。
 */

// 埋め込みBase64 MIDIデータ (assets/puyo_bgm.mid)
const EMBEDDED_PUYO_MIDI = "TVRoZAAAAAYAAAABAeBNVHJrAAAPTAD/UQMGL50A/wMUUHV5byBQdXlvIEZldmVyIEJlYXQAwFAAwSYAwlEAkEhfAJI8PACQQV8AkjU8AJEwVQCZJGkAmSpGZoBBAACCNQASkEVfAJI5PACJJAAAiSoAMIEwACSASAAAgjwAEoBFAACCOQASkExfAJJAPACQSF8Akjw8AJE8WgCZKktmgEgAAII8ABKQTF8AkkA8AIkqADCBPAAkgEwAAIJAABKATAAAgkAAEpBPXwCSQzwAkE1fAJJBPACRMFUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgTAAJIBPAACCQwAAgE0AAIJBACSQTF8AkkA8AJBMXwCSQDwAkTxaAJkqS3iJKgAwgTwAJIBMAACCQAAAgEwAAIJAACSQSl8Akj48AJBKXwCSPjwAkTBVAJkkaQCZKkZmgEoAAII+ABKQTF8AkkA8AIkkAACJKgAwgTAAJIBKAACCPgASgEwAAIJAABKQSl8Akj48AJBIXwCSPDwAkTxaAJkqS3iJKgAwgTwAJIBKAACCPgAAgEgAAII8ACSQSF8Akjw8AJBKXwCSPjwAkTBVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEwAEiRPFoAmSpLeIkqADCASAAAgjwAAIBKAACCPgAAgTwASJBFXwCSOTwAkExfAJJAPACRK1UAmSRpAJkqRmaATAAAgkAAEpBNXwCSQTwAiSQAAIkqADCBKwAkgEUAAII5ABKATQAAgkEAEpBIXwCSPDwAkE9fAJJDPACRN1oAmSpLeIkqADCBNwAkgEgAAII8AACATwAAgkMAJJBKXwCSPjwAkFFfAJJFPACRK1UAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSsAJIBKAACCPgAAgFEAAIJFACSQSF8Akjw8AJBUXwCSSDwAkTdaAJkqS3iJKgAwgTcAJIBIAACCPAAAgFQAAIJIACSQR18Akjs8AJBTXwCSRzwAkStVAJkkaQCZKkZ4iSQAAIkqADCBKwAkgEcAAII7AACAUwAAgkcAJJBDXwCSNzwAkE9fAJJDPACRN1oAmSpLeIkqADCBNwAkgEMAAII3AACATwAAgkMAJJBFXwCSOTwAkExfAJJAPACRK1UAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSsAJIBMAACCQAAkkEhfAJI8PACRN1oAmSpLeIkqADCARQAAgjkAAIE3ACSASAAAgjwAJJEtVQCZJGkAmSpGeIkkAACJKgAwgS0ASJE5WgCZKkt4iSoAMIE5AEiRLVUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgS0ASJE5WgCZKkt4iSoAMIE5AEiRLVUAmSRpAJkqRniJJAAAiSoAMIEtAEiROVoAmSpLeIkqADCBOQBIkS1VAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEtAEiROVoAmSpLeIkqADCBOQBIkSlVAJkkaQCZKkZ4iSQAAIkqADCBKQBIkTVaAJkqS3iJKgAwgTUASJEpVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKQBIkTVaAJkqS3iJKgAwgTUASJEpVQCZJGkAmSpGeIkkAACJKgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRKVUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRKVUAmSRpAJkqRniJJAAAiSoAMIEpAEiRNVoAmSpLeIkqADCBNQBIkSlVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEpAEiRNVoAmSpLeIkqADCBNQBIkSlVAJkkaQCZKkZ4iSQAAIkqADCBKQBIkTVaAJkqS3iJKgAwgTUASJEpVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKQBIkTVaAJkqS3iJKgAwgTUASJErVQCZJGkAmSpGeIkkAACJKgAwgSsASJE3WgCZKkt4iSoAMIE3AEiRK1UAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSsASJE3WgCZKkt4iSoAMIE3AEiRK1UAmSRpAJkqRniJJAAAiSoAMIErAEiRN1oAmSpLeIkqADCBNwBIkStVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIErAEiRN1oAmSpLeIkqADCBNwBIkTBVAJkkaQCZKkZ4iSQAAIkqADCBMABIkTxaAJkqS3iJKgAwgTwASJEwVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBMABIkTxaAJkqS3iJKgAwgTwASJEwVQCZJGkAmSpGeIkkAACJKgAwgTAASJE8WgCZKkt4iSoAMIE8AEiRMFUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgTAASJE8WgCZKkt4iSoAMIE8AEiRK1UAmSRpAJkqRniJJAAAiSoAMIErAEiRN1oAmSpLeIkqADCBNwBIkStVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIErAEiRN1oAmSpLeIkqADCBNwBIkStVAJkkaQCZKkZ4iSQAAIkqADCBKwBIkTdaAJkqS3iJKgAwgTcASJErVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKwBIkTdaAJkqS3iJKgAwgTcASJBIXwCSPDwAkEFfAJI1PACRMFUAmSRpAJkqRmaAQQAAgjUAEpBFXwCSOTwAiSQAAIkqADCBMAAkgEgAAII8ABKARQAAgjkAEpBMXwCSQDwAkEhfAJI8PACRPFoAmSpLZoBIAACCPAASkExfAJJAPACJKgAwgTwAJIBMAACCQAASgEwAAIJAABKQT18AkkM8AJBNXwCSQTwAkTBVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEwACSATwAAgkMAAIBNAACCQQAkkExfAJJAPACQTF8AkkA8AJE8WgCZKkt4iSoAMIE8ACSATAAAgkAAAIBMAACCQAAkkEpfAJI+PACQSl8Akj48AJEwVQCZJGkAmSpGZoBKAACCPgASkExfAJJAPACJJAAAiSoAMIEwACSASgAAgj4AEoBMAACCQAASkEpfAJI+PACQSF8Akjw8AJE8WgCZKkt4iSoAMIE8ACSASgAAgj4AAIBIAACCPAAkkEhfAJI8PACQSl8Akj48AJEwVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBMABIkTxaAJkqS3iJKgAwgEgAAII8AACASgAAgj4AAIE8AEiQRV8Akjk8AJBMXwCSQDwAkStVAJkkaQCZKkZmgEwAAIJAABKQTV8AkkE8AIkkAACJKgAwgSsAJIBFAACCOQASgE0AAIJBABKQSF8Akjw8AJBPXwCSQzwAkTdaAJkqS3iJKgAwgTcAJIBIAACCPAAAgE8AAIJDACSQSl8Akj48AJBRXwCSRTwAkStVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIErACSASgAAgj4AAIBRAACCRQAkkEhfAJI8PACQVF8Akkg8AJE3WgCZKkt4iSoAMIE3ACSASAAAgjwAAIBUAACCSAAkkEdfAJI7PACQU18Akkc8AJErVQCZJGkAmSpGeIkkAACJKgAwgSsAJIBHAACCOwAAgFMAAIJHACSQQ18Akjc8AJBPXwCSQzwAkTdaAJkqS3iJKgAwgTcAJIBDAACCNwAAgE8AAIJDACSQRV8Akjk8AJBMXwCSQDwAkStVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIErACSATAAAgkAAJJBIXwCSPDwAkTdaAJkqS3iJKgAwgEUAAII5AACBNwAkgEgAAII8ACSRLVUAmSRpAJkqRniJJAAAiSoAMIEtAEiROVoAmSpLeIkqADCBOQBIkS1VAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEtAEiROVoAmSpLeIkqADCBOQBIkS1VAJkkaQCZKkZ4iSQAAIkqADCBLQBIkTlaAJkqS3iJKgAwgTkASJEtVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBLQBIkTlaAJkqS3iJKgAwgTkASJEpVQCZJGkAmSpGeIkkAACJKgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRKVUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRKVUAmSRpAJkqRniJJAAAiSoAMIEpAEiRNVoAmSpLeIkqADCBNQBIkSlVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEpAEiRNVoAmSpLeIkqADCBNQBIkSlVAJkkaQCZKkZ4iSQAAIkqADCBKQBIkTVaAJkqS3iJKgAwgTUASJEpVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKQBIkTVaAJkqS3iJKgAwgTUASJEpVQCZJGkAmSpGeIkkAACJKgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRKVUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSkASJE1WgCZKkt4iSoAMIE1AEiRK1UAmSRpAJkqRniJJAAAiSoAMIErAEiRN1oAmSpLeIkqADCBNwBIkStVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIErAEiRN1oAmSpLeIkqADCBNwBIkStVAJkkaQCZKkZ4iSQAAIkqADCBKwBIkTdaAJkqS3iJKgAwgTcASJErVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKwBIkTdaAJkqS3iJKgAwgTcASJEwVQCZJGkAmSpGeIkkAACJKgAwgTAASJE8WgCZKkt4iSoAMIE8AEiRMFUAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgTAASJE8WgCZKkt4iSoAMIE8AEiRMFUAmSRpAJkqRniJJAAAiSoAMIEwAEiRPFoAmSpLeIkqADCBPABIkTBVAJkkaQCZKkYAmSZkeIkkAACJKgAAiSYAMIEwAEiRPFoAmSpLeIkqADCBPABIkStVAJkkaQCZKkZ4iSQAAIkqADCBKwBIkTdaAJkqS3iJKgAwgTcASJErVQCZJGkAmSpGAJkmZHiJJAAAiSoAAIkmADCBKwBIkTdaAJkqS3iJKgAwgTcASJErVQCZJGkAmSpGeIkkAACJKgAwgSsASJE3WgCZKkt4iSoAMIE3AEiRK1UAmSRpAJkqRgCZJmR4iSQAAIkqAACJJgAwgSsASJE3WgCZKkt4iSoAMIE3AAD/LwA=";

class MidiPlayer {
    constructor() {
        this.ctx = null;
        this.events = [];
        this.totalDurationSec = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.isMuted = false;
        this.volume = 0.35;
        this.masterGain = null;
        this.scheduledNodes = [];
        this.startTime = 0;
        this.pauseOffset = 0;
        this.timerId = null;

        this.init();
    }

    init() {
        // Base64からMIDIバイナリをパース
        try {
            const binary = atob(EMBEDDED_PUYO_MIDI);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            this.parseMidi(bytes.buffer);
        } catch (e) {
            console.error('Failed to parse embedded MIDI', e);
        }
    }

    ensureAudioContext() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
            this.masterGain.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * MIDIバイナリ (Type 0 / 1) の簡易パース
     */
    parseMidi(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let pos = 0;

        // Header chunk "MThd"
        const headerId = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        if (headerId !== 'MThd') throw new Error('Not a MIDI file');

        const headerLength = view.getUint32(4);
        const format = view.getUint16(8);
        const nTracks = view.getUint16(10);
        const timeDivision = view.getUint16(12);

        pos = 8 + headerLength;

        let usPerQuarter = 405405; // デフォルトBPM 148
        const parsedEvents = [];

        // トラックパース
        for (let t = 0; t < nTracks; t++) {
            const trackId = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1), view.getUint8(pos+2), view.getUint8(pos+3));
            const trackLen = view.getUint32(pos + 4);
            pos += 8;
            const trackEnd = pos + trackLen;

            let tick = 0;
            let lastStatus = 0;

            while (pos < trackEnd) {
                // Delta time (variable length)
                let delta = 0;
                while (true) {
                    const b = view.getUint8(pos++);
                    delta = (delta << 7) | (b & 0x7f);
                    if (!(b & 0x80)) break;
                }
                tick += delta;

                let status = view.getUint8(pos);
                if (status & 0x80) {
                    pos++;
                    lastStatus = status;
                } else {
                    status = lastStatus; // Running status
                }

                if (status === 0xff) {
                    // Meta event
                    const metaType = view.getUint8(pos++);
                    let metaLen = 0;
                    while (true) {
                        const b = view.getUint8(pos++);
                        metaLen = (metaLen << 7) | (b & 0x7f);
                        if (!(b & 0x80)) break;
                    }

                    if (metaType === 0x51 && metaLen === 3) {
                        // Set Tempo
                        usPerQuarter = (view.getUint8(pos) << 16) | (view.getUint8(pos+1) << 8) | view.getUint8(pos+2);
                    }
                    pos += metaLen;
                } else if (status === 0xf0 || status === 0xf7) {
                    // SysEx
                    let sysexLen = 0;
                    while (true) {
                        const b = view.getUint8(pos++);
                        sysexLen = (sysexLen << 7) | (b & 0x7f);
                        if (!(b & 0x80)) break;
                    }
                    pos += sysexLen;
                } else {
                    // MIDI Channel voice message
                    const cmd = status >> 4;
                    const ch = status & 0x0f;

                    if (cmd === 0x9 || cmd === 0x8) {
                        const note = view.getUint8(pos++);
                        const vel = view.getUint8(pos++);
                        parsedEvents.push({
                            tick,
                            cmd: (cmd === 0x9 && vel > 0) ? 'noteOn' : 'noteOff',
                            ch,
                            note,
                            vel
                        });
                    } else if (cmd === 0xc || cmd === 0xd) {
                        pos++; // 1 byte param
                    } else {
                        pos += 2; // 2 byte param
                    }
                }
            }
        }

        // tickを秒数に変換
        const secPerTick = (usPerQuarter / 1000000) / timeDivision;
        this.events = [];
        let maxSec = 0;

        // ノートオンとノートオフをペアリング
        const activeNotes = new Map();

        parsedEvents.sort((a, b) => a.tick - b.tick);

        for (const ev of parsedEvents) {
            const timeSec = ev.tick * secPerTick;
            const key = `${ev.ch}_${ev.note}`;

            if (ev.cmd === 'noteOn') {
                activeNotes.set(key, { timeSec, vel: ev.vel, ch: ev.ch, note: ev.note });
            } else if (ev.cmd === 'noteOff') {
                const start = activeNotes.get(key);
                if (start) {
                    const dur = Math.max(0.05, timeSec - start.timeSec);
                    this.events.push({
                        time: start.timeSec,
                        duration: dur,
                        ch: start.ch,
                        note: start.note,
                        vel: start.vel
                    });
                    if (start.timeSec + dur > maxSec) maxSec = start.timeSec + dur;
                    activeNotes.delete(key);
                }
            }
        }

        this.totalDurationSec = maxSec;
        this.events.sort((a, b) => a.time - b.time);
    }

    /**
     * 再生開始
     */
    play() {
        if (this.isMuted) return;
        this.ensureAudioContext();

        if (this.isPlaying && !this.isPaused) return;

        this.isPlaying = true;
        this.isPaused = false;
        this.startTime = this.ctx.currentTime - this.pauseOffset;

        this.scheduleNotes();
    }

    /**
     * 一時停止 (Escキー連動)
     */
    pause() {
        if (!this.isPlaying || this.isPaused) return;
        this.isPaused = true;
        this.pauseOffset = this.ctx.currentTime - this.startTime;
        this.stopScheduledNodes();
        if (this.timerId) clearTimeout(this.timerId);
    }

    /**
     * 停止
     */
    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseOffset = 0;
        this.stopScheduledNodes();
        if (this.timerId) clearTimeout(this.timerId);
    }

    stopScheduledNodes() {
        for (const n of this.scheduledNodes) {
            try { n.stop(); } catch(e) {}
        }
        this.scheduledNodes = [];
    }

    setVolume(val) {
        this.volume = Math.max(0, Math.min(1, val));
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        }
        if (!this.isMuted && !this.isPlaying) {
            this.play();
        }
        return this.isMuted;
    }

    scheduleNotes() {
        if (!this.isPlaying || this.isPaused || !this.ctx) return;

        const now = this.ctx.currentTime;
        const currentMidiTime = now - this.startTime;

        // 次のループ判定
        if (currentMidiTime >= this.totalDurationSec) {
            this.startTime = now;
            this.pauseOffset = 0;
        }

        this.stopScheduledNodes();

        // 1曲分スケジュール
        const offset = now - this.startTime;

        for (const ev of this.events) {
            const noteStart = this.startTime + ev.time;
            if (noteStart >= now - 0.05) {
                this.playSynthNote(ev.ch, ev.note, ev.vel, noteStart, ev.duration);
            }
        }

        // 次回ループ用タイマー
        const remainingTime = (this.totalDurationSec - (this.ctx.currentTime - this.startTime)) * 1000;
        this.timerId = setTimeout(() => {
            if (this.isPlaying && !this.isPaused) {
                this.startTime = this.ctx.currentTime;
                this.scheduleNotes();
            }
        }, Math.max(100, remainingTime - 50));
    }

    /**
     * 各チャンネルのレトロシンセ音を合成
     */
    playSynthNote(ch, note, vel, startTime, duration) {
        const freq = 440 * Math.pow(2, (note - 69) / 12);
        const gainVal = (vel / 127) * 0.4;

        if (ch === 9) {
            // ドラムス (バスドラム / スネア / ハイハット)
            this.playDrumNote(note, gainVal, startTime);
            return;
        }

        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();

        if (ch === 1) {
            // ベース (Ch 1): ノコギリ波 + ローパスフィルター
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(freq, startTime);

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, startTime);
            filter.frequency.exponentialRampToValueAtTime(150, startTime + duration);

            noteGain.gain.setValueAtTime(gainVal * 0.9, startTime);
            noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

            osc.connect(filter);
            filter.connect(noteGain);
        } else if (ch === 2) {
            // アルペジオ / ハーモニー (Ch 2): 三角波 (まろやか)
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            noteGain.gain.setValueAtTime(gainVal * 0.45, startTime);
            noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

            osc.connect(noteGain);
        } else {
            // メインリード (Ch 0): 矩形波 (8bit/16bit調) + 微小ディケイ
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, startTime);

            noteGain.gain.setValueAtTime(gainVal * 0.55, startTime);
            noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

            osc.connect(noteGain);
        }

        noteGain.connect(this.masterGain);

        try {
            osc.start(startTime);
            osc.stop(startTime + duration + 0.05);
            this.scheduledNodes.push(osc);
        } catch (e) {}
    }

    playDrumNote(note, gainVal, startTime) {
        if (note === 36) {
            // バスドラム (ドン)
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(140, startTime);
            osc.frequency.exponentialRampToValueAtTime(35, startTime + 0.08);

            g.gain.setValueAtTime(gainVal * 1.1, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);

            osc.connect(g);
            g.connect(this.masterGain);
            osc.start(startTime);
            osc.stop(startTime + 0.1);
            this.scheduledNodes.push(osc);
        } else if (note === 38) {
            // スネア (パンッ)
            const bufferSize = this.ctx.sampleRate * 0.08;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gainVal * 0.7, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

            noise.connect(g);
            g.connect(this.masterGain);
            noise.start(startTime);
            noise.stop(startTime + 0.08);
            this.scheduledNodes.push(noise);
        } else {
            // ハイハット (チッ)
            const bufferSize = this.ctx.sampleRate * 0.03;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(7000, startTime);

            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gainVal * 0.45, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.03);

            noise.connect(filter);
            filter.connect(g);
            g.connect(this.masterGain);
            noise.start(startTime);
            noise.stop(startTime + 0.03);
            this.scheduledNodes.push(noise);
        }
    }
}

window.midiPlayer = new MidiPlayer();
