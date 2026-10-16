import { describe, it, expect } from 'vitest';
import { createTestServer } from '../server/netplay/testing.js';
import game from '../server/src/game-definition.js';

// 手番の人の接続
const currentOf = (clients) => {
    const { currentPlayerId } = clients[0].last('state').view;
    return clients[currentPlayerId];
};

describe('オンライン対戦（ゲームの定義）', () => {
    it('部屋を作ると部屋番号とトークンが届き、参加者はロビーで互いを見られる', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        expect(a.last('joined').roomCode).toMatch(/^\d{4}$/);
        expect(b.last('joined').seat).toBe(1);
        expect(a.last('lobby').players.map(p => p.name)).toEqual(['あき', 'はる']);
        expect(JSON.stringify(b.last('lobby'))).not.toContain(a.last('joined').token);
    });

    it('1人では始められず、CPU を足せばホストが始められる', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('start');
        expect(a.last('error').code).toBe('not_enough_players');

        await a.send('addCpu');
        await a.send('start');
        expect(a.last('lobby').status).toBe('playing');
        expect(a.last('state').view.viewerId).toBe(0);
    });

    it('ゲームを始めると、それぞれに自分から見た状態が届き、山札の並びは送られない', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        await a.send('start');
        const v1 = a.last('state').view;
        const v2 = b.last('state').view;
        expect(v1.viewerId).toBe(0);
        expect(v2.viewerId).toBe(1);
        expect(v1.poolCount).toBe(40 - 8);
        expect(JSON.stringify(v1)).not.toContain('"pool"');
    });

    it('手番の人の操作は全員に届き、手番でない人の操作と代行の操作は断られる', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる']);
        await clients[0].send('start');
        const current = currentOf(clients);
        const other = clients.find(c => c !== current);

        await other.send('command', { command: { type: 'draw' } });
        expect(other.last('error').message).toBe('あなたの番ではありません');
        await current.send('command', { command: { type: 'proxy' } });
        expect(current.last('error').code).toBe('rejected');

        await current.send('command', { command: { type: 'draw' } });
        expect(other.last('state').view.holding.from).toBe('pool');
        await current.send('command', { command: { type: 'discard' } });
        expect(other.last('state').view.table).toHaveLength(1);
        expect(other.last('state').view.currentPlayerId).toBe(clients.indexOf(other));
    });

    it('CPU の手はサーバーが進め、1手ずつ cpu: true で届く', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('addCpu');
        await a.send('start');
        // CPU が先手なら、開始時に CPU の手が届いている。自分が打ったあとの CPU の手だけを数える
        expect(a.last('state').view.currentPlayerId).toBe(0);
        await a.send('command', { command: { type: 'draw' } });
        a.clear();
        await a.send('command', { command: { type: 'discard' } });
        expect(a.all('state').filter(m => m.cpu)).toHaveLength(2); // 引く／置く（場に出す）の2手
        expect(a.last('state').view.currentPlayerId).toBe(0);
    });

    it('接続が切れても、トークンで同じ席に戻ってゲームの続きが届く', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        await a.send('start');
        const b2 = await server.reconnect(b);
        expect(b2.last('joined').seat).toBe(1);
        expect(b2.last('state').view.viewerId).toBe(1);
        expect(a.last('lobby').players[1].connected).toBe(true);
    });

    it('対戦中に部屋を出た人の手番は、CPU が代わりに打つ', async () => {
        const server = createTestServer(game);
        const clients = await server.createRoom(['あき', 'はる']);
        await clients[0].send('start');
        const current = currentOf(clients);
        const other = clients.find(c => c !== current);

        await current.send('leave');
        const view = other.last('state').view;
        expect(view.players[clients.indexOf(current)].proxy).toBe(true);
        // 抜けた人の番は CPU が打ち終えて、残った人の番になっている
        expect(view.currentPlayerId).toBe(clients.indexOf(other));
        expect(other.all('state').filter(m => m.cpu).length).toBeGreaterThanOrEqual(2);
    });

    it('対戦後は、ホストが同じ顔ぶれで再戦でき、誰でも部屋に戻れる', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あき']);
        await a.send('addCpu');
        await a.send('start');
        // 自分は毎回引いて場に出し、CPU に勝たせて終わらせる
        for (let i = 0; i < 200 && a.last('lobby').status === 'playing'; i++) {
            await a.send('command', { command: { type: 'draw' } });
            await a.send('command', { command: { type: 'discard' } });
        }
        expect(a.last('lobby').status).toBe('ended');
        expect(a.last('state').view.result).not.toBeNull();

        const matchId = a.last('lobby').matchId;
        await a.send('start');
        expect(a.last('lobby').status).toBe('playing');
        expect(a.last('lobby').matchId).not.toBe(matchId);
        expect(a.last('state').view.result).toBeNull();
    });

    it('ロビーでホストが抜けたら、次の人がホストを引き継ぐ', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あき', 'はる']);
        await a.send('leave');
        const lobby = b.last('lobby');
        expect(lobby.players.map(p => p.name)).toEqual(['はる']);
        expect(lobby.hostSeat).toBe(lobby.seat);
    });
});
