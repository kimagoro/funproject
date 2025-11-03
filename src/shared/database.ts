import Database from 'better-sqlite3';
import * as path from 'path';

export interface EventRecord {
  id?: number;
  etype: string;
  trdesc: string;
  staffname: string;
  staffno: string;
  cardno?: string;
  devname: string;
  trdate: string;
  trtime: string;
  timestamp: number;
  raw_xml?: string;
  snapshot_path?: string;
  stream_url?: string;
}

export interface StaffRecord {
  staffno: string;
  staffname: string;
  cardno?: string;
  last_in_snapshot?: string;
  last_out_snapshot?: string;
  last_updated?: number;
}

export interface DoorCameraConfig {
  id?: number;
  devname: string;
  camera_ip: string;
  camera_port: number;
  camera_username: string;
  camera_password: string;
  stream_url?: string;
  onvif_enabled: boolean;
}

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath: string = './data/data.db') {
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  private initDatabase(): void {
    // Events table with cardno
    const createEventsTableSQL = `
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        etype TEXT NOT NULL,
        trdesc TEXT NOT NULL,
        staffname TEXT NOT NULL,
        staffno TEXT NOT NULL,
        cardno TEXT,
        devname TEXT NOT NULL,
        trdate TEXT NOT NULL,
        trtime TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        raw_xml TEXT,
        snapshot_path TEXT,
        stream_url TEXT
      )
    `;
    
    // Staff reference table
    const createStaffTableSQL = `
      CREATE TABLE IF NOT EXISTS staff (
        staffno TEXT PRIMARY KEY,
        staffname TEXT NOT NULL,
        cardno TEXT,
        last_in_snapshot TEXT,
        last_out_snapshot TEXT,
        last_updated INTEGER
      )
    `;
    
    // Door-to-camera mapping table
    const createDoorCameraTableSQL = `
      CREATE TABLE IF NOT EXISTS door_cameras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        devname TEXT UNIQUE NOT NULL,
        camera_ip TEXT NOT NULL,
        camera_port INTEGER DEFAULT 80,
        camera_username TEXT NOT NULL,
        camera_password TEXT NOT NULL,
        stream_url TEXT,
        onvif_enabled INTEGER DEFAULT 1
      )
    `;
    
    this.db.exec(createEventsTableSQL);
    this.db.exec(createStaffTableSQL);
    this.db.exec(createDoorCameraTableSQL);
    
    // Create indexes for better query performance
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_trdate ON events(trdate DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_devname ON events(devname)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_staffno ON events(staffno)');
      console.log('Database indexes created successfully');
    } catch (error) {
      console.warn('Index creation warning:', error);
    }
    
    // Add cardno column to existing events table if it doesn't exist
    try {
      this.db.exec('ALTER TABLE events ADD COLUMN cardno TEXT');
    } catch (error) {
      // Column already exists
    }
    
    console.log('Database initialized successfully');
  }

  insertEvent(event: Omit<EventRecord, 'id' | 'timestamp'>): number {
    const timestamp = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO events (etype, trdesc, staffname, staffno, cardno, devname, trdate, trtime, timestamp, raw_xml, snapshot_path, stream_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      event.etype,
      event.trdesc,
      event.staffname,
      event.staffno,
      event.cardno || null,
      event.devname,
      event.trdate,
      event.trtime,
      timestamp,
      event.raw_xml || null,
      event.snapshot_path || null,
      event.stream_url || null
    );
    return info.lastInsertRowid as number;
  }

  updateEventSnapshot(id: number, snapshotPath: string, streamUrl?: string): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE events 
        SET snapshot_path = ?, stream_url = ?
        WHERE id = ?
      `);
      const info = stmt.run(snapshotPath, streamUrl || null, id);
      return info.changes > 0;
    } catch (error) {
      console.error('Error updating event snapshot:', error);
      return false;
    }
  }

  getAllEvents(): EventRecord[] {
    const stmt = this.db.prepare('SELECT * FROM events ORDER BY timestamp DESC');
    return stmt.all() as EventRecord[];
  }

  getEventById(id: number): EventRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    return stmt.get(id) as EventRecord | undefined;
  }

  getRecentEvents(limit: number = 100): EventRecord[] {
    const stmt = this.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit) as EventRecord[];
  }

  getEventsByDateRange(fromTimestamp?: number, toTimestamp?: number, limit?: number): EventRecord[] {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];
    
    if (fromTimestamp) {
      query += ' AND timestamp >= ?';
      params.push(fromTimestamp);
    }
    
    if (toTimestamp) {
      query += ' AND timestamp <= ?';
      params.push(toTimestamp);
    }
    
    query += ' ORDER BY timestamp DESC';
    
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as EventRecord[];
  }

  getEventsFromLastDays(days: number = 7): EventRecord[] {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare('SELECT * FROM events WHERE timestamp >= ? ORDER BY timestamp DESC');
    return stmt.all(cutoffTime) as EventRecord[];
  }

  // Staff management methods
  upsertStaff(staffno: string, staffname: string, cardno?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO staff (staffno, staffname, cardno, last_updated)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(staffno) DO UPDATE SET
        staffname = excluded.staffname,
        cardno = COALESCE(excluded.cardno, staff.cardno),
        last_updated = excluded.last_updated
    `);
    stmt.run(staffno, staffname, cardno || null, Date.now());
  }

  updateStaffSnapshot(cardno: string, snapshotPath: string, isIn: boolean): boolean {
    try {
      const column = isIn ? 'last_in_snapshot' : 'last_out_snapshot';
      const stmt = this.db.prepare(`
        UPDATE staff 
        SET ${column} = ?, last_updated = ?
        WHERE cardno = ?
      `);
      const info = stmt.run(snapshotPath, Date.now(), cardno);
      return info.changes > 0;
    } catch (error) {
      console.error('Error updating staff snapshot:', error);
      return false;
    }
  }

  getStaffByCardNo(cardno: string): StaffRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM staff WHERE cardno = ?');
    return stmt.get(cardno) as StaffRecord | undefined;
  }

  getAllStaff(): StaffRecord[] {
    const stmt = this.db.prepare('SELECT * FROM staff ORDER BY staffname');
    return stmt.all() as StaffRecord[];
  }

  // Door-Camera configuration methods
  upsertDoorCamera(config: Omit<DoorCameraConfig, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO door_cameras (devname, camera_ip, camera_port, camera_username, camera_password, stream_url, onvif_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(devname) DO UPDATE SET
        camera_ip = excluded.camera_ip,
        camera_port = excluded.camera_port,
        camera_username = excluded.camera_username,
        camera_password = excluded.camera_password,
        stream_url = excluded.stream_url,
        onvif_enabled = excluded.onvif_enabled
    `);
    stmt.run(
      config.devname,
      config.camera_ip,
      config.camera_port,
      config.camera_username,
      config.camera_password,
      config.stream_url || null,
      config.onvif_enabled ? 1 : 0
    );
  }

  getDoorCamera(devname: string): DoorCameraConfig | undefined {
    const stmt = this.db.prepare('SELECT * FROM door_cameras WHERE devname = ?');
    const row = stmt.get(devname) as any;
    if (!row) return undefined;
    return {
      ...row,
      onvif_enabled: row.onvif_enabled === 1
    };
  }

  getAllDoorCameras(): DoorCameraConfig[] {
    const stmt = this.db.prepare('SELECT * FROM door_cameras ORDER BY devname');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      ...row,
      onvif_enabled: row.onvif_enabled === 1
    }));
  }

  deleteDoorCamera(devname: string): boolean {
    const stmt = this.db.prepare('DELETE FROM door_cameras WHERE devname = ?');
    const info = stmt.run(devname);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
