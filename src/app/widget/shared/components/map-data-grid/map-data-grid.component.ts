import { Component, EventEmitter, Input, OnInit, Output, OnChanges, SimpleChanges } from "@angular/core";
import { RouterModule } from "@angular/router";
import {
  ActionControl,
  BuiltInActionType,
  BulkActionControl,
  Column,
  CoreModule,
  CustomColumnConfig,
  GridConfig,
  Pagination,
  Row,
} from "@c8y/ngx-components";
import { DeviceGridModule } from "@c8y/ngx-components/device-grid";
import { IManagedObject } from "@c8y/client";
import { ColumnConfig } from "../../../../models/data-point-indoor-map.model";

/**
 * This is an example of using DataGridComponent to display a static set of data
 * and allow user for filering and sorting it on client side.
 */
@Component({
  selector: "map-data-grid",
  templateUrl: "./map-data-grid.component.html",
  standalone: true,
  imports: [CoreModule, DeviceGridModule, RouterModule],
})
export class MapDataGridComponent implements OnInit, OnChanges {
  @Input() devices: IManagedObject[] = [];
  @Input() columnConfig: ColumnConfig[] = [];
  @Output() rowClicked = new EventEmitter<Row>();

  /** This will be used as a title for the data grid. */
  title = "Devices";
  
  /**
   * This defines what columns will be displayed in the grid.
   * Will be dynamically generated based on columnConfig or use defaults.
   */
  columns: Column[] = [];
  
  // Default column definitions
  private defaultColumns: Column[] = [
    {
      name: "id",
      header: "ID",
      path: "id",
      filterable: false,
    },
    {
      name: "name",
      header: "Name",
      path: "name",
      filterable: false,
    },
    {
      name: "type",
      header: "Type",
      path: "type",
      filterable: false,
    },
    {
      name: "status",
      header: "Status",
      path: "c8y_Availability.status",
      filterable: false,
    },
    {
      name: "lastMeasurement",
      header: "Last Measurement",
      path: "lastUpdated",
      filterable: false,
    },
    {
      name: "batteryLevel",
      header: "Battery Level",
      path: "c8y_Battery.level",
      filterable: false,
    },
    {
      name: "rssi",
      header: "Signal Strength",
      path: "c8y_Mobile.rssi",
      filterable: false,
    },
    {
      name: "creationTime",
      header: "Creation time",
      path: "creationTime",
      filterable: false,
    },
    {
      name: "lastUpdateTime",
      header: "Last updated",
      path: "lastUpdated",
      filterable: false,
    },
    {
      name: "owner",
      header: "Owner",
      path: "owner",
      filterable: false,
    },
    // Additional device properties
    {
      name: "serialNumber",
      header: "Serial Number",
      path: "c8y_Hardware.serialNumber",
      filterable: false,
    },
    {
      name: "firmwareVersion",
      header: "Firmware Version",
      path: "c8y_Firmware.version",
      filterable: false,
    },
    {
      name: "hardwareModel",
      header: "Hardware Model",
      path: "c8y_Hardware.model",
      filterable: false,
    },
    {
      name: "location",
      header: "Location",
      path: "c8y_Position",
      filterable: false,
    },
    {
      name: "temperature",
      header: "Temperature",
      path: "c8y_Temperature.T.value",
      filterable: false,
    },
    {
      name: "humidity",
      header: "Humidity",
      path: "c8y_Humidity.RH.value",
      filterable: false,
    },
    {
      name: "pressure",
      header: "Pressure",
      path: "c8y_Pressure.P.value",
      filterable: false,
    },
    {
      name: "connectionStatus",
      header: "Connection Status",
      path: "c8y_Connection.status",
      filterable: false,
    },
  ];
  /** Initial pagination settings. */
  pagination: Pagination = {
    pageSize: 30,
    currentPage: 1,
  };
  /** Will allow for selecting items and perform bulk actions on them. */
  selectable = false;

  displayOptions = {
    showSearch: false,
    striped: true,
    bordered: false,
    gridHeader: false,
    filter: false,
    hover: true,
  };

  actionControls: ActionControl[] = [
  ];

  bulkActionControls: BulkActionControl[] = [

  ];
  ngOnInit() {
    this.generateColumns();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['columnConfig']) {
      console.log('Data grid received column config:', changes['columnConfig'].currentValue);
      this.generateColumns();
      // Force change detection to update the grid
      setTimeout(() => {
        console.log('Columns after generation:', this.columns.map(c => c.name));
      }, 100);
    }
  }

  /**
   * Generate columns based on column configuration or use defaults
   */
  private generateColumns(): void {
    if (this.columnConfig && this.columnConfig.length > 0) {
      // Filter and sort columns based on configuration
      const enabledColumns = this.columnConfig
        .filter(config => config.enabled)
        .sort((a, b) => a.order - b.order);
      
      console.log('Enabled columns from config:', enabledColumns.map(c => ({ key: c.key, label: c.label, enabled: c.enabled })));
      console.log('Enabled column keys:', enabledColumns.map(c => c.key));
      
      this.columns = enabledColumns.map(config => {
        const defaultColumn = this.defaultColumns.find(col => col.name === config.key);
        if (defaultColumn) {
          console.log(`Found matching column for ${config.key}:`, defaultColumn);
          // Use the configuration's custom label instead of default header
          return {
            ...defaultColumn,
            header: config.label // Override with custom label
          };
        }
        // Fallback for unknown columns (including nested properties)
        console.log(`No default column found for ${config.key}, creating dynamic column`);
        return {
          name: config.key,
          header: config.label,
          path: config.key,
          filterable: true,
          sortable: true,
          // Custom cell template for nested properties
          cellCSSClassName: this.isNestedProperty(config.key) ? 'nested-property' : ''
        };
      });
    } else {
      console.log('No column config provided, using default columns');
      // Use default columns (first 5 by default)
      this.columns = this.defaultColumns.slice(0, 5);
    }
    console.log('Generated columns:', this.columns);
  }



  /** Executes logic when data grid config changes. */
  onConfigChange(config: GridConfig) {
    console.log("configuration changed:");
    console.dir(config);
  }

  onFilter(filter: any) {
    console.log("filter changed:");
    console.log(filter);
  }

  onAddCustomColumn(customColumnConfig: CustomColumnConfig) {
    console.log("custom column added:");
    console.log(customColumnConfig);
  }

  onRemoveCustomColumn(column: Column) {
    console.log("custom column removed:");
    console.log(column);
  }

  onRowClick(row: Row) {
    console.log("row clicked:");
    console.log(row);
    this.rowClicked.emit(row);
  }

  /**
   * Check if a property key represents a nested property
   */
  private isNestedProperty(key: string): boolean {
    return key.includes('.');
  }
}
