/**
 * 画面の部品：要素の作成と、クローバー型のタイル（ゲーム画面・開始画面の絵・遊び方の図・動きで使う）
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function element(tag, { className, text, onClick, disabled } = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    if (onClick) el.addEventListener('click', onClick);
    if (disabled) el.disabled = true;
    return el;
}

// クローバー型のタイル（形は index.html の <symbol id="clover"> を使い回す）。number が null なら裏向き
export function cloverTile(number, { tag = 'div', className = '', onClick, disabled } = {}) {
    const faceDown = number === null;
    const classes = ['clover', faceDown ? 'face-down' : '', className].filter(Boolean).join(' ');
    const tile = element(tag, { className: classes, onClick, disabled });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#clover');
    svg.append(use);
    tile.append(svg, element('span', { className: 'num', text: faceDown ? '?' : String(number) }));
    return tile;
}

// 開始画面の絵の庭（"2,5,9,13/4,_,11,15/..."。_ は空き。target のマスは光らせる）
export function renderPictureGarden(container, rows, target) {
    const grid = element('div', { className: 'grid' });
    rows.split('/').forEach((row, r) => row.split(',').forEach((value, c) => {
        const isTarget = target && target[0] === r && target[1] === c;
        if (value === '_') {
            grid.append(element('div', { className: `cell empty${isTarget ? ' placeable' : ''}` }));
        } else {
            grid.append(cloverTile(Number(value), { className: 'cell' }));
        }
    }));
    container.replaceChildren(grid);
}
