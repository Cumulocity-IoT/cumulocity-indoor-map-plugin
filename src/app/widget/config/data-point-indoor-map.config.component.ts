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
import { EventPollingService } from "../polling/event-polling.service";
import { isEmpty } from "lodash";
import { FloorConfigModalComponent } from "./floor-configuration-modal/floor-config-modal.component";
import {
  GPSCoordinates,
  MapConfiguration,
  MapConfigurationLevel,
  WidgetConfiguration,
} from "../../models/data-point-indoor-map.model";
import { IManagedObject } from "@c8y/client";

@Component({
  selector: "data-point-indoor-map-configuration",
  templateUrl: "./data-point-indoor-map.config.component.html",
  styleUrls: ["./data-point-indoor-map.config.component.less"],
  providers: [
    BuildingService,
    AlertService,
    MeasurementRealtimeService,
    EventPollingService,
  ],
})
export class DataPointIndoorMapConfigComponent implements OnInit, OnBeforeSave {
  @Input() config!: WidgetConfiguration;

  mapConfigurations: MapConfiguration[] = [];
  dataPointSeries: string[] = [];

  selectedBuilding?: MapConfiguration;
  selectedMapConfigurationId?: string; /** 🔹 For typeahead binding */


  managedObjectsForFloorLevels : IManagedObject[][] | undefined;
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
  } /** 🔹 Prüft, ob Bauwerksgrenzen konfiguriert sind (prüft auf mindestens eine Koordinate) */

  hasBuildingBoundaries(): boolean {
    if (!this.selectedBuilding?.coordinates) {
      return false;
    } // Prüft, ob mindestens eine der 4 Koordinaten vorhanden ist, um Konfiguration anzuzeigen
    return (
      !!this.selectedBuilding.coordinates.topLeftLat ||
      !!this.selectedBuilding.coordinates.topLeftLng ||
      !!this.selectedBuilding.coordinates.bottomRightLat ||
      !!this.selectedBuilding.coordinates.bottomRightLng
    );
  } /** 🔹 Prüft, ob Stockwerke konfiguriert sind (prüft auf mindestens ein Level) */

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
  } /** 🔹 When user selects an existing item from typeahead suggestions */

  onMapConfigurationSelected(event: TypeaheadMatch): void {
    const selected: MapConfiguration = event.item;
    this.mapConfigInput = selected.name;
    this.selectedMapConfigurationId = selected.id;
    this.selectedBuilding = selected;
    this.showCreateOption = false;
    this.onMapConfigurationChanged();
  } /** 🔹 Creates a new configuration when user clicks "Create" */

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
  } // --- Existing methods below unchanged ---

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

  onEditDeviceLocation(): void {
    if (!this.selectedBuilding) return;
    this.modalService.show(AssignLocationModalComponent, {
      initialState: { building: this.selectedBuilding, managedObjectsForFloorLevels: this.managedObjectsForFloorLevels } as any,
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

            this.managedObjectsForFloorLevels  =
              await this.buildingService.loadMarkersForLevels(fullConfig.levels);
           
            this.selectedBuilding = fullConfig;
            console.log("Loaded full building configuration:", fullConfig); // this.onMapConfigurationChanged();
          } catch {
            // keep existing selectedBuilding on error and still trigger change handling
            this.onMapConfigurationChanged();
          }
        }
      });
  }

  onGpsConfigChange(coordinates: GPSCoordinates): void {
    console.log("Parent received new config (Boundaries):", coordinates);

    if (this.selectedBuilding && coordinates) {
      this.selectedBuilding.coordinates = coordinates;
      this.selectedBuilding.coordinates.rotationAngle =
        (coordinates as any)?.rotationAngle || 0;
      this.selectedBuilding.coordinates.zoomLevel = coordinates.zoomLevel;
    }
    this.isSaved = false;
  }

  onZoneChange(newConfig: any): void {
    console.log("Parent received new config (Zones):", newConfig);
    if (this.selectedBuilding && newConfig) {
      this.selectedBuilding.allZonesByLevel = newConfig?.allZonesByLevel;
    }
    this.isSaved = false;
  }

  onBeforeSave(
    config?: WidgetConfiguration
  ): boolean | Promise<boolean> | Observable<boolean> {
    console.log(this.selectedBuilding);
    if (isEmpty(this.selectedBuilding?.name)) {
      alert("Please provide a name for the building.");
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
        return true;
      })
      .catch(() => false);
  }
}
