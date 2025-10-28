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
import { MapConfiguration, MapConfigurationLevel, WidgetConfiguration } from "../../models/data-point-indoor-map.model";

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
      zoomLevel: 18,
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


  onAssignDevicesButtonClicked(): void {
    if (!this.selectedBuilding) return;
    console.log(
      "Opening modal to assign devices to building:",
      this.selectedBuilding.name
    );
  }



  openMapBoundaryModal(): void {
    if (!this.selectedBuilding) return;
    console.log(
      "Opening modal to set map boundaries for:",
      this.selectedBuilding.name
    );

    const modalRef = this.modalService.show(GPSComponent, {
      initialState: { initialConfig: this.config.coordinates } as any,
      class: "modal-lg",
    });

    modalRef.content?.boundaryChange.subscribe((newConfig: any) => {
      console.log("Received new boundary config from modal:", newConfig);
      this.onGpsConfigChange(newConfig);
    });
  }

  onZoneCreation() {
    console.log("bb", this.selectedBuilding);

    if (!this.selectedBuilding) return;
    const currentCoordinates = this.config?.coordinates || {};

    const obj = {
      ...currentCoordinates,
      rotationAngle: this.config?.mapSettings?.rotationAngle || 0,
      allZonesByLevel: this.config?.allZonesByLevel || [],
      building: this.selectedBuilding,
    };

    const modalRef = this.modalService.show(ZonesComponent, {
      initialState: { initialConfig: obj } as any,
      class: "modal-lg",
    });

    modalRef.content?.boundaryChange.subscribe((newConfig: any) => {
      console.log("Received new boundary config from modal:", newConfig);
      // The modal returns the rotation angle, so save both coordinates AND rotation angle here.
      this.onZoneChange(newConfig);

      // Since rotationAngle is now returned by the modal, extract and save it to mapSettings
      // this.config.mapSettings.rotationAngle = newConfig.rotationAngle || 0;
    });
  }

  
  onEditDeviceLocation(): void {
    if (!this.selectedBuilding) return;
    this.modalService.show(AssignLocationModalComponent, {
      initialState: { building: this.selectedBuilding },
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
            this.selectedBuilding = fullConfig;
            console.log("Loaded full building configuration:", fullConfig); // this.onMapConfigurationChanged();
          } catch {
            // keep existing selectedBuilding on error and still trigger change handling
            this.onMapConfigurationChanged();
          }
        }
      });
  }

  onGpsConfigChange(newConfig: any): void {
    console.log("Parent received new config (Boundaries):", newConfig);

    this.config.coordinates = newConfig;
    this.isSaved = false;
  }

  onZoneChange(newConfig: any): void {
    console.log("Parent received new config (Zones):", newConfig);
    this.config.allZonesByLevel = newConfig.allZonesByLevel;
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

    const coords = config?.coordinates as any;
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
