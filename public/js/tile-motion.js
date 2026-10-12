/**
 * タイルの動き（どこからどこへ動いたかを見せる）
 * 描画の前に各タイルの位置を測り（captureLayout）、描画の後に前後のビューを比べて、
 * 動いたタイルの複製を元の位置から行き先へ飛ばす（animateChanges）
 *
 * - 山札から引く：裏向きのタイルが、めくれながら手元へ
 * - 場から取る：場から手元へ
 * - 庭に置く：手元から庭のマスへ（入れ替えたタイルは、庭から場へ）
 * - 場に出す：手元から場へ
 */

import { cloverTile } from './tiles.js';

const FLY_MS = 480;
const SECOND_DELAY_MS = 140; // 入れ替えで外したタイルは、少し遅れて場へ

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const rectOf = (el) => {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? rect : null;
};

const cellSelector = (playerId, row, col) => `[data-player="${playerId}"][data-row="${row}"][data-col="${col}"]`;
const heldElement = () => document.getElementById('held-tile');
const tableElements = () => [...document.querySelectorAll('#table-tiles .clover')];

// 描画の前の、各タイルの位置
export function captureLayout() {
    const cells = new Map();
    document.querySelectorAll('[data-player][data-row]').forEach(el => {
        cells.set(`${el.dataset.player}-${el.dataset.row}-${el.dataset.col}`, rectOf(el));
    });
    return {
        pool: rectOf(document.querySelector('#pool-button .pool-front')),
        held: rectOf(heldElement()),
        table: tableElements().map(rectOf),
        cells
    };
}

// 前のビューと今のビューを比べて、動いたタイルを飛ばす
export function animateChanges(previous, next, layout) {
    if (!previous || !layout || reducedMotion()) return;

    // 手に取った（山札から引いた／場から取った）
    if (!previous.holding && next.holding) {
        const { number, from } = next.holding;
        if (from === 'pool') {
            fly({ number, from: layout.pool, to: heldElement(), faceDown: true });
        } else {
            const index = firstDifference(previous.table, next.table);
            fly({ number, from: layout.table[index], to: heldElement() });
        }
        return;
    }

    // 手放した（庭に置いた／場に出した）
    if (previous.holding && !next.holding) {
        const playerId = previous.currentPlayerId;
        const before = previous.players.find(p => p.id === playerId)?.garden;
        const after = next.players.find(p => p.id === playerId)?.garden;
        const changed = before && after ? changedCell(before, after) : null;
        const lastTable = () => tableElements().at(-1);

        if (!changed) {
            fly({ number: previous.holding.number, from: layout.held, to: lastTable() });
            return;
        }
        const { row, col } = changed;
        fly({ number: previous.holding.number, from: layout.held, to: document.querySelector(cellSelector(playerId, row, col)) });
        const replaced = before[row][col];
        if (replaced !== null) {
            fly({ number: replaced, from: layout.cells.get(`${playerId}-${row}-${col}`), to: lastTable(), delay: SECOND_DELAY_MS });
        }
    }
}

function firstDifference(before, after) {
    const index = before.findIndex((value, i) => value !== after[i]);
    return index < 0 ? before.length - 1 : index;
}

function changedCell(before, after) {
    for (let row = 0; row < before.length; row++) {
        for (let col = 0; col < before[row].length; col++) {
            if (before[row][col] !== after[row][col]) return { row, col };
        }
    }
    return null;
}

// タイルの複製を from（描画前の位置）から to（描画後の要素）へ、弧を描いて飛ばす
function fly({ number, from, to, faceDown = false, delay = 0 }) {
    if (!from || !to) return;
    // ぽんと出す動きは飛ぶ動きに任せる（縮んだ大きさを測らないよう、測る前に外す）
    to.classList.remove('pop');
    // 場は横にスクロールするので、行き先が見えるようにしてから測る
    const strip = to.closest('.table-tiles');
    if (strip) strip.scrollLeft = strip.scrollWidth;
    const target = rectOf(to);
    if (!target) return;

    // 着くまで行き先は隠す
    to.style.visibility = 'hidden';

    const flyer = document.createElement('div');
    flyer.className = 'flyer';
    Object.assign(flyer.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.width}px` });
    const card = document.createElement('div');
    card.className = 'flyer-card';
    card.append(cloverTile(number, { className: 'flyer-front' }));
    if (faceDown) card.append(cloverTile(null, { className: 'flyer-back' }));
    flyer.append(card);
    document.body.append(flyer);

    const dx = target.left + target.width / 2 - (from.left + from.width / 2);
    const dy = target.top + target.width / 2 - (from.top + from.width / 2);
    const scale = target.width / from.width;
    const lift = Math.min(60, 20 + Math.hypot(dx, dy) * 0.15); // 遠いほど高く弧を描く
    const motion = flyer.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(${(1 + scale) / 2 * 1.15})`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }
    ], { duration: FLY_MS, delay, easing: 'cubic-bezier(0.35, 0.6, 0.3, 1)', fill: 'backwards' });
    if (faceDown) {
        // 裏向きから、飛びながらめくる
        card.animate([
            { transform: 'rotateY(180deg)' },
            { transform: 'rotateY(180deg)', offset: 0.15 },
            { transform: 'rotateY(0deg)', offset: 0.7 },
            { transform: 'rotateY(0deg)' }
        ], { duration: FLY_MS, delay, fill: 'backwards' });
    }

    motion.finished.catch(() => {}).then(() => {
        flyer.remove();
        to.style.visibility = '';
        to.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
    });
}
