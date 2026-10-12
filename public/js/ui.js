/**
 * 画面の描画と操作
 * ゲームはコントローラー（ローカル対戦 / オンライン対戦）から getView() で受け取ったビューだけを見て描画する
 */

import LocalGameController from './game-controller.js';
import OnlineGameController, { loadOnlineSession } from './online-controller.js';
import { getServerUrl } from './online-config.js';
import { SIZE, MIN_PLAYERS, MAX_PLAYERS, canPlace } from './game.js';

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

function element(tag, { className, text, onClick, disabled } = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    if (onClick) el.addEventListener('click', onClick);
    if (disabled) el.disabled = true;
    return el;
}

export default class UI {
    constructor() {
        this.controller = null; // 遊んでいるゲームのコントローラー
        this.online = null;     // オンライン対戦のコントローラー（部屋に入っている間）
        this.localPlayers = null;
        this.toastTimer = null;
        this.bindEvents();
    }

    // ===== 画面の切り替え =====

    showScreen(name) {
        ['setup', 'online', 'lobby', 'game'].forEach(screen => {
            $(`screen-${screen}`).classList.toggle('hidden', screen !== name);
        });
        $('menu-button').classList.toggle('hidden', name === 'setup' || name === 'online');
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
            await this.connectOnline().joinRoom(session.roomCode, session.name);
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
        if (lobby.status === 'playing') {
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
            if (player.seat === 0) item.append(element('span', { className: 'badge', text: 'ホスト' }));
            if (player.seat === online.session?.seat) item.append(element('span', { className: 'badge', text: 'あなた' }));
            if (!player.connected) item.append(element('span', { className: 'badge muted', text: '切断中' }));
            if (isHost && player.isCPU) {
                item.append(element('button', { className: 'small', text: '外す', onClick: () => online.removePlayer(player.seat) }));
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
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', code);
        const server = new URLSearchParams(location.search).get('server');
        if (server) url.searchParams.set('server', server);
        const text = `Lucky Numbers で遊ぼう！ 部屋番号 ${code}`;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Lucky Numbers', text, url: url.toString() });
            } else {
                await navigator.clipboard.writeText(url.toString());
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
        const holdingNumber = view.holding?.number ?? null;
        const canAct = view.isMyTurn;

        $('status').textContent = this.statusText(view);

        // 山札と持っているタイル
        $('pool-count').textContent = `${view.poolCount}枚`;
        $('pool-button').disabled = !(canAct && !view.holding && view.poolCount > 0);
        const holding = $('holding');
        holding.replaceChildren();
        if (view.holding) {
            holding.append(
                element('div', { className: 'hint', text: view.current === view.me ? 'あなたのタイル' : `${view.current.name}のタイル` }),
                element('div', { className: 'tile big held', text: String(holdingNumber) })
            );
        }
        $('discard-button').classList.toggle('hidden', !(canAct && view.holding?.from === 'pool'));

        // 場
        const table = $('table-tiles');
        table.replaceChildren();
        if (view.table.length === 0) table.append(element('span', { className: 'hint', text: 'まだありません' }));
        view.table.forEach((number, index) => {
            table.append(element('button', {
                className: 'tile',
                text: String(number),
                disabled: !(canAct && !view.holding),
                onClick: () => this.controller.send({ type: 'take', index })
            }));
        });

        // 庭（自分を先頭に）
        const gardens = $('gardens');
        gardens.replaceChildren();
        const ordered = view.me ? [view.me, ...view.players.filter(p => p !== view.me)] : view.players;
        ordered.forEach(player => gardens.append(this.renderGarden(view, player, canAct && player === view.me ? holdingNumber : null)));

        this.renderResult(view);

        const log = $('log');
        log.replaceChildren(...[...view.logs].reverse().map(message => element('li', { text: message })));
    }

    renderGarden(view, player, placingNumber) {
        const isWinner = view.result?.winnerIds.includes(player.id);
        const classes = ['garden', 'panel'];
        if (player === view.me) classes.push('mine');
        if (player === view.current && view.phase === 'play') classes.push('current');
        if (isWinner) classes.push('winner');
        const wrapper = element('div', { className: classes.join(' ') });

        const title = element('div', { className: 'garden-title' });
        title.append(element('span', { text: player.name + (player.isCPU ? '（CPU）' : '') }));
        title.append(element('span', { className: 'hint', text: `${player.tileCount}/${SIZE * SIZE}` }));
        wrapper.append(title);

        const grid = element('div', { className: 'grid' });
        player.garden.forEach((rowValues, row) => {
            rowValues.forEach((number, col) => {
                const placeable = placingNumber !== null && canPlace(player.garden, row, col, placingNumber);
                const cell = element(placeable ? 'button' : 'div', {
                    className: ['cell', number !== null ? 'tile' : '', placeable ? 'placeable' : ''].join(' ').trim(),
                    text: number !== null ? String(number) : '',
                    onClick: placeable ? () => this.controller.send({ type: 'place', row, col }) : undefined
                });
                grid.append(cell);
            });
        });
        wrapper.append(grid);
        return wrapper;
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
            if (this.online.isHost()) {
                buttons.append(element('button', { className: 'primary', text: '部屋に戻る', onClick: () => this.online.backToLobby() }));
            } else {
                buttons.append(element('span', { className: 'hint', text: '部屋を作った人が部屋に戻るまでお待ちください' }));
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
            if (!view.holding) return 'あなたの番：山札を引くか、場のタイルを取ってください';
            return view.holding.from === 'pool'
                ? `${view.holding.number} を置くマスを選ぶか、場に出してください`
                : `${view.holding.number} を置くマスを選んでください`;
        }
        if (view.me && view.current === view.me) return '送信中…';
        return `${view.current.name}の番です`;
    }

    // ===== メニュー =====

    openMenu() {
        if (this.controller === this.online && this.online) {
            if (confirm('部屋を出ますか？（同じ部屋には戻れなくなります）')) {
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
    }
}
