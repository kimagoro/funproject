import * as net from 'net';
import { parseString } from 'xml2js';
import { DatabaseManager } from '../shared/database';
import { configManager } from '../shared/config';
import { eventForwarder } from '../shared/forwarder';
import { cctvService } from '../shared/cctv';
import { wsBroadcaster } from '../shared/websocket';

const PORT = 3001;
const db = new DatabaseManager();

interface ParsedEvent {
  Event: {
    ETYPE: string[];
    TRDESC: string[];
    STAFFNAME: string[];
    STAFFNO: string[];
    DEVNAME: string[];
    TRDATE: string[];
    TRTIME: string[];
  };
}

const server = net.createServer((socket: net.Socket) => {
    console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    let buffer = '';

    socket.on('data', (data: Buffer) => {
      buffer += data.toString();
      
      let endTagIndex;
      while ((endTagIndex = buffer.indexOf('</Event>')) !== -1) {
        const xmlEndIndex = endTagIndex + '</Event>'.length;
        const xmlMessage = buffer.substring(0, xmlEndIndex).trim();
        buffer = buffer.substring(xmlEndIndex);

        if (xmlMessage) {
          parseString(xmlMessage, { explicitArray: true }, (err, result: ParsedEvent) => {
            if (err) {
              console.error('Invalid XML received:', err.message);
              socket.write(JSON.stringify({ status: 'error', message: 'Invalid XML format' }) + '\n');
              return;
            }

            try {
              const event = result.Event as any;
              
              const eventData = {
                etype: event.ETYPE[0],
                trdesc: event.TRDESC[0],
                staffname: event.STAFFNAME[0],
                staffno: event.STAFFNO[0],
                cardno: event.CARDNO ? event.CARDNO[0] : undefined,
                devname: event.DEVNAME[0],
                trdate: event.TRDATE[0],
                trtime: event.TRTIME[0],
                raw_xml: xmlMessage
              };

              const loggingConfig = configManager.getLoggingConfig();
              
              // Always store event in database (filtering only applies to forwarding)
              const id = db.insertEvent(eventData);
              console.log(`Stored event #${id}: ${eventData.staffname} - ${eventData.trdesc}`);
              
              // Broadcast new event to WebSocket clients immediately
              const storedEvent = db.getEventById(id);
              if (storedEvent) {
                wsBroadcaster.broadcastNewEvent(storedEvent);
              }
              
              // Update staff reference table
              db.upsertStaff(eventData.staffno, eventData.staffname, eventData.cardno);
              
              // Determine if this is an IN or OUT event and update snapshots
              const isInEvent = eventData.trdesc.toLowerCase().includes('in') || 
                                eventData.devname.toLowerCase().includes('in');

              const cctvConfig = configManager.getCCTVConfig();
              if (cctvConfig.enabled && cctvConfig.captureSnapshot) {
                cctvService.captureSnapshot(eventData.devname, id).then((result) => {
                  if (result.success && result.imagePath) {
                    db.updateEventSnapshot(id, result.imagePath, result.streamUrl);
                    console.log(`Snapshot captured for event #${id}: ${result.imagePath}`);
                    
                    // Update staff last IN/OUT snapshot if cardno exists
                    if (eventData.cardno) {
                      db.updateStaffSnapshot(eventData.cardno, result.imagePath, isInEvent);
                      console.log(`Updated staff ${isInEvent ? 'IN' : 'OUT'} snapshot for card #${eventData.cardno}`);
                    }
                  } else {
                    if (result.streamUrl) {
                      db.updateEventSnapshot(id, '', result.streamUrl);
                    }
                    if (loggingConfig.logForwarding) {
                      console.log(`Snapshot capture failed for event #${id}: ${result.error}`);
                    }
                  }
                }).catch((err) => {
                  console.error(`Snapshot exception for event #${id}:`, err.message);
                });
              }

              const forwardingConfig = configManager.getForwardingConfig();
              if (forwardingConfig.enabled) {
                // Apply filtering only to forwarding
                let shouldForward = true;
                let skipReason = '';
                
                if (configManager.shouldSkipStaff(eventData.staffno)) {
                  shouldForward = false;
                  skipReason = `Staff #${eventData.staffno} filtered`;
                  if (loggingConfig.logFiltering) {
                    console.log(`Forwarding skipped for staff #${eventData.staffno} (filtered)`);
                  }
                } else if (configManager.shouldSkipEventType(eventData.etype)) {
                  shouldForward = false;
                  skipReason = `Event type ${eventData.etype} filtered`;
                  if (loggingConfig.logFiltering) {
                    console.log(`Forwarding skipped for event type ${eventData.etype} (filtered)`);
                  }
                } else if (!configManager.shouldForwardDevice(eventData.devname)) {
                  shouldForward = false;
                  skipReason = `Device "${eventData.devname}" not in forward list`;
                  if (loggingConfig.logFiltering) {
                    console.log(`Forwarding skipped for device "${eventData.devname}" (not in filter list)`);
                  }
                }
                
                if (shouldForward) {
                  eventForwarder.forwardEvent(xmlMessage).then((result) => {
                    if (result.success) {
                      if (loggingConfig.logForwarding) {
                        console.log(`Event #${id} forwarded successfully`);
                      }
                    } else {
                      console.error(`Failed to forward event #${id}: ${result.error}`);
                    }
                  }).catch((err) => {
                    console.error(`Forwarding exception for event #${id}:`, err.message);
                  });
                } else {
                  if (loggingConfig.logForwarding) {
                    console.log(`Event #${id} not forwarded: ${skipReason}`);
                  }
                }
              }
              
              socket.write(JSON.stringify({ 
                status: 'success', 
                id, 
                event: eventData.trdesc,
                forwarded: forwardingConfig.enabled 
              }) + '\n');
            } catch (error: any) {
              console.error('Error processing event:', error.message);
              socket.write(JSON.stringify({ status: 'error', message: 'Error processing event' }) + '\n');
            }
          });
        }
      }
    });

    socket.on('end', () => {
      console.log('Client disconnected');
    });

  socket.on('error', (err: Error) => {
    console.error('Socket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`TCP server listening on port ${PORT}`);
  console.log(`Waiting for XML event data...`);
  
  const config = configManager.getConfig();
  console.log(`Forwarding: ${config.forwarding.enabled ? 'ENABLED' : 'DISABLED'}`);
  if (config.forwarding.enabled) {
    console.log(`  Destination: ${config.forwarding.destinationHost}:${config.forwarding.destinationPort}`);
    if (config.forwarding.filterDevices && config.forwarding.filterDevices.length > 0) {
      console.log(`  Device Filter: ${config.forwarding.filterDevices.join(', ')}`);
    } else {
      console.log(`  Device Filter: ALL DEVICES`);
    }
  }
  console.log(`Filtering: ${config.filtering.enabled ? 'ENABLED' : 'DISABLED'}`);
  if (config.filtering.enabled && config.filtering.skipStaffNumbers.length > 0) {
    console.log(`  Skipping staff numbers: ${config.filtering.skipStaffNumbers.join(', ')}`);
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down TCP server...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});