/**
 * Lambda handler for Card Clash
 *
 * REST API routes:
 *   GET    /records              — public
 *   POST   /records              — admin
 *   PUT    /records/{id}         — admin
 *   DELETE /records/{id}         — admin
 *   GET    /live                 — public, returns current live state
 *   PUT    /live                 — admin, upserts live state + broadcasts via WebSocket
 *   DELETE /live                 — admin, clears live state + broadcasts
 *   GET    /checkin              — public, returns current checkin state
 *   POST   /checkin              — public, participant check-in
 *   PUT    /checkin              — admin, start/stop checkin or remove player
 *   DELETE /checkin              — admin, clear checkin state
 *
 * WebSocket routes (API Gateway WebSocket API):
 *   $connect    — store connectionId in connections table
 *   $disconnect — remove connectionId
 *   $default    — ignored (server-push only)
 */
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';

const TABLE      = process.env.TABLE_NAME      || 'cardclash-records';
const CONN_TABLE = process.env.CONN_TABLE_NAME || 'cardclash-connections';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// Broadcast a message to all active WebSocket connections
async function broadcast(wsEndpoint, payload) {
  if (!wsEndpoint) return;
  const client = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  const data = Buffer.from(JSON.stringify(payload));

  const { Items: conns = [] } = await ddb.send(new ScanCommand({ TableName: CONN_TABLE }));

  await Promise.allSettled(conns.map(async ({ connectionId }) => {
    try {
      await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
    } catch (e) {
      // Stale connection — clean up
      if (e.statusCode === 410 || e.$metadata?.httpStatusCode === 410) {
        await ddb.send(new DeleteCommand({ TableName: CONN_TABLE, Key: { connectionId } }));
      }
    }
  }));
}

export const handler = async (event) => {
  // ── WebSocket events ───────────────────────────────────────────────────────
  if (event.requestContext?.connectionId) {
    const { connectionId, routeKey, domainName, stage } = event.requestContext;

    if (routeKey === '$connect') {
      await ddb.send(new PutCommand({
        TableName: CONN_TABLE,
        Item: { connectionId, connectedAt: Date.now() }
      }));
      // Send current live state immediately on connect
      try {
        const result = await ddb.send(new ScanCommand({
          TableName: TABLE,
          FilterExpression: 'id = :lid',
          ExpressionAttributeValues: { ':lid': '__live__' }
        }));
        const item = (result.Items || [])[0] || null;
        if (item) {
          const wsEndpoint = `https://${domainName}/${stage}`;
          const client = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
          await client.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify(item))
          }));
        }
      } catch (_) { /* best-effort */ }

      // Send current checkin state immediately on connect
      try {
        const checkinResult = await ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { id: '__checkin__' }
        }));
        if (checkinResult.Item) {
          const wsEndpoint = `https://${domainName}/${stage}`;
          const client = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
          await client.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ type: 'checkin', ...checkinResult.Item }))
          }));
        }
      } catch (_) { /* best-effort */ }
      return { statusCode: 200, body: 'Connected' };
    }

    if (routeKey === '$disconnect') {
      await ddb.send(new DeleteCommand({ TableName: CONN_TABLE, Key: { connectionId } }));
      return { statusCode: 200, body: 'Disconnected' };
    }

    // $default — server-push only, ignore client messages
    return { statusCode: 200, body: 'OK' };
  }

  // ── REST events ────────────────────────────────────────────────────────────
  const method   = event.httpMethod;
  const recordId = event.pathParameters?.id || '';
  const resource = event.resource || event.path || '';
  const isLive    = resource.includes('/live') || event.pathParameters?.proxy === 'live';
  const isCheckin = resource.includes('/checkin') || event.pathParameters?.proxy === 'checkin';

  // WebSocket endpoint for broadcasting (injected via env)
  const wsEndpoint = process.env.WS_ENDPOINT || null;

  if (method === 'OPTIONS') return resp(200, {});

  try {
    // ── /live ──────────────────────────────────────────────────────────────
    if (isLive) {
      const LIVE_ID = '__live__';

      if (method === 'GET') {
        const result = await ddb.send(new ScanCommand({
          TableName: TABLE,
          FilterExpression: 'id = :lid',
          ExpressionAttributeValues: { ':lid': LIVE_ID }
        }));
        return resp(200, (result.Items || [])[0] || null);
      }

      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        const item = { id: LIVE_ID, ...body, updatedAt: Date.now() };
        await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
        await broadcast(wsEndpoint, item);
        return resp(200, { ok: true });
      }

      if (method === 'DELETE') {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: LIVE_ID } }));
        await broadcast(wsEndpoint, { active: false });
        return resp(200, { ok: true });
      }
    }

    // ── /checkin ─────────────────────────────────────────────────────────
    if (isCheckin) {
      const CHECKIN_ID = '__checkin__';

      if (method === 'GET') {
        const result = await ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { id: CHECKIN_ID }
        }));
        return resp(200, result.Item || { active: false });
      }

      if (method === 'POST') {
        // Parse and validate nickname
        const body = JSON.parse(event.body || '{}');
        const nickname = (body.nickname || '').trim();
        if (!nickname || nickname.length > 20) {
          return resp(400, { error: '昵称长度需为1-20字符' });
        }

        // Fetch checkin state
        const result = await ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { id: CHECKIN_ID }
        }));
        const state = result.Item;
        if (!state || state.active === false) {
          return resp(403, { error: '签到未开启' });
        }

        // Validate session parameter
        const session = (event.queryStringParameters || {}).session || '';
        if (session !== state.sessionId) {
          return resp(403, { error: '签到链接无效' });
        }

        // Check duplicate nickname (case-insensitive)
        const players = state.players || [];
        const exists = players.some(
          p => p.nickname.toLowerCase() === nickname.toLowerCase()
        );
        if (exists) {
          return resp(409, { error: '该昵称已签到' });
        }

        // Append new player and write back
        const newPlayer = { nickname, checkedInAt: Date.now() };
        players.push(newPlayer);
        state.players = players;
        state.updatedAt = Date.now();
        await ddb.send(new PutCommand({ TableName: TABLE, Item: state }));

        // Broadcast updated checkin state
        await broadcast(wsEndpoint, { type: 'checkin', ...state });

        return resp(201, { ok: true, player: newPlayer });
      }

      if (method === 'PUT') {
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        if (action === 'start') {
          const sessionId = randomBytes(4).toString('hex'); // 8 hex chars, alphanumeric
          const now = Date.now();
          const item = {
            id: CHECKIN_ID,
            active: true,
            eventName: body.eventName || '',
            sessionId,
            players: [],
            createdAt: now,
            updatedAt: now
          };
          await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
          await broadcast(wsEndpoint, { type: 'checkin', ...item });
          return resp(200, { ok: true, sessionId });
        }

        if (action === 'stop') {
          const result = await ddb.send(new GetCommand({
            TableName: TABLE,
            Key: { id: CHECKIN_ID }
          }));
          const state = result.Item;
          if (!state) return resp(404, { error: '签到记录不存在' });

          state.active = false;
          state.updatedAt = Date.now();
          await ddb.send(new PutCommand({ TableName: TABLE, Item: state }));
          await broadcast(wsEndpoint, { type: 'checkin', ...state });
          return resp(200, { ok: true });
        }

        if (action === 'remove') {
          const nickname = (body.nickname || '').trim();
          if (!nickname) return resp(400, { error: '缺少 nickname 参数' });

          const result = await ddb.send(new GetCommand({
            TableName: TABLE,
            Key: { id: CHECKIN_ID }
          }));
          const state = result.Item;
          if (!state) return resp(404, { error: '签到记录不存在' });

          state.players = (state.players || []).filter(
            p => p.nickname.toLowerCase() !== nickname.toLowerCase()
          );
          state.updatedAt = Date.now();
          await ddb.send(new PutCommand({ TableName: TABLE, Item: state }));
          await broadcast(wsEndpoint, { type: 'checkin', ...state });
          return resp(200, { ok: true });
        }

        return resp(400, { error: '无效的 action 参数' });
      }

      if (method === 'DELETE') {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: CHECKIN_ID } }));
        await broadcast(wsEndpoint, { type: 'checkin', id: CHECKIN_ID, active: false, players: [] });
        return resp(200, { ok: true });
      }
    }

    // ── /records ───────────────────────────────────────────────────────────
    if (method === 'GET') {
      const result = await ddb.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'id <> :lid AND id <> :cid',
        ExpressionAttributeValues: { ':lid': '__live__', ':cid': '__checkin__' }
      }));
      return resp(200, (result.Items || []).sort((a, b) => b.savedAt - a.savedAt));
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (!body.id || !body.eventName) return resp(400, { error: 'Missing id or eventName' });
      await ddb.send(new PutCommand({ TableName: TABLE, Item: body }));
      return resp(201, { ok: true });
    }

    if (method === 'PUT' && recordId) {
      const body = JSON.parse(event.body || '{}');
      if (!body.eventName) return resp(400, { error: 'Missing eventName' });
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id: recordId },
        UpdateExpression: 'SET eventName = :n',
        ExpressionAttributeValues: { ':n': body.eventName }
      }));
      return resp(200, { ok: true });
    }

    if (method === 'DELETE' && recordId) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: recordId } }));
      return resp(200, { ok: true });
    }

    return resp(404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    return resp(500, { error: 'Internal server error' });
  }
};
