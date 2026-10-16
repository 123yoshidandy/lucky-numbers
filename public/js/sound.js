/**
 * 効果音と BGM（音声ファイルは使わず、Web Audio API でその場で合成する）
 *
 * - ブラウザの自動再生の制限があるので、最初のタップ（unlock）までは鳴らさない
 * - 効果音と BGM の ON/OFF は localStorage に保存する（初めは両方 ON）
 * - 別のタブを見ている間は、音を止める
 *
 * 音色を素材の音声ファイルに差し替えるときは、このファイルの中身だけを変えればよい
 * （画面からは playEffect(名前, 数字, { delay, quiet }) と、設定の関数だけを使う）
 */

const SETTINGS_KEY = 'lucky-numbers.sound';
const LOOKAHEAD_SEC = 0.4;  // BGM はこの先の分まで、前もって予約する
const SCHEDULE_MS = 120;    // 予約を確かめる間隔
const VOLUME = { master: 0.8, effects: 0.7, bgm: 0.16 };
const QUIET = 0.5;          // 相手や CPU の手の効果音は、少し小さくする

let context = null;
let master = null;
let effectsGain = null;
let bgmGain = null;
let noiseBuffer = null;
let settings = loadSettings();
let bgm = null; // 流している BGM の予約の状態
const listeners = new Set();

// ===== 設定 =====

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        return { effects: saved?.effects ?? true, bgm: saved?.bgm ?? true };
    } catch {
        return { effects: true, bgm: true };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // 保存できなくても、このページを開いている間は切り替えが効く
    }
}

export function getSoundSettings() {
    return { ...settings };
}

// 設定が変わったら知らせる（ボタンの表示を合わせるため）
export function onSoundSettingsChange(listener) {
    listeners.add(listener);
}

export function toggleSound(kind) {
    settings = { ...settings, [kind]: !settings[kind] };
    saveSettings();
    if (kind === 'bgm') settings.bgm ? startBgm() : stopBgm();
    listeners.forEach(listener => listener(getSoundSettings()));
}

// ===== 初期化 =====

// ユーザー操作の中で呼ぶ（タップのたびに呼んでよい）。止まっていれば再開する
export function unlockSound() {
    if (!context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        context = new AudioContextClass();
        master = gainNode(VOLUME.master, context.destination);
        effectsGain = gainNode(VOLUME.effects, master);
        bgmGain = gainNode(VOLUME.bgm, master);
        noiseBuffer = createNoise();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) context.suspend();
            else context.resume();
        });
    }
    if (context.state === 'suspended' && !document.hidden) context.resume();
    if (settings.bgm && !bgm) startBgm();
}

function gainNode(value, destination) {
    const node = context.createGain();
    node.gain.value = value;
    node.connect(destination);
    return node;
}

function createNoise() {
    const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}

// ===== 音色 =====

const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);

// クローバーの数字（1〜20）を音の高さにする：ハ長調の白鍵を F3 から順に並べる（1 が低く、20 が高い）
const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];
const SCALE = (() => {
    const notes = [];
    for (let midi = 53; notes.length < 20; midi++) {
        if (WHITE_KEYS.includes(midi % 12)) notes.push(midi);
    }
    return notes;
})();
const numberToFreq = (number) => midiToFreq(SCALE[Math.min(19, Math.max(0, number - 1))]);

// 音量の包絡（すぐ立ち上がって、指数的に消える）
function envelope(gain, time, peak, decay) {
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
}

function tone({ freq, time, type = 'sine', peak, decay, destination }) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    envelope(gain, time, peak, decay);
    osc.connect(gain).connect(destination);
    osc.start(time);
    osc.stop(time + decay + 0.05);
}

// 木琴風：基音と、すぐ消える高い倍音
function marimba(freq, time, volume, destination) {
    tone({ freq, time, peak: 0.5 * volume, decay: 0.7, destination });
    tone({ freq: freq * 4, time, peak: 0.12 * volume, decay: 0.08, destination });
}

// ベル（オルゴール）風：基音と、ずれた倍音を長めに響かせる
function bell(freq, time, volume, destination, decay = 1.4) {
    tone({ freq, time, peak: 0.35 * volume, decay, destination });
    tone({ freq: freq * 2.76, time, peak: 0.08 * volume, decay: decay * 0.5, destination });
    tone({ freq: freq * 5.4, time, peak: 0.03 * volume, decay: decay * 0.25, destination });
}

// 帯域を絞った雑音（めくる音・置く音）
function noise({ time, duration, from, to, peak, destination, type = 'bandpass' }) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, time);
    filter.frequency.exponentialRampToValueAtTime(to, time + duration);
    const gain = context.createGain();
    envelope(gain, time, peak, duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(time);
    source.stop(time + duration + 0.05);
}

// ===== 効果音 =====

const EFFECTS = {
    // 山札から引く：めくる音のあと、その数字の音
    draw(number, time, volume) {
        noise({ time, duration: 0.2, from: 900, to: 3200, peak: 0.25 * volume, destination: effectsGain });
        if (number) marimba(numberToFreq(number), time + 0.32, 0.6 * volume, effectsGain);
    },
    // 場から取る：その数字の短い音
    take(number, time, volume) {
        noise({ time, duration: 0.06, from: 2400, to: 1800, peak: 0.15 * volume, destination: effectsGain });
        marimba(numberToFreq(number), time + 0.05, 0.55 * volume, effectsGain);
    },
    // 庭に置く：着地に合わせて、その数字の音と小さな「ことん」
    place(number, time, volume) {
        marimba(numberToFreq(number), time, volume, effectsGain);
        noise({ time, duration: 0.08, from: 500, to: 200, peak: 0.2 * volume, destination: effectsGain, type: 'lowpass' });
    },
    // 入れ替えで外したタイル：低めに短く
    replaced(number, time, volume) {
        marimba(numberToFreq(number) / 2, time, 0.45 * volume, effectsGain);
    },
    // 場に出す：軽い音
    discard(number, time, volume) {
        noise({ time, duration: 0.1, from: 1400, to: 600, peak: 0.22 * volume, destination: effectsGain });
        marimba(numberToFreq(number), time + 0.02, 0.3 * volume, effectsGain);
    },
    // 自分の番が来た：2音のチャイム
    myTurn(_number, time, volume) {
        bell(midiToFreq(79), time, 0.7 * volume, effectsGain, 1.0);
        bell(midiToFreq(84), time + 0.14, 0.7 * volume, effectsGain, 1.2);
    },
    // 勝った：明るい分散和音
    win(_number, time, volume) {
        [72, 76, 79, 84, 88].forEach((midi, i) => bell(midiToFreq(midi), time + i * 0.11, 0.8 * volume, effectsGain, 1.6));
    },
    // 負けた：静かに下がる3音
    lose(_number, time, volume) {
        [67, 64, 60].forEach((midi, i) => bell(midiToFreq(midi), time + i * 0.22, 0.6 * volume, effectsGain, 1.4));
    }
};

// name の効果音を鳴らす。number はクローバーの数字、delay は秒、quiet は相手や CPU の手
export function playEffect(name, number = null, { delay = 0, quiet = false } = {}) {
    if (!settings.effects || !context || context.state !== 'running') return;
    EFFECTS[name]?.(number, context.currentTime + delay, quiet ? QUIET : 1);
}

// ===== BGM =====

// ハ長調・84 BPM・8小節。メロディのある周と、伴奏だけの周を交互に繰り返す
const BPM = 84;
const BEAT = 60 / BPM;
const CHORDS = [ // 各小節の和音（MIDI の番号。根音、3度、5度）
    [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50],
    [48, 52, 55], [40, 43, 47], [41, 45, 48], [43, 47, 50]
];
const MELODY = [ // 各小節の [音, 拍]。null は休み
    [[76, 1], [79, 1], [76, 0.5], [74, 0.5], [72, 1]],
    [[69, 1], [72, 1], [76, 1.5], [74, 0.5]],
    [[72, 1], [69, 1], [65, 1], [69, 1]],
    [[71, 1], [74, 1], [79, 1.5], [null, 0.5]],
    [[79, 1], [76, 1], [72, 0.5], [74, 0.5], [76, 1]],
    [[79, 1], [71, 1], [76, 2]],
    [[77, 1], [76, 0.5], [74, 0.5], [72, 1], [69, 1]],
    [[71, 1], [74, 1], [72, 2]]
];
const LOOP_BEATS = CHORDS.length * 4;

// 1周分の音を、拍の位置つきで並べる（withMelody が false なら伴奏だけ）
function loopEvents(withMelody) {
    const events = [];
    CHORDS.forEach(([root, third, fifth], bar) => {
        const start = bar * 4;
        // 低音：小節の頭と3拍目に根音
        events.push({ beat: start, play: (t) => tone({ freq: midiToFreq(root - 12), time: t, peak: 0.5, decay: BEAT * 1.8, destination: bgmGain }) });
        events.push({ beat: start + 2, play: (t) => tone({ freq: midiToFreq(root - 12), time: t, peak: 0.35, decay: BEAT * 1.6, destination: bgmGain }) });
        // 分散和音：8分音符で 根音・5度・オクターブ・3度
        [root, fifth, root + 12, third + 12].forEach((midi, i) => {
            [0, 2].forEach(offset => {
                events.push({ beat: start + offset + i * 0.5, play: (t) => tone({ freq: midiToFreq(midi), time: t, type: 'triangle', peak: 0.16, decay: BEAT * 0.9, destination: bgmGain }) });
            });
        });
        if (!withMelody) return;
        let beat = start;
        MELODY[bar].forEach(([midi, length]) => {
            if (midi !== null) {
                const at = beat;
                events.push({ beat: at, play: (t) => bell(midiToFreq(midi), t, 0.9, bgmGain, Math.max(0.6, length * BEAT * 1.4)) });
            }
            beat += length;
        });
    });
    return events.sort((a, b) => a.beat - b.beat);
}

const LOOPS = [loopEvents(true), loopEvents(false)];

function startBgm() {
    if (!context || bgm || !settings.bgm) return;
    bgm = { loop: 0, index: 0, loopStart: context.currentTime + 0.1, timer: null };
    bgmGain.gain.cancelScheduledValues(context.currentTime);
    bgmGain.gain.setValueAtTime(0.0001, context.currentTime);
    bgmGain.gain.exponentialRampToValueAtTime(VOLUME.bgm, context.currentTime + 1.5); // ふわっと始める
    scheduleBgm();
    bgm.timer = setInterval(scheduleBgm, SCHEDULE_MS);
}

function stopBgm() {
    if (!bgm) return;
    clearInterval(bgm.timer);
    bgm = null;
    // すでに予約した音は、音量を下げて消す（次に流すときに戻す）
    bgmGain.gain.cancelScheduledValues(context.currentTime);
    bgmGain.gain.setTargetAtTime(0.0001, context.currentTime, 0.15);
}

// この先 LOOKAHEAD_SEC の分の音を予約する
function scheduleBgm() {
    if (!bgm || context.state !== 'running') return;
    const until = context.currentTime + LOOKAHEAD_SEC;
    for (;;) {
        const events = LOOPS[bgm.loop % LOOPS.length];
        if (bgm.index >= events.length) {
            bgm.loopStart += LOOP_BEATS * BEAT;
            bgm.loop++;
            bgm.index = 0;
            continue;
        }
        const event = events[bgm.index];
        const time = bgm.loopStart + event.beat * BEAT;
        if (time > until) break;
        // タブが裏にいた間などで遅れた音は、鳴らさずに飛ばす
        if (time >= context.currentTime - 0.05) event.play(Math.max(time, context.currentTime));
        bgm.index++;
    }
    // 大きく遅れたら（スリープから戻ったときなど）、今の時刻から周を始め直す
    if (bgm.loopStart + LOOP_BEATS * BEAT < context.currentTime) {
        bgm.loopStart = context.currentTime + 0.1;
        bgm.index = 0;
    }
}
