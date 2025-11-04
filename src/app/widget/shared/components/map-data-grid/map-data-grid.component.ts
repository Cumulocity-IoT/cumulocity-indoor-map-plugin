import { Component, Input, OnInit } from "@angular/core";
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
      filterable: true,
    },
    {
      name: "name",
      header: "Name",
      path: "name",
      filterable: true,
    },
    {
      name: "type",
      header: "Type",
      path: "type",
      filterable: true,
    },
    {
      name: "creationTime",
      header: "Creation time",
      path: "creationTime",
      filterable: true,
    },
    {
      name: "lastUpdated",
      header: "Last updated",
      path: "lastUpdated",
      filterable: true,
    },
    {
      name: "owner",
      header: "Owner",
      path: "owner",
      filterable: true,
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
    gridHeader: true,
    filter: true,
    hover: true,
  };
  /**
   * Defines actions for individual rows.
   * `type` can be one of the predefined ones, or a custom one.
   * `callback` executes the action (based on the selected item object).
   */
  actionControls: ActionControl[] = [
    {
      type: BuiltInActionType.Edit,
      callback: (selectedItem) => this.onItemEdit(selectedItem),
    },
    {
      type: BuiltInActionType.Delete,
      callback: (selectedItem) => this.onItemDelete(selectedItem),
    },
  ];
  /**
   * Defines actions for multiple rows.
   * `type` can be one of the predefined ones, or a custom one.
   * `callback` executes the action (based on the ids of selected items).
   */
  bulkActionControls: BulkActionControl[] = [
    {
      type: BuiltInActionType.Export,
      callback: (selectedItemIds) => this.onItemsExport(selectedItemIds),
    },
    {
      type: BuiltInActionType.Delete,
      callback: (selectedItemIds) => this.onItemsDelete(selectedItemIds),
    },
  ];
  ngOnInit() {}

  /** Executes an edit action on the selected item. */
  onItemEdit(selectedItem: Row) {
    console.log("item to edit:");
    console.dir(selectedItem);
  }

  /** Executes a delete action on the selected item. */
  onItemDelete(selectedItem: Row) {
    console.log("item to delete:");
    console.dir(selectedItem);
  }

  /** Executes an action on selected items, whenever the selection changes. */
  onItemsSelect(selectedItemIds: string[]) {
    console.log("selected items:");
    console.dir(selectedItemIds);
  }

  /** Executes an export action of the selected multiple items. */
  onItemsExport(selectedItemIds: string[]) {
    console.log("items to export:");
    console.dir(selectedItemIds);
  }

  /** Executes a delete action on the selected multiple items. */
  onItemsDelete(selectedItemIds: string[]) {
    console.log("items to delete:");
    console.dir(selectedItemIds);
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
}
