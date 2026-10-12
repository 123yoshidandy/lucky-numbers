/**
 * オンライン対戦のゲームコントローラー
 * ローカル対戦の LocalGameController と同じく、画面には getView() でビューを渡し、操作は send() で受け取る
 * ゲームはサーバーが進め、ここではサーバーから届いた自分のビューを表示するだけ
 */

import { hydrateGameView } from './game-view.js';

const SESSION_KEY = 'lucky-numbers.online'; // 再接続に使う部屋コードとトークン
const CPU_STEP_DELAY_MS = 600;              // CPUの手はローカル対戦と同じ間隔で順に見せる
const RECONNECT_DELAY_MS = 2000;

// 保存した参加情報（部屋コード・トークン・席・名前）
export function loadOnlineSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function saveOnlineSession(session) {
    try {
        if (session) {
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } else {
            localStorage.removeItem(SESSION_KEY);
        }
    } catch {
        // 保存できなくても、このページを開いている間は遊べる
    }
}

export default class OnlineGameController {
    // listeners: onUpdate() / onLobby(lobby) / onError(message) / onConnectionChange(connected)
    constructor(serverUrl, listeners = {}) {
        this.serverUrl = serverUrl;
        this.listeners = listeners;
        this.socket = null;
        this.session = loadOnlineSession(); // { roomCode, token, seat, name }
        this.lobby = null;
        this.view = null;          // 表示中のビュー（hydrate 済み）
        this.queue = [];           // まだ表示していないビュー（CPUの手を順に見せるため）
        this.queueTimer = null;
        this.awaitingResponse = false; // 操作を送ってから返事が届くまで
        this.isLeaving = false;
        this.pendingName = null;
    }

    // ===== 接続 =====

    connect() {
        return new Promise((resolve, reject) => {
            if (!this.serverUrl) {
                reject(new Error('オンライン対戦のサーバーが設定されていません'));
                return;
            }
            const socket = new WebSocket(this.serverUrl);
            this.socket = socket;
            socket.addEventListener('open', () => {
                this.listeners.onConnectionChange?.(true);
                resolve();
            });
            socket.addEventListener('error', () => reject(new Error('サーバーに接続できませんでした')));
            socket.addEventListener('message', (event) => this.receive(JSON.parse(event.data)));
            socket.addEventListener('close', () => {
                if (this.socket !== socket) return;
                this.listeners.onConnectionChange?.(false);
                // 部屋に入っていれば、少し待ってつなぎ直す（スマホがスリープしたときなど）
                if (!this.isLeaving && this.session) {
                    setTimeout(() => this.reconnect(), RECONNECT_DELAY_MS);
                }
            });
        });
    }

    async reconnect() {
        if (this.isLeaving || !this.session || this.isOpen()) return;
        try {
            await this.connect();
            this.request({ action: 'join', roomCode: this.session.roomCode, token: this.session.token });
        } catch {
            setTimeout(() => this.reconnect(), RECONNECT_DELAY_MS);
        }
    }

    isOpen() {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    request(message) {
        if (!this.isOpen()) {
            this.listeners.onError?.('サーバーとの接続が切れています。再接続しています…');
            this.reconnect();
            return false;
        }
        this.socket.send(JSON.stringify(message));
        return true;
    }

    // 部屋を出る（保存した参加情報も消す）
    leave() {
        this.isLeaving = true;
        this.session = null;
        saveOnlineSession(null);
        this.socket?.close();
        clearTimeout(this.queueTimer);
        this.queueTimer = null;
    }

    // ===== 部屋の操作 =====

    async createRoom(name) {
        await this.ensureConnected();
        this.pendingName = name;
        this.request({ action: 'create', name });
    }

    async joinRoom(roomCode, name) {
        await this.ensureConnected();
        this.pendingName = name;
        // 同じ部屋に入ったことがあれば、その席に戻る
        const token = this.session?.roomCode === roomCode ? this.session.token : undefined;
        this.request({ action: 'join', roomCode, name, token });
    }

    async ensureConnected() {
        this.isLeaving = false;
        if (!this.isOpen()) await this.connect();
    }

    addCpu() { this.request({ action: 'addCpu' }); }
    removePlayer(seat) { this.request({ action: 'removePlayer', seat }); }
    startGame() { this.request({ action: 'start' }); }
    backToLobby() { this.request({ action: 'backToLobby' }); }

    isHost() {
        return this.session?.seat === 0;
    }

    // ===== 画面とのやり取り（ローカル対戦のコントローラーと同じ形） =====

    getView() {
        if (!this.view) return null;
        // 操作の返事を待つ間は、二重に操作しないよう自分の番として扱わない
        return this.awaitingResponse ? { ...this.view, isMyTurn: false } : this.view;
    }

    send(command) {
        if (!this.request({ action: 'command', command })) return false;
        this.awaitingResponse = true;
        this.listeners.onUpdate?.();
        return true;
    }

    // ===== サーバーからのメッセージ =====

    receive(message) {
        switch (message.type) {
            case 'joined':
                this.session = { roomCode: message.roomCode, token: message.token, seat: message.seat, name: this.pendingName ?? this.session?.name };
                saveOnlineSession(this.session);
                break;
            case 'lobby':
                this.lobby = message;
                if (message.status === 'lobby') {
                    // ロビーに戻ったら、前のゲームの表示を消す
                    this.view = null;
                    this.queue = [];
                }
                this.listeners.onLobby?.(message);
                break;
            case 'state':
                this.awaitingResponse = false;
                this.queue.push(message);
                this.playQueue();
                break;
            case 'error':
                this.awaitingResponse = false;
                // 前に入っていた部屋が消えていたら、参加情報を消して再接続しない
                if (!this.lobby && message.message === '部屋が見つかりません') {
                    this.session = null;
                    saveOnlineSession(null);
                }
                this.listeners.onError?.(message.message);
                this.listeners.onUpdate?.();
                break;
        }
    }

    // 届いたビューを順に表示する。CPUの手は間を置いて1手ずつ見せる
    playQueue() {
        if (this.queueTimer) return;
        const next = this.queue.shift();
        if (!next) return;

        this.view = hydrateGameView(next.view);
        this.listeners.onUpdate?.();

        if (this.queue.length > 0) {
            const delay = this.queue[0].cpu ? CPU_STEP_DELAY_MS : 0;
            this.queueTimer = setTimeout(() => {
                this.queueTimer = null;
                this.playQueue();
            }, delay);
        }
    }
}
