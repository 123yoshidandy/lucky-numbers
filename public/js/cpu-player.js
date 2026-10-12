/**
 * CPUの戦略
 * 庭の良さを点数にして、点数が一番上がる手を選ぶ。山札の中身は見ない（持っているタイルと場だけを使う）
 * - 置いたタイルは、そのマスの「目安の数字」（左上が1、右下が20になるように並べたもの）に近いほど良い
 * - 空いたマスは、まだ置ける数字が多いほど良い。置ける数字がなくなったマスは大きく減点する
 */

import { SIZE, MAX_NUMBER, canPlace, validPlacements, countTiles } from './game.js';

const COMPLETE_BONUS = 1000;   // 庭が埋まる手は必ず選ぶ
const DEAD_CELL_PENALTY = 8;   // 何も置けなくなった空きマス
const TAKE_THRESHOLD = 3;      // 場のタイルを取るのは、これ以上良くなるとき（山札を引く期待値の代わり）
const PLACE_THRESHOLD = 0.5;   // 引いたタイルを置くのは、これ以上良くなるとき

const target = (row, col) => 1 + (row + col) * (MAX_NUMBER - 1) / (2 * (SIZE - 1));

// 庭の良さ（高いほど良い）
export function evaluateGarden(garden) {
    if (countTiles(garden) === SIZE * SIZE) return COMPLETE_BONUS;
    let score = 0;
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            const number = garden[row][col];
            if (number !== null) {
                score += 10 - Math.abs(number - target(row, col));
                continue;
            }
            let options = 0;
            for (let n = 1; n <= MAX_NUMBER; n++) {
                if (canPlace(garden, row, col, n)) options++;
            }
            score += options === 0 ? -DEAD_CELL_PENALTY : Math.min(options, 6) * 0.5;
        }
    }
    return score;
}

// number を置く一番良いマスと、置いたときに良くなる点数
export function bestPlacement(garden, number) {
    const before = evaluateGarden(garden);
    let best = null;
    validPlacements(garden, number).forEach(({ row, col }) => {
        const after = garden.map(r => [...r]);
        after[row][col] = number;
        const gain = evaluateGarden(after) - before;
        if (!best || gain > best.gain) best = { row, col, gain };
    });
    return best;
}

// 今の手番のCPUが次に送る操作
export function chooseCpuCommand(game) {
    const { garden } = game.getCurrentPlayer();

    if (game.holding) {
        const best = bestPlacement(garden, game.holding.number);
        const mustPlace = game.holding.from === 'table';
        if (best && (mustPlace || best.gain >= PLACE_THRESHOLD)) {
            return { type: 'place', row: best.row, col: best.col };
        }
        return { type: 'discard' };
    }

    let bestTake = null;
    game.table.forEach((number, index) => {
        const best = bestPlacement(garden, number);
        if (best && (!bestTake || best.gain > bestTake.gain)) bestTake = { index, gain: best.gain };
    });
    if (bestTake && (bestTake.gain >= TAKE_THRESHOLD || game.pool.length === 0)) {
        return { type: 'take', index: bestTake.index };
    }
    return { type: 'draw' };
}

// CPU が打つ番か（CPU の席と、部屋を出た人の代わりに打つ席）
export function isCpuTurn(game) {
    const player = game.getCurrentPlayer();
    return game.phase === 'play' && (player.isCPU || player.proxy);
}

// CPUの手を1つ進める（タイルを引く／取る、置く／捨てるのそれぞれが1手）
export function runCpuStep(game) {
    if (!isCpuTurn(game)) return false;
    return game.applyCommand(game.currentPlayerIndex, chooseCpuCommand(game));
}
