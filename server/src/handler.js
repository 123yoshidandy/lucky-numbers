/**
 * API Gateway（WebSocket）から呼ばれる Lambda の入口
 * $connect は受け付けるだけ、$disconnect で切断を片付け、それ以外のメッセージは部屋の処理に渡す
 */

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { RoomService } from './room-service.js';
import { DynamoStore } from './dynamo-store.js';

const store = new DynamoStore(process.env.TABLE_NAME);
const clients = new Map(); // 送信用のクライアントは呼び出しをまたいで使い回す

const createService = ({ domainName, stage }) => {
    const endpoint = `https://${domainName}/${stage}`;
    if (!clients.has(endpoint)) {
        clients.set(endpoint, new ApiGatewayManagementApiClient({ endpoint }));
    }
    const client = clients.get(endpoint);
    const send = (connectionId, message) => client.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(message)
    }));
    return new RoomService({ store, send });
};

export const handler = async (event) => {
    const { routeKey, connectionId } = event.requestContext;
    const service = createService(event.requestContext);

    if (routeKey === '$connect') {
        return { statusCode: 200 };
    }
    if (routeKey === '$disconnect') {
        await service.disconnect(connectionId);
        return { statusCode: 200 };
    }

    let message;
    try {
        message = JSON.parse(event.body ?? '{}');
    } catch {
        return { statusCode: 400 };
    }
    await service.handle(connectionId, message);
    return { statusCode: 200 };
};
