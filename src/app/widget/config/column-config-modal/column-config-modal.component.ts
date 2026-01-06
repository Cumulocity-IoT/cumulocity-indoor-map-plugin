import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  EventEmitter,
  Output,
  ChangeDetectorRef,
  Input,
} from "@angular/core";
import { BsModalRef } from "ngx-bootstrap/modal";
import { IManagedObject } from "@c8y/client";

export interface ColumnConfig {
  key: string;
  label: string;
  enabled: boolean;
  order: number;
}

@Component({
  selector: "column-config-modal",
  templateUrl: "./column-config-modal.component.html",
  styleUrls: ["./column-config-modal.component.less"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnConfigModalComponent implements OnInit {
  
  @Output() onChange = new EventEmitter<ColumnConfig[]>();
  @Input() currentConfig: ColumnConfig[] = [];
  @Input() devices: IManagedObject[] = []; // Input devices for property discovery

  // Available columns that can be configured
  availableColumns: ColumnConfig[] = [];
  
  // Input: sample device data to detect available properties
  sampleDevices: any[] = [];

  // Custom property creation
  showAddCustomProperty = false;
  customPropertyKey = '';
  customPropertyLabel = '';
  showExamples = false;
  customPropertyAdded = false;
  lastAddedProperty = '';

  constructor(
    public bsModalRef: BsModalRef,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Discover properties from devices or use defaults
    this.discoverPropertiesFromDevices();
    
    // If we have existing config, merge it with our available columns
    if (this.currentConfig && this.currentConfig.length > 0) {
      this.mergeWithExistingConfig();
    }
  }

  /**
   * Discover properties from actual devices or fallback to defaults
   */
  private discoverPropertiesFromDevices(): void {
    if (this.devices && this.devices.length > 0) {
      // Take first 10 devices for analysis
      const sampleDevices = this.devices.slice(0, 10);
      const discoveredProperties = new Set<string>();
      
      // Analyze devices to find all available properties
      sampleDevices.forEach(device => {
        this.extractPropertiesFromObject(device, '', discoveredProperties);
      });
      
      // Convert discovered properties to column configs
      this.availableColumns = Array.from(discoveredProperties)
        .sort() // Alphabetical order
        .map((propKey, index) => {
          const isDefaultEnabled = ['id', 'name', 'type'].includes(propKey);
          return {
            key: propKey,
            label: this.generateLabelFromKey(propKey),
            enabled: isDefaultEnabled,
            order: index + 1
          };
        });
    } else {
      this.generateAllAvailableColumns();
    }
  }

  /**
   * Recursively extract properties from an object (max depth 3)
   */
  private extractPropertiesFromObject(obj: any, prefix: string, properties: Set<string>, depth: number = 0): void {
    if (!obj || typeof obj !== 'object' || depth > 2) return;
    
    Object.keys(obj).forEach(key => {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];
      
      // Skip certain system properties
      if (this.shouldSkipProperty(key, value)) return;
      
      if (value !== null && value !== undefined) {
        // Add primitive properties and simple objects
        if (typeof value !== 'object' || Array.isArray(value)) {
          properties.add(fullKey);
        } else {
          // Add the object itself as a property
          properties.add(fullKey);
          // Recurse into nested objects (limited depth)
          this.extractPropertiesFromObject(value, fullKey, properties, depth + 1);
        }
      }
    });
  }

  /**
   * Skip certain properties that are not useful for display
   */
  private shouldSkipProperty(key: string, value: any): boolean {
    const skipKeys = ['self', 'additionParents', 'assetParents', 'deviceParents', 'childDevices', 'childAssets', 'childAdditions'];
    const skipPatterns = [/^c8y_/];
    
    return skipKeys.includes(key) || 
           skipPatterns.some(pattern => pattern.test(key)) ||
           (typeof value === 'object' && value?.self) || // Skip objects that look like references
           (Array.isArray(value) && value.length > 10); // Skip very large arrays
  }

  /**
   * Generate user-friendly label from property key
   */
  private generateLabelFromKey(key: string): string {
    // Handle nested properties
    const lastPart = key.split('.').pop() || key;
    
    // Convert camelCase and snake_case to Title Case
    return lastPart
      .replace(/[_-]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Generate all available columns with default enabled state (fallback method)
   */
  private generateAllAvailableColumns(): void {
    this.availableColumns = [
      { key: 'name', label: 'Device Name', enabled: true, order: 1 },
      { key: 'id', label: 'Device ID', enabled: true, order: 2 },
      { key: 'type', label: 'Device Type', enabled: true, order: 3 },
      { key: 'status', label: 'Status', enabled: false, order: 4 },
      { key: 'lastMeasurement', label: 'Last Measurement', enabled: false, order: 5 },
      { key: 'batteryLevel', label: 'Battery Level', enabled: false, order: 6 },
      { key: 'rssi', label: 'Signal Strength', enabled: false, order: 7 },
      { key: 'creationTime', label: 'Created', enabled: false, order: 8 },
      { key: 'lastUpdateTime', label: 'Last Updated', enabled: false, order: 9 },
      { key: 'owner', label: 'Owner', enabled: false, order: 10 },
      { key: 'serialNumber', label: 'Serial Number', enabled: false, order: 11 },
      { key: 'firmwareVersion', label: 'Firmware Version', enabled: false, order: 12 },
      { key: 'hardwareModel', label: 'Hardware Model', enabled: false, order: 13 },
      { key: 'location', label: 'Location', enabled: false, order: 14 },
      { key: 'temperature', label: 'Temperature', enabled: false, order: 15 },
      { key: 'humidity', label: 'Humidity', enabled: false, order: 16 },
      { key: 'pressure', label: 'Pressure', enabled: false, order: 17 },
      { key: 'connectionStatus', label: 'Connection Status', enabled: false, order: 18 },
    ];
  }

  /**
   * Merge existing configuration with available columns
   */
  private mergeWithExistingConfig(): void {
    if (!this.currentConfig || this.currentConfig.length === 0) return;
    
    // Update availableColumns with settings from currentConfig
    this.currentConfig.forEach(existingCol => {
      const availableCol = this.availableColumns.find(col => col.key === existingCol.key);
      if (availableCol) {
        availableCol.enabled = existingCol.enabled;
        availableCol.order = existingCol.order;
        // Use the custom label from saved config, not the default one
        availableCol.label = existingCol.label;
      }
    });
    
    // Sort by order
    this.availableColumns.sort((a, b) => a.order - b.order);
  }

  /**
   * Generate default column configuration (legacy method)
   */
  private generateDefaultColumns(): void {
    this.availableColumns = [
      { key: 'name', label: 'Device Name', enabled: true, order: 1 },
      { key: 'id', label: 'Device ID', enabled: true, order: 2 },
      { key: 'type', label: 'Device Type', enabled: true, order: 3 },
      { key: 'status', label: 'Status', enabled: true, order: 4 }, // Enable by default
      { key: 'lastMeasurement', label: 'Last Measurement', enabled: true, order: 5 }, // Enable by default
      { key: 'batteryLevel', label: 'Battery Level', enabled: false, order: 6 },
      { key: 'rssi', label: 'Signal Strength', enabled: false, order: 7 },
      { key: 'creationTime', label: 'Created', enabled: false, order: 8 },
      { key: 'lastUpdateTime', label: 'Last Updated', enabled: false, order: 9 },
      { key: 'owner', label: 'Owner', enabled: false, order: 10 },
      // Additional device properties
      { key: 'serialNumber', label: 'Serial Number', enabled: false, order: 11 },
      { key: 'firmwareVersion', label: 'Firmware Version', enabled: false, order: 12 },
      { key: 'hardwareModel', label: 'Hardware Model', enabled: false, order: 13 },
      { key: 'location', label: 'Location', enabled: false, order: 14 },
      { key: 'temperature', label: 'Temperature', enabled: false, order: 15 },
      { key: 'humidity', label: 'Humidity', enabled: false, order: 16 },
      { key: 'pressure', label: 'Pressure', enabled: false, order: 17 },
      { key: 'connectionStatus', label: 'Connection Status', enabled: false, order: 18 },
    ];
  }

  /**
   * Handle column toggle (ngModel already changed the value)
   */
  onColumnToggle(column: ColumnConfig): void {
    this.cdr.markForCheck();
  }

  /**
   * Toggle column visibility (for button-based toggles)
   */
  toggleColumn(column: ColumnConfig): void {
    const oldState = column.enabled;
    column.enabled = !column.enabled;
    this.cdr.markForCheck();
  }

  /**
   * Move column up in order
   */
  moveColumnUp(index: number): void {
    if (index > 0) {
      const temp = this.availableColumns[index];
      this.availableColumns[index] = this.availableColumns[index - 1];
      this.availableColumns[index - 1] = temp;
      
      // Update order numbers
      this.updateColumnOrder();
      this.cdr.markForCheck();
    }
  }

  /**
   * Move column down in order
   */
  moveColumnDown(index: number): void {
    if (index < this.availableColumns.length - 1) {
      const temp = this.availableColumns[index];
      this.availableColumns[index] = this.availableColumns[index + 1];
      this.availableColumns[index + 1] = temp;
      
      // Update order numbers
      this.updateColumnOrder();
      this.cdr.markForCheck();
    }
  }

  /**
   * Update order numbers based on array position
   */
  private updateColumnOrder(): void {
    this.availableColumns.forEach((column, index) => {
      column.order = index + 1;
    });
  }

  /**
   * Track by function for ngFor
   */
  trackByKey(index: number, column: ColumnConfig): string {
    return column.key;
  }

  /**
   * Toggle add custom property form
   */
  toggleAddCustomProperty(): void {
    this.showAddCustomProperty = !this.showAddCustomProperty;
    if (!this.showAddCustomProperty) {
      this.customPropertyKey = '';
      this.customPropertyLabel = '';
    }
  }

  /**
   * Add custom property to available columns
   */
  addCustomProperty(): void {
    if (!this.customPropertyKey.trim()) return;
    
    const key = this.customPropertyKey.trim();
    const label = this.customPropertyLabel.trim() || this.generateLabelFromKey(key);
    
    // Check if property already exists
    if (this.availableColumns.find(col => col.key === key)) {
      return;
    }
    
    // Add new property
    const newOrder = Math.max(...this.availableColumns.map(c => c.order), 0) + 1;
    this.availableColumns.push({
      key,
      label,
      enabled: true,
      order: newOrder
    });
    
    // Show success feedback
    this.lastAddedProperty = label;
    this.customPropertyAdded = true;
    
    // Reset form after a brief delay to show success message
    setTimeout(() => {
      this.customPropertyKey = '';
      this.customPropertyLabel = '';
      this.customPropertyAdded = false;
      this.showExamples = false;
    }, 2000);
  }

  /**
   * Get enabled columns for display
   */
  getEnabledColumns(): ColumnConfig[] {
    return this.availableColumns.filter(col => col.enabled);
  }

  /**
   * Save configuration and close modal
   */
  saveAndClose(): void {
    // Emit all columns (enabled and disabled) to preserve full configuration
    const enabledColumns = this.availableColumns.filter(c => c.enabled);
    
    this.onChange.emit(this.availableColumns);
    this.bsModalRef.hide();
  }

  /**
   * Cancel and close modal
   */
  cancel(): void {
    this.bsModalRef.hide();
  }
}