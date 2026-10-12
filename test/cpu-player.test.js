import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { chooseCpuCommand, runCpuStep, bestPlacement } from '../public/js/cpu-player.js';

const CPUS = (count) => Array.from({ length: count }, (_, i) => ({ name: `CPU${i + 1}`, isCPU: true }));

describe('CPU', () => {
    it.each([2, 3, 4])('%i人のCPUだけで、最後まで進む', (count) => {
        for (let seed = 1; seed <= 20; seed++) {
            const game = new Game(CPUS(count), { seed });
            let steps = 0;
            while (game.phase === 'play' && steps < 1000) {
                expect(runCpuStep(game)).toBe(true);
                steps++;
            }
            expect(game.phase).toBe('end');
            expect(game.result.winnerIds.length).toBeGreaterThan(0);
        }
    });

    it('庭が埋まる手があれば選ぶ', () => {
        const game = new Game(CPUS(2), { seed: 1 });
        game.currentPlayerIndex = 0;
        game.players[0].garden = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, null]];
        game.table = [3, 19];
        expect(chooseCpuCommand(game)).toEqual({ type: 'take', index: 1 });
        game.applyCommand(0, { type: 'take', index: 1 });
        expect(chooseCpuCommand(game)).toEqual({ type: 'place', row: 3, col: 3 });
    });

    it('置けないタイルを引いたら場に出す', () => {
        const game = new Game(CPUS(2), { seed: 1 });
        game.currentPlayerIndex = 0;
        // 3 は同じ3との入れ替えか、目安から遠ざかる入れ替えしかできず、庭が良くならない
        game.players[0].garden = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, null]];
        game.holding = { number: 3, from: 'pool' };
        expect(bestPlacement(game.players[0].garden, 3).gain).toBeLessThan(0.5);
        expect(chooseCpuCommand(game)).toEqual({ type: 'discard' });
    });
});
