import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export class WebSocketBroadcaster {
  private static instance: WebSocketBroadcaster;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  private constructor() {}

  public static getInstance(): WebSocketBroadcaster {
    if (!WebSocketBroadcaster.instance) {
      WebSocketBroadcaster.instance = new WebSocketBroadcaster();
    }
    return WebSocketBroadcaster.instance;
  }

  public initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('WebSocket client connected');
      this.clients.add(ws);

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Send initial connection success message
      ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
    });

    console.log('WebSocket server initialized on /ws');
  }

  public broadcastNewEvent(event: any): void {
    console.log(`Broadcasting new event to ${this.clients.size} clients. Event ID: ${event.id}, Is Tracked: ${event.isTracked}`);
    if (this.clients.size === 0) {
      console.log('No WebSocket clients connected');
      return;
    }

    const message = JSON.stringify({
      type: 'newEvent',
      data: event
    });

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log('Event broadcasted to client');
      }
    });
  }

  public broadcastCallTrackingEvent(event: any): void {
    console.log(`Broadcasting call tracking event to ${this.clients.size} clients for Staff: ${event.staffname}`);
    const message = JSON.stringify({
      type: 'callTracking',
      data: event
    });

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public getClientCount(): number {
    return this.clients.size;
  }
}

export const wsBroadcaster = WebSocketBroadcaster.getInstance();
