/**
 * 手元でオンライン対戦を試すための WebSocket サーバー（AWS と同じ部屋の処理を、保存先をメモリにして動かす）
 * 使い方: npm run dev:server  （画面は別に python3 -m http.server などで public/ を配信する）
 */

import { WebSocketServer } from 'ws';
import { RoomService } from './src/room-service.js';
import { MemoryStore } from './src/memory-store.js';

const PORT = Number(process.env.PORT ?? 8787);
const sockets = new Map();
let connectionCount = 0;

const service = new RoomService({
    store: new MemoryStore(),
    send: async (connectionId, message) => {
        const socket = sockets.get(connectionId);
        if (!socket || socket.readyState !== socket.OPEN) throw new Error('接続が切れています');
        socket.send(JSON.stringify(message));
    }
});

const server = new WebSocketServer({ port: PORT });
server.on('connection', (socket) => {
    const connectionId = `local-${++connectionCount}`;
    sockets.set(connectionId, socket);

    socket.on('message', (data) => {
        let message;
        try {
            message = JSON.parse(data);
        } catch {
            return;
        }
        service.handle(connectionId, message).catch(error => console.error(error));
    });
    socket.on('close', () => {
        sockets.delete(connectionId);
        service.disconnect(connectionId).catch(error => console.error(error));
    });
});

console.log(`オンライン対戦のテスト用サーバー: ws://localhost:${PORT}`);
