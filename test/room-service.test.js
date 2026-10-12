import { describe, it, expect, beforeEach } from 'vitest';
import { RoomService } from '../server/src/room-service.js';
import { MemoryStore } from '../server/src/memory-store.js';

describe('オンライン対戦の部屋', () => {
    let service;
    let store;
    let inbox; // 接続IDごとに届いたメッセージ

    const messages = (connectionId, type) => (inbox.get(connectionId) ?? []).filter(m => !type || m.type === type);
    const last = (connectionId, type) => messages(connectionId, type).at(-1);
    const send = (connectionId, message) => service.handle(connectionId, message);

    beforeEach(() => {
        store = new MemoryStore();
        inbox = new Map();
        let tokenCount = 0;
        service = new RoomService({
            store,
            send: async (connectionId, message) => {
                if (!inbox.has(connectionId)) inbox.set(connectionId, []);
                inbox.get(connectionId).push(structuredClone(message));
            },
            createToken: () => `token-${++tokenCount}`
        });
    });

    // 2人の部屋を作ってゲームを始める
    const startTwoPlayers = async () => {
        await send('c1', { action: 'create', name: 'あき' });
        const { roomCode } = last('c1', 'joined');
        await send('c2', { action: 'join', roomCode, name: 'はる' });
        await send('c1', { action: 'start' });
        return roomCode;
    };

    // 手番の人の接続ID
    const currentConnection = () => (last('c1', 'state').view.currentPlayerId === 0 ? 'c1' : 'c2');

    it('部屋を作ると部屋番号と再接続用のトークンが届き、参加者はロビーで互いを見られる', async () => {
        await send('c1', { action: 'create', name: 'あき' });
        const joined = last('c1', 'joined');
        expect(joined.roomCode).toMatch(/^\d{5}$/);
        expect(joined.seat).toBe(0);
        expect(joined.token).toBe('token-1');

        await send('c2', { action: 'join', roomCode: joined.roomCode, name: 'はる' });
        expect(last('c2', 'joined').seat).toBe(1);
        expect(last('c1', 'lobby').players.map(p => p.name)).toEqual(['あき', 'はる']);
        // 他の人のトークンはロビーに入らない
        expect(JSON.stringify(last('c2', 'lobby'))).not.toContain('token-1');
    });

    it('存在しない部屋・満員の部屋には入れない', async () => {
        await send('c9', { action: 'join', roomCode: '00000', name: 'x' });
        expect(last('c9', 'error').message).toBe('部屋が見つかりません');

        await send('c1', { action: 'create', name: 'あき' });
        const { roomCode } = last('c1', 'joined');
        await send('c1', { action: 'addCpu' });
        await send('c1', { action: 'addCpu' });
        await send('c1', { action: 'addCpu' });
        await send('c2', { action: 'join', roomCode, name: 'はる' });
        expect(last('c2', 'error').message).toBe('この部屋は満員です');
    });

    it('ロビーの操作は部屋を作った人だけができ、1人では始められない', async () => {
        await send('c1', { action: 'create', name: 'あき' });
        const { roomCode } = last('c1', 'joined');
        await send('c1', { action: 'start' });
        expect(last('c1', 'error').message).toBe('2人以上で始めてください');

        await send('c2', { action: 'join', roomCode, name: 'はる' });
        await send('c2', { action: 'addCpu' });
        expect(last('c2', 'error').message).toBe('部屋を作った人だけが操作できます');

        await send('c1', { action: 'addCpu' });
        expect(last('c2', 'lobby').players.map(p => p.isCPU)).toEqual([false, false, true]);

        await send('c1', { action: 'removePlayer', seat: 1 });
        expect(last('c1', 'error').message).toBe('外せるのはCPUだけです');
        await send('c1', { action: 'removePlayer', seat: 2 });
        expect(last('c1', 'lobby').players).toHaveLength(2);
    });

    it('ゲームを始めると、それぞれに自分から見た状態が届き、山札の並びは送られない', async () => {
        await startTwoPlayers();
        const v1 = last('c1', 'state').view;
        const v2 = last('c2', 'state').view;
        expect(v1.viewerId).toBe(0);
        expect(v2.viewerId).toBe(1);
        expect(v1.players[0].garden).toEqual(v2.players[0].garden);
        expect(v1.poolCount).toBe(40 - 8);
        expect(JSON.stringify(v1)).not.toContain('"pool"');
        expect(last('c1', 'lobby').status).toBe('playing');
    });

    it('手番の人の操作は全員に届き、手番でない人の操作は断られる', async () => {
        await startTwoPlayers();
        const current = currentConnection();
        const other = current === 'c1' ? 'c2' : 'c1';

        await send(other, { action: 'command', command: { type: 'draw' } });
        expect(last(other, 'error').message).toBe('あなたの番ではありません');

        await send(current, { action: 'command', command: { type: 'draw' } });
        expect(last(other, 'state').view.holding.from).toBe('pool');
        await send(current, { action: 'command', command: { type: 'discard' } });
        expect(last(other, 'state').view.table).toHaveLength(1);
        expect(last(other, 'state').view.currentPlayerId).toBe(other === 'c1' ? 0 : 1);
    });

    it('CPUの手はサーバーが進め、1手ずつ届く', async () => {
        await send('c1', { action: 'create', name: 'あき' });
        await send('c1', { action: 'addCpu' });
        await send('c1', { action: 'start' });

        let view = last('c1', 'state').view;
        if (view.currentPlayerId === 1) {
            // CPUが先手なら、引く／置く（捨てる）の2手が順に届いている
            expect(messages('c1', 'state').filter(m => m.cpu)).toHaveLength(2);
        } else {
            await send('c1', { action: 'command', command: { type: 'draw' } });
            await send('c1', { action: 'command', command: { type: 'discard' } });
        }
        view = last('c1', 'state').view;
        expect(view.currentPlayerId === 0 || view.phase === 'end').toBe(true);
    });

    it('接続が切れても、トークンで同じ席に戻ってゲームの続きが届く', async () => {
        const roomCode = await startTwoPlayers();
        await service.disconnect('c2');
        expect(last('c1', 'lobby').players[1].connected).toBe(false);

        await send('c3', { action: 'join', roomCode, token: 'token-2' });
        expect(last('c3', 'joined').seat).toBe(1);
        expect(last('c3', 'state').view.viewerId).toBe(1);
        expect(last('c1', 'lobby').players[1].connected).toBe(true);

        // ゲーム中は新しい人は入れない
        await send('c4', { action: 'join', roomCode, name: 'なつ' });
        expect(last('c4', 'error').message).toBe('この部屋はゲームが始まっています');
    });

    it('部屋を作った人がロビーに戻すと、同じメンバーで次のゲームを始められる', async () => {
        await startTwoPlayers();
        await send('c2', { action: 'backToLobby' });
        expect(last('c2', 'error').message).toBe('部屋を作った人だけが操作できます');

        await send('c1', { action: 'backToLobby' });
        expect(last('c2', 'lobby').status).toBe('lobby');
        await send('c1', { action: 'start' });
        expect(last('c2', 'lobby').status).toBe('playing');
    });

    it('同時に保存がぶつかったら読み直してやり直す', async () => {
        await send('c1', { action: 'create', name: 'あき' });
        const original = store.putRoom.bind(store);
        let failures = 1;
        store.putRoom = async (room, previousVersion) => {
            if (failures-- > 0) {
                const current = await store.getRoom(room.code);
                current.version += 1;
                store.rooms.set(room.code, current); // 他の操作が先に保存したことにする
            }
            return original(room, previousVersion);
        };
        await send('c1', { action: 'addCpu' });
        expect(last('c1', 'lobby').players).toHaveLength(2);
    });
});
