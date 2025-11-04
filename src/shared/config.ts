import * as fs from 'fs';
import * as path from 'path';

export interface ForwardingConfig {
  enabled: boolean;
  destinationHost: string;
  destinationPort: number;
  protocol: 'tcp' | 'http';
  timeout: number;
  retryAttempts: number;
  filterDevices?: string[];
}

export interface FilteringConfig {
  enabled: boolean;
  skipStaffNumbers: string[];
  skipEventTypes: string[];
}

export interface LoggingConfig {
  logForwarding: boolean;
  logFiltering: boolean;
}

export interface CallTrackingConfig {
  enabled: boolean;
  trackedItems: string[];
}

export interface CameraConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  streamUrl: string;
}

export interface CCTVConfig {
  enabled: boolean;
  captureSnapshot: boolean;
  snapshotPath: string;
  cameras: { [deviceName: string]: CameraConfig };
}

export interface AppConfig {
  forwarding: ForwardingConfig;
  filtering: FilteringConfig;
  cctv: CCTVConfig;
  logging: LoggingConfig;
  callTracking: CallTrackingConfig;
}

class ConfigManager {
  private config: AppConfig;
  private configPath: string;

  constructor(configPath: string = './config.json') {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    try {
      const configFile = fs.readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(configFile) as AppConfig;
      
      // Ensure callTracking config exists
      if (!config.callTracking) {
        config.callTracking = { enabled: false, trackedItems: [] };
      }
      
      console.log('Configuration loaded successfully');
      return config;
    } catch (error: any) {
      console.warn(`Could not load config from ${this.configPath}, using defaults`);
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): AppConfig {
    return {
      forwarding: {
        enabled: false,
        destinationHost: 'localhost',
        destinationPort: 4000,
        protocol: 'tcp',
        timeout: 5000,
        retryAttempts: 3,
        filterDevices: []
      },
      filtering: {
        enabled: false,
        skipStaffNumbers: [],
        skipEventTypes: []
      },
      cctv: {
        enabled: false,
        captureSnapshot: false,
        snapshotPath: './snapshots',
        cameras: {}
      },
      logging: {
        logForwarding: true,
        logFiltering: true
      },
      callTracking: {
        enabled: false,
        trackedItems: []
      }
    };
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public getForwardingConfig(): ForwardingConfig {
    return this.config.forwarding;
  }

  public getFilteringConfig(): FilteringConfig {
    return this.config.filtering;
  }

  public getLoggingConfig(): LoggingConfig {
    return this.config.logging;
  }

  public getCCTVConfig(): CCTVConfig {
    return this.config.cctv;
  }

  public getCallTrackingConfig(): CallTrackingConfig {
    return this.config.callTracking;
  }

  public getCameraConfig(deviceName: string): CameraConfig | undefined {
    return this.config.cctv.cameras[deviceName];
  }

  public reloadConfig(): void {
    this.config = this.loadConfig();
    console.log('Configuration reloaded');
  }

  public shouldSkipStaff(staffNo: string): boolean {
    if (!this.config.filtering.enabled) {
      return false;
    }
    return this.config.filtering.skipStaffNumbers.includes(staffNo);
  }

  public shouldSkipEventType(eventType: string): boolean {
    if (!this.config.filtering.enabled) {
      return false;
    }
    return this.config.filtering.skipEventTypes.includes(eventType);
  }

  public isTrackingEnabled(): boolean {
    return this.config.callTracking.enabled;
  }

  public getTrackedItems(): string[] {
    return this.config.callTracking.trackedItems;
  }

  public setTrackedItems(items: string[]): void {
    this.config.callTracking.enabled = items.length > 0;
    this.config.callTracking.trackedItems = items;
    // Note: This does not save to config.json, it's an in-memory change.
    // A separate mechanism would be needed to persist this.
  }

  public shouldForwardDevice(deviceName: string): boolean {
    const filterDevices = this.config.forwarding.filterDevices;
    
    // If no device filter specified, forward all devices
    if (!filterDevices || filterDevices.length === 0) {
      return true;
    }
    
    // Check if device name matches any filter (case-insensitive partial match)
    return filterDevices.some(filterDevice => 
      deviceName.toLowerCase().includes(filterDevice.toLowerCase())
    );
  }
}

export const configManager = new ConfigManager();
