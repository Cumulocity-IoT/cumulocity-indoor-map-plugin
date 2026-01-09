import { Component, Input, OnInit } from "@angular/core";
import { BsModalService } from "ngx-bootstrap/modal";
import {
  AlertService,
  MeasurementRealtimeService,
  OnBeforeSave,
} from "@c8y/ngx-components";
import { TypeaheadMatch } from "ngx-bootstrap/typeahead";
import { Observable } from "rxjs";
import { AssignLocationModalComponent } from "./map-config-modal/assign-locations-modal/assign-locations-modal.component";
import { GPSComponent } from "./select-co-ordinates/gps.component";
import { ZonesComponent } from "./zones-creation/zones-creation.component";
import { AssignDevicesModalComponent } from "./map-config-modal/assign-devices-modal/assign-devices-modal.component";
import { BuildingService } from "../../services/building.service";
import { isEmpty } from "lodash";
import { FloorConfigModalComponent } from "./floor-configuration-modal/floor-config-modal.component";
import { ColumnConfigModalComponent } from "./column-config-modal/column-config-modal.component";
import {
  GPSCoordinates,
  MapConfiguration,
  MapConfigurationLevel,
  WidgetConfiguration,
  ColumnConfig,
} from "../../models/data-point-indoor-map.model";
import { IManagedObject } from "@c8y/client";

@Component({
  selector: "data-point-indoor-map-configuration",
  templateUrl: "./data-point-indoor-map.config.component.html",
  styleUrls: ["./data-point-indoor-map.config.component.less"],
  providers: [BuildingService, AlertService, MeasurementRealtimeService],
})
export class DataPointIndoorMapConfigComponent implements OnInit, OnBeforeSave {
  @Input() config!: WidgetConfiguration;

  mapConfigurations: MapConfiguration[] = [];
  dataPointSeries: string[] = [];

  selectedBuilding?: MapConfiguration;
  selectedMapConfigurationId?: string; /** 🔹 For typeahead binding */

  managedObjectsForFloorLevels: IManagedObject[][] | undefined;
  mapConfigInput = "";
  showCreateOption = false;

  selectedDataPoint: string | undefined = "";
  isSaving = false;
  isSaved = false;

  indoorMapConfig = {
    topLeftLat: 52.52,
    topLeftLng: 13.4,
    bottomRightLat: 52.51,
    bottomRightLng: 13.41,
  };
  markerManagedObjectsForFloorLevel: any;

  constructor(
    private buildingService: BuildingService,
    private modalService: BsModalService
  ) {}

  ngOnInit() {
    this.initMapConfigurations();
  }

  hasBuildingBoundaries(): boolean {
    if (!this.selectedBuilding?.coordinates) {
      return false;
    }
    return (
      !!this.selectedBuilding.coordinates.topLeftLat ||
      !!this.selectedBuilding.coordinates.topLeftLng ||
      !!this.selectedBuilding.coordinates.bottomRightLat ||
      !!this.selectedBuilding.coordinates.bottomRightLng
    );
  }
  hasFloorConfiguration(): boolean {
    return (
      !!this.selectedBuilding?.levels && this.selectedBuilding.levels.length > 0
    );
  }

  onMapConfigurationInputChange(value: string): void {
    this.mapConfigInput = value;

    if (!value || !value.trim()) {
      this.selectedMapConfigurationId = undefined;
      this.selectedBuilding = undefined;
      this.showCreateOption = false;
      return;
    }

    const existing = this.mapConfigurations.find(
      (c) => c.name.toLowerCase() === value.trim().toLowerCase()
    );

    if (existing) {
      this.selectedMapConfigurationId = existing.id;
      this.selectedBuilding = existing;
      this.showCreateOption = false;
      this.onMapConfigurationChanged();
    } else {
      this.selectedBuilding = undefined;
      this.selectedMapConfigurationId = undefined;
      this.showCreateOption = true;
    }
  }

  onMapConfigurationSelected(event: TypeaheadMatch): void {
    const selected: MapConfiguration = event.item;
    this.mapConfigInput = selected.name;
    this.selectedMapConfigurationId = selected.id;
    this.selectedBuilding = selected;
    this.showCreateOption = false;
    this.onMapConfigurationChanged();
  }

  createNewMapConfiguration(): void {
    if (!this.mapConfigInput.trim()) return;

    const newConfig: MapConfiguration = {
      id: undefined,
      name: this.mapConfigInput.trim(),
      coordinates: {},
      location: "",
      assetType: "",
      levels: [],
      type: "c8y_Building",
    };

    this.buildingService.createOrUpdateBuilding(newConfig).then((created) => {
      if (created) {
        newConfig.id = created.id;
        this.mapConfigurations.push(newConfig);
        this.selectedMapConfigurationId = newConfig.id;
        this.selectedBuilding = newConfig;
        this.config.buildingId = newConfig.id ?? "";
      }
    });
    this.showCreateOption = false;
  }

  async onMapConfigurationChanged(): Promise<void> {
    if (!this.selectedMapConfigurationId) return;

    const selectedMapConfiguration = this.mapConfigurations.find(
      (mapConfiguration) =>
        mapConfiguration.id === this.selectedMapConfigurationId
    );

    if (selectedMapConfiguration) {
      this.selectedBuilding =
        (await this.buildingService.loadMapConfigurationWithImages(
          selectedMapConfiguration.id!
        )) as any;
      this.config.buildingId = this.selectedMapConfigurationId;
    }
  }

  onDeleteMapConfiguration(): void {
    this.buildingService
      .deleteMapConfiguration(this.selectedMapConfigurationId!)
      .then((success) => {
        if (success) {
          this.mapConfigurations = this.mapConfigurations.filter(
            (mapConfiguration) =>
              mapConfiguration.id !== this.selectedMapConfigurationId
          );
          this.selectedMapConfigurationId = undefined;
          this.selectedBuilding = undefined;
          this.mapConfigInput = "";
        }
      });
  }

  onPrimaryMeasurementChanged(): void {
    const measurement: string[] = this.selectedDataPoint!.split(".");
    this.config.measurement = {
      fragment: measurement[0],
      series: measurement[1],
    };
  }

  openMapBoundaryModal(): void {
    if (!this.selectedBuilding) return;
    const initialConfigWithRotation = {
      ...this.selectedBuilding.coordinates,
      rotationAngle: this.selectedBuilding.coordinates.rotationAngle || 0,
      levels: this.selectedBuilding.levels,
    };
    const modalRef = this.modalService.show(GPSComponent, {
      initialState: { initialConfig: initialConfigWithRotation } as any,
      class: "modal-lg",
    });

    modalRef.content?.boundaryChange.subscribe(
      (coordinates: GPSCoordinates) => {
        this.onGpsConfigChange(coordinates);
      }
    );
  }

  onZoneCreation() {
    if (!this.selectedBuilding) return;
    const currentCoordinates = this.selectedBuilding?.coordinates || {};
    const modalRef = this.modalService.show(ZonesComponent, {
      initialState: { initialConfig: this.selectedBuilding } as any,
      class: "modal-lg",
    });

    modalRef.content?.boundaryChange.subscribe((newConfig: any) => {
      this.onZoneChange(newConfig);
    });
  }

  async onEditDeviceLocation(): Promise<void> {
    if (!this.selectedBuilding) return;
    if (isEmpty(this.managedObjectsForFloorLevels)) {
      this.managedObjectsForFloorLevels =
        await this.buildingService.loadMarkersForLevels(
          this.selectedBuilding.levels
        );
    }
    this.modalService.show(AssignLocationModalComponent, {
      initialState: {
        building: this.selectedBuilding,
        managedObjectsForFloorLevels: this.managedObjectsForFloorLevels,
      } as any,
      class: "modal-lg",
    });
  }

  openAssignDevicesModal(): void {
    if (!this.selectedBuilding) return;
    const modalRef = this.modalService.show(AssignDevicesModalComponent, {
      initialState: { building: this.selectedBuilding },
      class: "modal-lg",
    });

    modalRef.content?.onSaveChanges.subscribe(
      (updatedBuilding: MapConfiguration) => {
        this.selectedBuilding = updatedBuilding;
      }
    );
  }

  openFloorConfigurationModal(): void {
    if (!this.selectedBuilding) return;
    const modalRef = this.modalService.show(FloorConfigModalComponent, {
      initialState: { building: this.selectedBuilding } as any,
      class: "modal-lg",
    });

    modalRef.content?.onChange.subscribe((floors: MapConfigurationLevel[]) => {
      if (this.selectedBuilding) {
        this.selectedBuilding.levels = floors;
      }
    });
  }

  openColumnConfigModal(): void {
    const allDevices: IManagedObject[] = [];
    if (this.managedObjectsForFloorLevels) {
      this.managedObjectsForFloorLevels.forEach((floorDevices) => {
        if (Array.isArray(floorDevices)) {
          allDevices.push(...floorDevices);
        }
      });
    }

    const modalRef = this.modalService.show(ColumnConfigModalComponent, {
      initialState: {
        currentConfig: this.config?.columnConfig || [],
        devices: allDevices,
      } as any,
      class: "modal-lg",
    });

    modalRef.content?.onChange.subscribe((columnConfig: ColumnConfig[]) => {
      if (!this.config) {
        this.config = {} as any;
      }
      this.config.columnConfig = columnConfig;
    });
  }

  private initMapConfigurations(): void {
    this.buildingService
      .loadSmartMapConfigurations()
      .then(async (mapConfigurations) => {
        this.mapConfigurations = mapConfigurations;

        if (!this.config || !this.config.buildingId) return;

        this.selectedBuilding = this.mapConfigurations.find(
          (m) => m.id === this.config.buildingId
        );
        this.selectedMapConfigurationId = this.selectedBuilding?.id;
        this.mapConfigInput = this.selectedBuilding?.name ?? ""; // load full configuration with images only if we have a selected building and a valid id

        if (this.selectedBuilding && this.selectedBuilding.id) {
          try {
            const fullConfig =
              await this.buildingService.loadMapConfigurationWithImages(
                this.selectedBuilding.id
              );

            this.managedObjectsForFloorLevels =
              await this.buildingService.loadMarkersForLevels(
                fullConfig.levels
              );

            this.selectedBuilding = fullConfig;
          } catch {
            this.onMapConfigurationChanged();
          }
        }
      });
  }

  onGpsConfigChange(coordinates: GPSCoordinates): void {
    if (this.selectedBuilding && coordinates) {
      this.selectedBuilding.coordinates = coordinates;
      this.selectedBuilding.coordinates.rotationAngle =
        (coordinates as any)?.rotationAngle || 0;
      this.selectedBuilding.coordinates.zoomLevel = coordinates.zoomLevel;
    }
    this.isSaved = false;
  }

  onZoneChange(newConfig: any): void {
    if (this.selectedBuilding && newConfig) {
      this.selectedBuilding.allZonesByLevel = newConfig?.allZonesByLevel;
    }
    this.isSaved = false;
  }

  onBeforeSave(
    config?: WidgetConfiguration
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (
      isEmpty(this.selectedBuilding?.name) ||
      this.selectedBuilding?.coordinates?.topLeftLat == 0
    ) {
      alert(
        "Please provide a name for the building and select coordinates to save"
      );
      return false;
    } // Optionally, persist the configuration using the service

    const coords = this.selectedBuilding?.coordinates as any;
    const hasValidCorners =
      coords?.placementMode === "corners" &&
      coords.topLeftLat &&
      coords.topLeftLng &&
      coords.bottomRightLat &&
      coords.bottomRightLng;

    const hasValidPolygon =
      coords?.placementMode === "polygon" && coords.polygonVerticesJson;

    if (!hasValidCorners && !hasValidPolygon) {
      return false;
    }

    // return true;
    return this.buildingService
      .createOrUpdateBuilding(this.selectedBuilding)
      .then(() => {
        this.isSaved = true;
        this.config.buildingId = this.selectedBuilding?.id || "";

        // Make sure column config is copied to the config that gets saved
        if (config && this.config.columnConfig) {
          config.columnConfig = this.config.columnConfig;
        }

        // Column config is automatically persisted as part of widget configuration

        return true;
      })
      .catch(() => false);
  }
}
