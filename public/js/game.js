/**
 * ラッキーナンバーのゲームの進行
 * DOMに依存しないので、ブラウザ（ローカル対戦）とサーバー（オンライン対戦）の両方で使う
 * 受け付けた操作を commands に記録し、Game.replay で同じゲームを再現できる
 *
 * ルール
 * - 1〜20 の数字タイルをプレイヤーの人数分使う。各自 4×4 の庭を持つ
 * - 最初に4枚引き、小さい順に左上から右下への斜めに置く
 * - 手番では「山札から1枚引く」か「場（表向き）から1枚取る」
 *   - 引いたタイルは庭に置くか、場に捨てる。場から取ったタイルは必ず庭に置く
 *   - 空いたマスに置くか、置いてあるタイルと入れ替える（入れ替えたタイルは場に出す）
 *   - 庭の各行は左から右へ、各列は上から下へ、数字が大きくなるように置く（同じ数字は並べられない）
 * - 庭の16マスを最初に埋めた人の勝ち。山札がなくなったら、庭のタイルが一番多い人の勝ち
 */

import { createRandom, createSeed, shuffle } from './random.js';

export const SIZE = 4;
export const MAX_NUMBER = 20;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
const MAX_LOGS = 200;

const emptyGarden = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

// 庭の (row, col) に number を置けるか（置いてあるタイルとの入れ替えも含む）
export function canPlace(garden, row, col, number) {
    for (let i = 0; i < SIZE; i++) {
        const inRow = garden[row][i];
        if (i !== col && inRow !== null && (i < col ? inRow >= number : inRow <= number)) return false;
        const inCol = garden[i][col];
        if (i !== row && inCol !== null && (i < row ? inCol >= number : inCol <= number)) return false;
    }
    return true;
}

// number を置けるマスの一覧
export function validPlacements(garden, number) {
    const cells = [];
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            if (canPlace(garden, row, col, number)) cells.push({ row, col });
        }
    }
    return cells;
}

export const countTiles = (garden) => garden.flat().filter(number => number !== null).length;

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export default class Game {
    // players: [{ name, isCPU }]
    constructor(players, { seed = createSeed() } = {}) {
        if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
            throw new Error(`${MIN_PLAYERS}〜${MAX_PLAYERS}人で遊んでください`);
        }
        this.seed = seed;
        this.random = createRandom(seed);
        // proxy: 部屋を出た人の代わりに CPU が打っている
        this.players = players.map(({ name, isCPU }, id) => ({ id, name, isCPU: Boolean(isCPU), proxy: false, garden: emptyGarden() }));
        this.pool = [];       // 山札（裏向き。末尾から引く）
        this.table = [];      // 場（表向き）
        this.holding = null;  // 手番の人が持っているタイル { number, from: 'pool' | 'table' }
        this.currentPlayerIndex = 0;
        this.phase = 'play';  // play / end
        this.commands = [];   // 受け付けた操作の記録
        this.logs = [];
        this.result = null;   // { winnerIds, reason: 'complete' | 'poolEmpty' }
        this.lastError = null;
        this.setup();
    }

    setup() {
        const numbers = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1);
        this.pool = shuffle(this.players.flatMap(() => numbers), this.random);

        // 4枚ずつ引いて、小さい順に斜めに置く
        this.players.forEach(player => {
            const drawn = this.pool.splice(-SIZE).sort((a, b) => a - b);
            drawn.forEach((number, i) => { player.garden[i][i] = number; });
        });
        this.currentPlayerIndex = Math.floor(this.random() * this.players.length);
        this.log(`ゲーム開始。最初は${this.getCurrentPlayer().name}の番です`);
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    // ===== 操作 =====

    // playerId のプレイヤーの操作を受け付ける。受け付けたら true、できなければ lastError に理由を入れて false
    applyCommand(playerId, command) {
        this.lastError = null;
        if (this.phase !== 'play') return this.reject('ゲームは終わっています');
        // 部屋を出た人の手番は、CPU が代わりに打つ（手番に関係なく受け付ける）
        if (command?.type === 'proxy') {
            const player = this.players[playerId];
            if (!player || player.proxy) return this.reject('代わりに打てる人ではありません');
            player.proxy = true;
            this.commands.push({ playerId, type: 'proxy' });
            this.log(`${player.name}が抜けたので、CPU が代わりに打ちます`);
            return true;
        }
        if (playerId !== this.currentPlayerIndex) return this.reject('あなたの番ではありません');

        // 記録には操作に必要な項目だけを残す
        let accepted;
        let recorded;
        switch (command?.type) {
            case 'draw':
            case 'discard':
                recorded = { type: command.type };
                accepted = command.type === 'draw' ? this.draw() : this.discard();
                break;
            case 'take':
                recorded = { type: 'take', index: command.index };
                accepted = this.take(command.index);
                break;
            case 'place':
                recorded = { type: 'place', row: command.row, col: command.col };
                accepted = this.place(command.row, command.col);
                break;
            default:
                accepted = this.reject('不明な操作です');
        }
        if (accepted) this.commands.push({ playerId, ...recorded });
        return accepted;
    }

    draw() {
        if (this.holding) return this.reject('持っているタイルを先に置いてください');
        if (this.pool.length === 0) return this.reject('山札がありません');
        this.holding = { number: this.pool.pop(), from: 'pool' };
        this.log(`${this.getCurrentPlayer().name}が山札から ${this.holding.number} を引きました`);
        return true;
    }

    take(index) {
        if (this.holding) return this.reject('持っているタイルを先に置いてください');
        if (!isInt(index, 0, this.table.length - 1)) return this.reject('そのタイルはありません');
        const number = this.table[index];
        // 場から取ったタイルは必ず置くので、置ける場所がなければ取れない
        if (validPlacements(this.getCurrentPlayer().garden, number).length === 0) {
            return this.reject(`${number} を置ける場所がありません`);
        }
        this.table.splice(index, 1);
        this.holding = { number, from: 'table' };
        this.log(`${this.getCurrentPlayer().name}が場から ${number} を取りました`);
        return true;
    }

    place(row, col) {
        if (!this.holding) return this.reject('先にタイルを引くか取ってください');
        if (!isInt(row, 0, SIZE - 1) || !isInt(col, 0, SIZE - 1)) return this.reject('そのマスはありません');
        const player = this.getCurrentPlayer();
        const { number } = this.holding;
        if (!canPlace(player.garden, row, col, number)) {
            return this.reject('行は左から右へ、列は上から下へ大きくなるように置いてください');
        }

        const replaced = player.garden[row][col];
        player.garden[row][col] = number;
        this.holding = null;
        if (replaced === null) {
            this.log(`${player.name}が ${number} を置きました`);
        } else {
            this.table.push(replaced);
            this.log(`${player.name}が ${replaced} を ${number} に入れ替えました`);
        }
        this.endTurn();
        return true;
    }

    discard() {
        if (!this.holding) return this.reject('先にタイルを引いてください');
        if (this.holding.from !== 'pool') return this.reject('場から取ったタイルは庭に置いてください');
        this.table.push(this.holding.number);
        this.log(`${this.getCurrentPlayer().name}が ${this.holding.number} を場に出しました`);
        this.holding = null;
        this.endTurn();
        return true;
    }

    endTurn() {
        const player = this.getCurrentPlayer();
        if (countTiles(player.garden) === SIZE * SIZE) {
            this.finish([player.id], 'complete');
            this.log(`${player.name}が庭を完成させました！`);
            return;
        }
        if (this.pool.length === 0) {
            const counts = this.players.map(p => countTiles(p.garden));
            const best = Math.max(...counts);
            const winnerIds = this.players.filter((_, i) => counts[i] === best).map(p => p.id);
            this.finish(winnerIds, 'poolEmpty');
            this.log('山札がなくなりました');
            return;
        }
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }

    finish(winnerIds, reason) {
        this.phase = 'end';
        this.result = { winnerIds, reason };
    }

    // ===== 補助 =====

    reject(message) {
        this.lastError = message;
        return false;
    }

    log(message) {
        this.logs.push(message);
        if (this.logs.length > MAX_LOGS) this.logs.shift();
    }

    // 参加者・オプション・操作の記録からゲームを再現する
    static replay(players, options, commands) {
        const game = new Game(players, options);
        commands.forEach(({ playerId, ...command }, index) => {
            if (!game.applyCommand(playerId, command)) {
                throw new Error(`操作 ${index} を再現できませんでした: ${game.lastError}`);
            }
        });
        return game;
    }
}
