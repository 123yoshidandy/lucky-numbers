import { describe, it, expect } from 'vitest';
import Game, { canPlace, validPlacements, countTiles, SIZE } from '../public/js/game.js';
import { createGameView } from '../public/js/game-view.js';

const PLAYERS = [{ name: 'あき' }, { name: 'はる' }];

const garden = (rows) => rows.map(row => row.map(value => (value === 0 ? null : value)));

// 手番・山札・場を指定したゲームを作る（ランダムに決まると結果が変わるテストのため）
function createGame({ current = 0, pool, table = [], gardens } = {}) {
    const game = new Game(PLAYERS, { seed: 1 });
    game.currentPlayerIndex = current;
    if (pool) game.pool = pool;
    game.table = table;
    gardens?.forEach((g, i) => { if (g) game.players[i].garden = garden(g); });
    return game;
}

describe('置ける場所', () => {
    const g = garden([
        [2, 0, 0, 0],
        [0, 6, 0, 0],
        [0, 0, 11, 0],
        [0, 0, 0, 18]
    ]);

    it('行は左から右へ、列は上から下へ大きくなるように置ける', () => {
        expect(canPlace(g, 0, 1, 5)).toBe(true);
        expect(canPlace(g, 0, 1, 2)).toBe(false); // 左の2と同じ
        expect(canPlace(g, 0, 1, 1)).toBe(false); // 左の2より小さい
        expect(canPlace(g, 0, 1, 6)).toBe(false); // 下の6と同じ
        expect(canPlace(g, 3, 0, 19)).toBe(false); // 右の18より大きい
        expect(canPlace(g, 3, 0, 3)).toBe(true);
    });

    it('斜めの並びは判定しない', () => {
        expect(canPlace(g, 1, 1, 12)).toBe(true);
    });

    it('置いてあるタイルとの入れ替えは、そのタイル自身を除いて判定する', () => {
        const row = garden([
            [0, 0, 0, 0],
            [4, 6, 9, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0]
        ]);
        expect(canPlace(row, 1, 1, 5)).toBe(true);
        expect(canPlace(row, 1, 1, 8)).toBe(true);
        expect(canPlace(row, 1, 1, 9)).toBe(false);
        expect(canPlace(row, 1, 1, 4)).toBe(false);
        expect(validPlacements(row, 1)).toContainEqual({ row: 1, col: 0 });
    });
});

describe('ゲームの準備', () => {
    it('人数分の1〜20を使い、各自4枚を小さい順に斜めに置く', () => {
        const game = new Game([{ name: 'a' }, { name: 'b' }, { name: 'c' }], { seed: 42 });
        game.players.forEach(player => {
            const diagonal = player.garden.map((row, i) => row[i]);
            expect(diagonal).toEqual([...diagonal].sort((a, b) => a - b));
            expect(countTiles(player.garden)).toBe(SIZE);
        });
        expect(game.pool).toHaveLength(60 - 12);
    });

    it('同じシードなら同じゲームになる', () => {
        const a = new Game(PLAYERS, { seed: 7 });
        const b = new Game(PLAYERS, { seed: 7 });
        expect(a.pool).toEqual(b.pool);
        expect(a.players[0].garden).toEqual(b.players[0].garden);
        expect(a.currentPlayerIndex).toBe(b.currentPlayerIndex);
    });

    it('1人や5人では遊べない', () => {
        expect(() => new Game([{ name: 'a' }])).toThrow();
        expect(() => new Game(Array(5).fill({ name: 'a' }))).toThrow();
    });
});

describe('手番', () => {
    it('山札から引いたタイルは置ける。置くと次の人の番になる', () => {
        const game = createGame({ pool: [9, 9, 9, 5], gardens: [[[2, 0, 0, 0], [0, 6, 0, 0], [0, 0, 11, 0], [0, 0, 0, 18]]] });
        expect(game.applyCommand(0, { type: 'draw' })).toBe(true);
        expect(game.holding).toEqual({ number: 5, from: 'pool' });
        expect(game.applyCommand(0, { type: 'place', row: 0, col: 1 })).toBe(true);
        expect(game.players[0].garden[0][1]).toBe(5);
        expect(game.holding).toBeNull();
        expect(game.currentPlayerIndex).toBe(1);
    });

    it('山札から引いたタイルは場に出せる', () => {
        const game = createGame({ pool: [9, 9, 9, 5] });
        game.applyCommand(0, { type: 'draw' });
        expect(game.applyCommand(0, { type: 'discard' })).toBe(true);
        expect(game.table).toEqual([5]);
        expect(game.currentPlayerIndex).toBe(1);
    });

    it('場から取ったタイルは場に戻せない', () => {
        const game = createGame({ table: [16, 4], pool: [9, 9, 9] });
        expect(game.applyCommand(0, { type: 'take', index: 1 })).toBe(true);
        expect(game.holding).toEqual({ number: 4, from: 'table' });
        expect(game.table).toEqual([16]);
        expect(game.applyCommand(0, { type: 'discard' })).toBe(false);
        expect(game.lastError).toBe('場から取ったタイルは庭に置いてください');
        expect(game.applyCommand(0, { type: 'take', index: 0 })).toBe(false);
    });

    it('置いてあるタイルと入れ替えると、外したタイルは場に出る', () => {
        const game = createGame({ pool: [9, 9, 3], gardens: [[[2, 0, 0, 0], [0, 6, 0, 0], [0, 0, 11, 0], [0, 0, 0, 18]]] });
        game.applyCommand(0, { type: 'draw' });
        expect(game.applyCommand(0, { type: 'place', row: 1, col: 1 })).toBe(true);
        expect(game.players[0].garden[1][1]).toBe(3);
        expect(game.table).toEqual([6]);
    });

    it('並びを崩す置き方・手番でない人の操作・持たずに置く操作は受け付けない', () => {
        const game = createGame({ pool: [9, 9, 1], gardens: [[[2, 0, 0, 0], [0, 6, 0, 0], [0, 0, 11, 0], [0, 0, 0, 18]]] });
        expect(game.applyCommand(1, { type: 'draw' })).toBe(false);
        expect(game.applyCommand(0, { type: 'place', row: 0, col: 1 })).toBe(false);
        game.applyCommand(0, { type: 'draw' });
        expect(game.applyCommand(0, { type: 'place', row: 0, col: 1 })).toBe(false);
        expect(game.applyCommand(0, { type: 'draw' })).toBe(false);
        expect(game.commands).toEqual([{ playerId: 0, type: 'draw' }]);
    });
});

describe('ゲームの終わり', () => {
    it('16マスを埋めたらその人の勝ち', () => {
        const almost = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 0]];
        const game = createGame({ pool: [9, 9, 20], gardens: [almost] });
        game.applyCommand(0, { type: 'draw' });
        game.applyCommand(0, { type: 'place', row: 3, col: 3 });
        expect(game.phase).toBe('end');
        expect(game.result).toEqual({ winnerIds: [0], reason: 'complete' });
        expect(game.applyCommand(1, { type: 'draw' })).toBe(false);
    });

    it('山札がなくなったら、タイルが一番多い人の勝ち（同じ数なら全員）', () => {
        const game = createGame({ pool: [20] });
        game.applyCommand(0, { type: 'draw' });
        game.applyCommand(0, { type: 'discard' });
        expect(game.result).toEqual({ winnerIds: [0, 1], reason: 'poolEmpty' });
    });
});

describe('再現とビュー', () => {
    it('操作の記録から同じ状態を再現できる', () => {
        const game = new Game(PLAYERS, { seed: 3 });
        const player = game.currentPlayerIndex;
        game.applyCommand(player, { type: 'draw', extra: 'ignored' });
        game.applyCommand(player, { type: 'discard' });
        const replayed = Game.replay(PLAYERS, { seed: 3 }, game.commands);
        expect(replayed.table).toEqual(game.table);
        expect(replayed.currentPlayerIndex).toBe(game.currentPlayerIndex);
        expect(game.commands[0]).toEqual({ playerId: player, type: 'draw' }); // 余計な項目は記録しない
    });

    it('代行（部屋を出た人の番を CPU が打つ）は手番に関係なく受け付け、記録から再現できる', () => {
        const game = new Game(PLAYERS, { seed: 3 });
        const other = 1 - game.currentPlayerIndex;
        expect(game.applyCommand(other, { type: 'proxy' })).toBe(true);
        expect(game.applyCommand(other, { type: 'proxy' })).toBe(false);
        const replayed = Game.replay(PLAYERS, { seed: 3 }, game.commands);
        expect(replayed.players[other].proxy).toBe(true);
    });

    it('ビューには山札の並びを入れず、枚数だけを入れる', () => {
        const game = new Game(PLAYERS, { seed: 3 });
        const view = createGameView(game, 0);
        expect(view.poolCount).toBe(game.pool.length);
        expect(JSON.stringify(view)).not.toContain('"pool"');
        expect(view.players[0].garden).toEqual(game.players[0].garden);
    });
});
