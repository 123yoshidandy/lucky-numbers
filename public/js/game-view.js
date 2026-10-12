/**
 * プレイヤーごとに見える状態（ビュー）
 * サーバーとブラウザのどちらでも使う。JSONにできる値だけで作る
 * ラッキーナンバーは庭も場も表向きなので、隠すのは山札の並びだけ（枚数だけを伝える）
 */

import { countTiles } from './game.js';

const VIEW_LOGS = 50; // ビューに入れる最近のログの数

// viewerId のプレイヤーから見たゲームの状態（観戦や全員CPUのときは viewerId = null）
export function createGameView(game, viewerId) {
    return {
        viewerId,
        phase: game.phase,
        currentPlayerId: game.getCurrentPlayer().id,
        poolCount: game.pool.length,
        table: [...game.table],
        holding: game.holding ? { ...game.holding } : null,
        players: game.players.map(player => ({
            id: player.id,
            name: player.name,
            isCPU: player.isCPU,
            garden: player.garden.map(row => [...row]),
            tileCount: countTiles(player.garden)
        })),
        logs: game.logs.slice(-VIEW_LOGS),
        result: game.result ? { ...game.result } : null
    };
}

// 画面で使いやすいよう、自分・手番の人・自分の番かどうかを足す
export function hydrateGameView(view) {
    const me = view.players.find(player => player.id === view.viewerId) ?? null;
    const current = view.players.find(player => player.id === view.currentPlayerId);
    return {
        ...view,
        me,
        current,
        isMyTurn: Boolean(me) && me === current && view.phase !== 'end'
    };
}
