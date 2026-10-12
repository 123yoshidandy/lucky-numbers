/**
 * 画面の描画と操作
 * ゲームはコントローラー（ローカル対戦 / オンライン対戦）から getView() で受け取ったビューだけを見て描画する
 */

import LocalGameController from './game-controller.js';
import OnlineGameController, { loadOnlineSession } from './online-controller.js';
import { getServerUrl } from './online-config.js';
import { SIZE, MIN_PLAYERS, MAX_PLAYERS, canPlace } from './game.js';
import { element, cloverTile, renderPictureGarden } from './tiles.js';
import { captureLayout, animateChanges } from './tile-motion.js';

const SETUP_KEY = 'lucky-numbers.setup'; // 開始画面で選んだ人数・名前・CPU
const TOAST_MS = 2500;

const $ = (id) => document.getElementById(id);

function loadSetup() {
    try {
        return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    } catch {
        return null;
    }
}

function saveSetup(setup) {
    try {
        localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
    } catch {
        // 保存できなくても遊べる
    }
}

export default class UI {
    constructor() {
        this.controller = null; // 遊んでいるゲームのコントローラー
        this.online = null;     // オンライン対戦のコントローラー（部屋に入っている間）
        this.localPlayers = null;
        this.toastTimer = null;
        this.previousGardens = new Map(); // 前に描いた庭（新しく置かれたタイルを見分ける）
        this.lastView = null;              // 前に描いたビュー（動いたタイルを見分ける）
        this.bindEvents();
        this.renderPictures();
    }

    // ===== 画面の切り替え =====

    showScreen(name) {
        ['setup', 'online', 'lobby', 'game'].forEach(screen => {
            $(`screen-${screen}`).classList.toggle('hidden', screen !== name);
        });
        // メニューと遊び方のボタンは、ロビーとゲーム中だけ出す（開始画面には「遊び方を見る」がある）
        const onTitle = name === 'setup' || name === 'online';
        $('menu-button').classList.toggle('hidden', onTitle);
        $('help-button').classList.toggle('hidden', onTitle);
        if (name !== 'game') $('status').textContent = '';
    }

    showSetup() {
        const setup = loadSetup() ?? { count: 2, seats: [] };
        $('player-count').value = String(setup.count);
        this.renderSeats(setup.seats);
        this.showScreen('setup');
    }

    showOnlineMenu({ roomCode = '' } = {}) {
        const session = loadOnlineSession();
        $('online-name').value = session?.name ?? loadSetup()?.seats?.[0]?.name ?? '';
        $('room-code').value = roomCode;
        this.showScreen('online');
    }

    // 前回入っていた部屋があれば、自動で戻る
    async resumeOnline() {
        const session = loadOnlineSession();
        if (!session) return false;
        try {
            await this.connectOnline().resume();
            return true;
        } catch {
            this.leaveOnline();
            return false;
        }
    }

    // ===== 開始画面（ローカル対戦） =====

    renderSeats(savedSeats = this.readSeats()) {
        const count = Number($('player-count').value);
        const list = $('seat-list');
        list.replaceChildren();
        for (let i = 0; i < count; i++) {
            const saved = savedSeats[i] ?? { name: i === 0 ? 'あなた' : `CPU${i}`, isCPU: i !== 0 };
            const row = element('div', { className: 'seat' });
            const name = element('input');
            name.maxLength = 12;
            name.value = saved.name;
            name.dataset.role = 'name';
            const cpuLabel = element('label', { className: 'cpu-toggle' });
            const cpu = element('input');
            cpu.type = 'checkbox';
            cpu.checked = saved.isCPU;
            cpu.dataset.role = 'cpu';
            cpuLabel.append(cpu, 'CPU');
            row.append(`${i + 1}.`, name, cpuLabel);
            list.append(row);
        }
    }

    readSeats() {
        return [...$('seat-list').querySelectorAll('.seat')].map((row, i) => ({
            name: row.querySelector('[data-role=name]').value.trim() || `プレイヤー${i + 1}`,
            isCPU: row.querySelector('[data-role=cpu]').checked
        }));
    }

    startLocal(players = null) {
        if (!players) {
            players = this.readSeats();
            saveSetup({ count: players.length, seats: players });
        }
        this.controller?.stop?.();
        this.resetBoardMemory();
        this.localPlayers = players;
        this.controller = new LocalGameController(players, {
            onUpdate: () => this.renderGame(),
            onError: (message) => this.toast(message)
        });
        this.showScreen('game');
        this.renderGame();
    }

    // ===== オンライン対戦 =====

    connectOnline() {
        if (this.online) return this.online;
        this.online = new OnlineGameController(getServerUrl(), {
            onUpdate: () => {
                if (this.controller === this.online && this.online.view) this.renderGame();
            },
            onLobby: (lobby) => this.onLobby(lobby),
            onError: (message) => this.toast(message),
            onConnectionChange: (connected) => {
                if (!connected) this.toast('サーバーとの接続が切れました。再接続しています…');
            }
        });
        return this.online;
    }

    async createRoom() {
        const name = $('online-name').value.trim();
        if (!name) return this.toast('名前を入れてください');
        try {
            await this.connectOnline().createRoom(name);
        } catch (error) {
            this.toast(error.message);
        }
    }

    async joinRoom() {
        const name = $('online-name').value.trim();
        const code = $('room-code').value.trim();
        if (!name) return this.toast('名前を入れてください');
        if (!/^\d{5}$/.test(code)) return this.toast('部屋番号（数字5桁）を入れてください');
        try {
            await this.connectOnline().joinRoom(code, name);
        } catch (error) {
            this.toast(error.message);
        }
    }

    onLobby(lobby) {
        const online = this.online;
        this.controller?.stop?.();
        this.controller = online;
        // 新しい対戦が始まったら、前の対戦の庭と比べないようにする
        if (lobby.matchId !== this.matchId) {
            this.matchId = lobby.matchId;
            this.resetBoardMemory();
        }
        // 対戦中（playing）と対戦後（ended）はゲーム画面
        if (lobby.status !== 'lobby') {
            this.showScreen('game');
            if (online.view) this.renderGame();
            return;
        }

        this.showScreen('lobby');
        $('lobby-code').textContent = lobby.roomCode;
        const isHost = online.isHost();
        const list = $('lobby-players');
        list.replaceChildren();
        lobby.players.forEach(player => {
            const item = element('li');
            const label = player.isCPU ? `${player.name}（CPU）` : player.name;
            item.append(element('span', { text: label, className: player.connected ? '' : 'offline' }));
            if (player.seat === lobby.hostSeat) item.append(element('span', { className: 'badge', text: 'ホスト' }));
            if (player.seat === lobby.seat) item.append(element('span', { className: 'badge', text: 'あなた' }));
            if (!player.connected) item.append(element('span', { className: 'badge muted', text: '切断中' }));
            if (isHost && player.isCPU) {
                item.append(element('button', { className: 'small', text: '外す', onClick: () => online.removeCpu(player.seat) }));
            }
            list.append(item);
        });
        $('host-controls').classList.toggle('hidden', !isHost);
        $('guest-note').classList.toggle('hidden', isHost);
        $('add-cpu').disabled = lobby.players.length >= MAX_PLAYERS;
        $('start-online').disabled = lobby.players.length < MIN_PLAYERS;
    }

    async shareInvite() {
        const code = this.online?.lobby?.roomCode;
        if (!code) return;
        // 招待URL（?room=部屋番号。接続先の指定 ?server= は共通部品が引き継ぐ）
        const url = this.online.inviteUrl();
        const text = `Lucky Numbers で遊ぼう！ 部屋番号 ${code}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Lucky Numbers', text, url });
            } else {
                await navigator.clipboard.writeText(url);
                this.toast('招待URLをコピーしました');
            }
        } catch {
            // 共有をやめたときなど
        }
    }

    leaveOnline() {
        this.online?.leave();
        if (this.controller === this.online) this.controller = null;
        this.online = null;
        // 招待URLの ?room= を消しておく（再読み込みで参加画面に戻らないように）
        const url = new URL(location.href);
        url.searchParams.delete('room');
        history.replaceState(null, '', url);
    }

    // ===== ゲーム画面 =====

    renderGame() {
        const view = this.controller?.getView();
        if (!view) return;
        // 描画の前にタイルの位置を測っておき、描画の後に動いたタイルを飛ばす
        const layout = this.lastView ? captureLayout() : null;
        const holdingNumber = view.holding?.number ?? null;
        const canAct = view.isMyTurn;

        $('status').textContent = this.statusText(view);

        // 山札と持っているタイル
        $('pool-count').textContent = String(view.poolCount);
        const canDraw = canAct && !view.holding && view.poolCount > 0;
        $('pool-button').disabled = !canDraw;
        $('pool-button').classList.toggle('active', canDraw);
        const holding = $('holding');
        holding.replaceChildren();
        if (view.holding) {
            const held = cloverTile(holdingNumber, { className: 'big held' });
            held.id = 'held-tile';
            holding.append(
                held,
                element('div', { className: 'hint', text: view.current === view.me ? 'あなたのタイル' : `${view.current.name}のタイル` })
            );
        }
        $('discard-button').classList.toggle('hidden', !(canAct && view.holding?.from === 'pool'));

        // 場
        const table = $('table-tiles');
        table.replaceChildren();
        if (view.table.length === 0) table.append(element('span', { className: 'hint', text: 'まだありません（タップで取れます）' }));
        const canTake = canAct && !view.holding;
        view.table.forEach((number, index) => {
            table.append(cloverTile(number, {
                tag: 'button',
                className: canTake ? 'takeable' : '',
                disabled: !canTake,
                onClick: () => this.controller.send({ type: 'take', index })
            }));
        });

        // 相手の庭は上に小さく、自分の庭は下に大きく（観戦中は全員を上に並べる）
        const opponents = $('opponents');
        const others = view.players.filter(p => p !== view.me);
        opponents.style.setProperty('--count', others.length);
        opponents.replaceChildren(...others.map(player => this.renderGarden(view, player, null, element('div'))));
        const mine = $('my-garden');
        mine.classList.toggle('hidden', !view.me);
        if (view.me) this.renderGarden(view, view.me, canAct ? holdingNumber : null, mine);

        this.renderResult(view);

        $('latest-log').textContent = view.logs.at(-1) ?? '';

        animateChanges(this.lastView, view, layout);
        this.lastView = view;
    }

    // 新しいゲームでは、前のゲームの盤面と比べない（ぽんと出す動き・飛ぶ動きの元にしない）
    resetBoardMemory() {
        this.previousGardens.clear();
        this.lastView = null;
    }

    // container に player の庭を描く（自分の庭は決まった要素に、相手の庭は新しい要素に描く）
    renderGarden(view, player, placingNumber, container) {
        const isWinner = view.result?.winnerIds.includes(player.id);
        const classes = ['garden', 'panel'];
        if (player === view.me) classes.push('mine');
        if (player === view.current && view.phase === 'play') classes.push('current');
        if (isWinner) classes.push('winner');
        container.className = classes.join(' ');
        container.replaceChildren();

        const title = element('div', { className: 'garden-title' });
        title.append(element('span', { className: 'garden-name', text: player.proxy ? `${player.name}（代行）` : player.name }));
        title.append(element('span', { className: 'hint', text: `${player.tileCount}/${SIZE * SIZE}` }));
        container.append(title);

        // 前に描いたときから変わったマス（新しく置かれたタイル）は、ぽんと出す
        const previous = this.previousGardens.get(player.id);
        this.previousGardens.set(player.id, player.garden.map(r => [...r]));

        const grid = element('div', { className: 'grid' });
        player.garden.forEach((rowValues, row) => {
            rowValues.forEach((number, col) => {
                const placeable = placingNumber !== null && canPlace(player.garden, row, col, placingNumber);
                const classes = ['cell'];
                if (placeable) classes.push('placeable');
                if (number !== null && previous && previous[row][col] !== number) classes.push('pop');
                const options = {
                    tag: placeable ? 'button' : 'div',
                    className: classes.join(' '),
                    onClick: placeable ? () => this.controller.send({ type: 'place', row, col }) : undefined
                };
                let cell;
                if (number !== null) {
                    // 相手の庭は小さいので、クローバーの絵は省いて数字を大きく見せる
                    cell = player === view.me
                        ? cloverTile(number, options)
                        : element(options.tag, { className: `${options.className} mini-tile`, text: String(number) });
                } else {
                    classes.push('empty');
                    cell = element(options.tag, { className: classes.join(' '), onClick: options.onClick });
                }
                // タイルの動きで、マスの位置を探すための目印
                Object.assign(cell.dataset, { player: player.id, row, col });
                grid.append(cell);
            });
        });
        // 外枠の大きさ（残りの高さと幅）に合わせて、グリッドを正方形に収める
        const fit = element('div', { className: 'grid-fit' });
        fit.append(grid);
        container.append(fit);
        return container;
    }

    renderResult(view) {
        const result = $('result');
        result.classList.toggle('hidden', !view.result);
        if (!view.result) return;

        result.replaceChildren();
        const winners = view.players.filter(p => view.result.winnerIds.includes(p.id)).map(p => p.name);
        const reason = view.result.reason === 'complete' ? '庭を完成させました' : '山札がなくなりました（タイルが一番多い人の勝ち）';
        result.append(
            element('h2', { text: `🏆 ${winners.join('・')}の勝ち！` }),
            element('p', { className: 'hint', text: reason })
        );
        const buttons = element('div', { className: 'buttons' });
        if (this.controller === this.online) {
            // 対戦後は、ホストが同じ顔ぶれで再戦でき、部屋に戻るのは誰でもできる
            if (this.online.isHost()) {
                buttons.append(element('button', { className: 'primary', text: 'もう一度', onClick: () => this.online.startGame() }));
            }
            buttons.append(element('button', { text: '部屋に戻る', onClick: () => this.online.backToLobby() }));
            if (!this.online.isHost()) {
                result.append(element('p', { className: 'hint', text: 'ホストが「もう一度」を押すと、同じメンバーで再戦します' }));
            }
        } else {
            buttons.append(
                element('button', { className: 'primary', text: 'もう一度', onClick: () => this.startLocal(this.localPlayers) }),
                element('button', { text: '準備画面へ', onClick: () => this.backToSetup() })
            );
        }
        result.append(buttons);
    }

    statusText(view) {
        if (view.result) return 'ゲーム終了';
        if (view.isMyTurn) {
            if (!view.holding) return 'あなたの番：山札を引くか、場から取ってください';
            return view.holding.from === 'pool'
                ? `${view.holding.number} を置くか、場に出してください`
                : `${view.holding.number} を置くマスを選んでください`;
        }
        if (view.me && view.current === view.me) return '送信中…';
        return `${view.current.name}の番です`;
    }

    // ===== メニュー =====

    openMenu() {
        if (this.controller === this.online && this.online) {
            if (confirm('部屋を出ますか？（対戦中なら、あなたの番は CPU が代わりに打ちます）')) {
                this.leaveOnline();
                this.showSetup();
            }
            return;
        }
        if (this.controller?.game?.phase !== 'play' || confirm('ゲームをやめて準備画面に戻りますか？')) {
            this.backToSetup();
        }
    }

    backToSetup() {
        this.controller?.stop?.();
        this.controller = null;
        this.showSetup();
    }

    toast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.add('hidden'), TOAST_MS);
    }

    bindEvents() {
        $('player-count').addEventListener('change', () => this.renderSeats());
        $('start-local').addEventListener('click', () => this.startLocal());
        $('open-online').addEventListener('click', () => this.showOnlineMenu());
        $('back-to-setup').addEventListener('click', () => this.showSetup());
        $('create-room').addEventListener('click', () => this.createRoom());
        $('join-room').addEventListener('click', () => this.joinRoom());
        $('share-invite').addEventListener('click', () => this.shareInvite());
        $('add-cpu').addEventListener('click', () => this.online?.addCpu());
        $('start-online').addEventListener('click', () => this.online?.startGame());
        $('leave-room').addEventListener('click', () => {
            this.leaveOnline();
            this.showSetup();
        });
        $('menu-button').addEventListener('click', () => this.openMenu());
        $('pool-button').addEventListener('click', () => this.controller?.send({ type: 'draw' }));
        $('discard-button').addEventListener('click', () => this.controller?.send({ type: 'discard' }));

        // 遊び方（上部の「？」と開始画面のボタン）。外側をタップしても閉じる
        const help = $('help-dialog');
        $('help-button').addEventListener('click', () => help.showModal());
        $('open-help').addEventListener('click', () => help.showModal());
        $('close-help').addEventListener('click', () => help.close());
        help.addEventListener('click', (event) => {
            if (event.target === help) help.close();
        });
    }

    // 開始画面の絵と、遊び方の図を描く（index.html の data-* に書いた盤面から）
    renderPictures() {
        document.querySelectorAll('.hero-board').forEach(board => {
            const garden = board.querySelector('.hero-garden');
            const held = board.querySelector('.hero-held');
            const [row, col] = garden.dataset.target.split(',').map(Number);
            renderPictureGarden(garden, garden.dataset.garden, [row, col]);
            // 浮かべるタイルは、光らせたマスの少し上に置く（位置は CSS が --row / --col から求める）
            held.style.setProperty('--row', row);
            held.style.setProperty('--col', col);
            held.replaceChildren(cloverTile(Number(held.dataset.number), { className: 'held' }));
        });
        document.querySelectorAll('.demo-row').forEach(el => {
            el.replaceChildren(...el.dataset.numbers.split(',').map(n => cloverTile(Number(n))));
        });
    }
}
