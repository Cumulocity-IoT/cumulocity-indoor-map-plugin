import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
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
export class MapDataGridComponent implements OnInit {
  @Input() devices: IManagedObject[] = [];
  @Output() rowClicked = new EventEmitter<Row>();



  /** This will be used as a title for the data grid. */

  title = "Devices";
  /**
   * This defines what columns will be displayed in the grid.
   * In this example we're just displaying properties from the items from the loaded data file.
   */
  columns: Column[] = [
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
      name: "creationTime",
      header: "Creation time",
      path: "creationTime",
      filterable: false,
    },
    {
      name: "lastUpdated",
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
  ngOnInit() {}



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
}
