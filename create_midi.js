/**
 * create_midi.js
 * ぷよぷよ風の軽快でキャッチーなオリジナルBGMのMIDIファイル (Type 0 / 1) を生成するスクリプト
 */

const fs = require('fs');
const path = require('path');

// 可変長数値のエンコード
function writeVarLen(val) {
    const bytes = [];
    bytes.push(val & 0x7f);
    val >>= 7;
    while (val > 0) {
        bytes.unshift((val & 0x7f) | 0x80);
        val >>= 7;
    }
    return Buffer.from(bytes);
}

class MidiTrack {
    constructor() {
        this.events = [];
        this.lastTime = 0;
    }

    addEvent(time, status, ...data) {
        this.events.push({ time, status, data: Buffer.from(data) });
    }

    addMeta(time, metaType, dataBuffer) {
        this.events.push({ time, isMeta: true, metaType, data: dataBuffer });
    }

    build() {
        // 時間順にソート
        this.events.sort((a, b) => a.time - b.time);

        const chunks = [];
        let curTime = 0;

        for (const ev of this.events) {
            const delta = ev.time - curTime;
            curTime = ev.time;
            chunks.push(writeVarLen(delta));

            if (ev.isMeta) {
                chunks.push(Buffer.from([0xff, ev.metaType]));
                chunks.push(writeVarLen(ev.data.length));
                chunks.push(ev.data);
            } else {
                chunks.push(Buffer.from([ev.status]));
                chunks.push(ev.data);
            }
        }

        // End of Track
        chunks.push(writeVarLen(0));
        chunks.push(Buffer.from([0xff, 0x2f, 0x00]));

        const trackData = Buffer.concat(chunks);
        const header = Buffer.alloc(8);
        header.write('MTrk', 0, 'ascii');
        header.writeUInt32BE(trackData.length, 4);

        return Buffer.concat([header, trackData]);
    }
}

function generatePuyoBgm() {
    const ticksPerBeat = 480;
    const track = new MidiTrack();

    // テンポ設定: BPM 148 (マイクロ秒/四分音符 = 60,000,000 / 148 = 405405)
    const tempoVal = Math.round(60000000 / 148);
    const tempoBuf = Buffer.alloc(3);
    tempoBuf.writeUIntBE(tempoVal, 0, 3);
    track.addMeta(0, 0x51, tempoBuf);

    // トラック名
    const nameBuf = Buffer.from('Puyo Puyo Fever Beat', 'ascii');
    track.addMeta(0, 0x03, nameBuf);

    // プログラムチェンジ (音色): Lead (Synth), Bass, Arp
    track.addEvent(0, 0xc0, 80); // Ch 0: Lead Synth
    track.addEvent(0, 0xc1, 38); // Ch 1: Synth Bass
    track.addEvent(0, 0xc2, 81); // Ch 2: Bright Chords

    const t16 = ticksPerBeat / 4; // 16分音符 = 120 ticks
    const t8 = ticksPerBeat / 2;  // 8分音符 = 240 ticks
    const t4 = ticksPerBeat;      // 4分音符 = 480 ticks

    let curTick = 0;

    // 音符ヘルパー
    const note = (ch, pitch, startTick, duration, vel = 90) => {
        track.addEvent(startTick, 0x90 | ch, pitch, vel);
        track.addEvent(startTick + duration, 0x80 | ch, pitch, 0);
    };

    // ドラムヘルパー (Ch 9: MIDIドラム)
    const drum = (pitch, startTick, vel = 100) => {
        track.addEvent(startTick, 0x99, pitch, vel);
        track.addEvent(startTick + t16, 0x89, pitch, 0);
    };

    // ぷよぷよ風メロディパターン (Aマイナー / Cメジャー系の明るく跳ねるモチーフ)
    // ノート番号: C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, B4=71, C5=72, D5=74, E5=76
    const phraseA = [
        // Measure 1
        { n: 72, d: t8 }, { n: 76, d: t8 }, { n: 79, d: t8 }, { n: 76, d: t8 },
        // Measure 2
        { n: 74, d: t16 }, { n: 76, d: t16 }, { n: 74, d: t8 }, { n: 72, d: t4 },
        // Measure 3
        { n: 69, d: t8 }, { n: 72, d: t8 }, { n: 74, d: t8 }, { n: 72, d: t8 },
        // Measure 4
        { n: 71, d: t8 }, { n: 67, d: t8 }, { n: 69, d: t4 },
    ];

    const phraseB = [
        // Measure 5 (駆け上がりサビ風)
        { n: 65, d: t16 }, { n: 69, d: t16 }, { n: 72, d: t16 }, { n: 76, d: t16 },
        { n: 77, d: t8 }, { n: 76, d: t8 },
        // Measure 6
        { n: 74, d: t8 }, { n: 72, d: t8 }, { n: 74, d: t4 },
        // Measure 7
        { n: 76, d: t16 }, { n: 77, d: t16 }, { n: 79, d: t8 }, { n: 81, d: t8 }, { n: 84, d: t8 },
        // Measure 8
        { n: 83, d: t8 }, { n: 79, d: t8 }, { n: 76, d: t8 }, { n: 72, d: t8 }
    ];

    // 全体を2回ループ構成にする (計16小節)
    for (let loop = 0; loop < 2; loop++) {
        const phrases = [phraseA, phraseB];

        for (const phrase of phrases) {
            let pTime = curTick;
            for (const item of phrase) {
                note(0, item.n, pTime, item.d * 0.85, 95);
                // ハーモニー (Ch 2)
                note(2, item.n - 12, pTime, item.d * 0.85, 60);
                pTime += item.d;
            }
        }

        // ベースライン ＆ ドラムス (8小節分 = 32拍)
        const bassNotes = [
            // C -> G -> Am -> F
            60, 60, 55, 55, 57, 57, 53, 53,
            53, 53, 55, 55, 60, 60, 55, 55
        ];

        for (let m = 0; m < 8; m++) {
            const root = bassNotes[m * 2 % bassNotes.length] - 12; // オクターブ下
            const mTick = curTick + m * 4 * ticksPerBeat;

            // スラップベース (オクターブ跳ね)
            for (let b = 0; b < 4; b++) {
                const bTick = mTick + b * ticksPerBeat;
                note(1, root, bTick, t8 * 0.7, 85);
                note(1, root + 12, bTick + t8, t8 * 0.7, 90);

                // ドラムス
                drum(36, bTick, 105);          // バスドラム (ドン)
                drum(42, bTick, 70);           // ハイハット (チッ)
                drum(42, bTick + t8, 75);      // ハイハット
                if (b % 2 === 1) {
                    drum(38, bTick, 100);      // スネア (パンッ)
                }
            }
        }

        curTick += 8 * 4 * ticksPerBeat;
    }

    // MIDIファイル構築
    const trackBuf = track.build();
    const header = Buffer.alloc(14);
    header.write('MThd', 0, 'ascii');
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8); // Format 0
    header.writeUInt16BE(1, 10); // 1 track
    header.writeUInt16BE(ticksPerBeat, 12);

    const midiFile = Buffer.concat([header, trackBuf]);
    return midiFile;
}

const dir = path.join(__dirname, 'assets');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

const midiBuffer = generatePuyoBgm();
fs.writeFileSync(path.join(dir, 'puyo_bgm.mid'), midiBuffer);
console.log('Successfully generated assets/puyo_bgm.mid (' + midiBuffer.length + ' bytes)');
