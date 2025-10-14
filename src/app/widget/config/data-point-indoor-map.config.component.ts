/**
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or its licensors
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-20.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Component, Input, OnInit } from "@angular/core";
import { BsModalService } from "ngx-bootstrap/modal";
import { OnBeforeSave } from "@c8y/ngx-components";
import { DataPointIndoorMapConfigService } from "../data-point-indoor-map.config.service";
import {
  DatapointPopup,
  MapConfiguration,
  Threshold,
  WidgetConfiguration
} from "../data-point-indoor-map.model";
import { ManagedDatapointsPopupModalComponent } from "./managed-datapoints-popup-modal/managed-datapoints-popup-modal.component";
import { isNil } from "lodash";
import { MapConfigurationModalComponent } from "./map-config-modal/map-config-modal.component";
import { Observable } from "rxjs";
import { CdkDragDrop, moveItemInArray } from "@angular/cdk/drag-drop";
import { Coordinates } from "../models/coordinates.model";
import { AssignLocationModalComponent } from "./map-config-modal/assign-locations-step/assign-locations-modal.component";
import { GPSComponent } from "./select-co-ordinates/gps.component";
// Assuming you have an EditLocationModalComponent to host the map
// import { EditLocationModalComponent } from "./edit-location-modal/edit-location-modal.component";

@Component({
  selector: "data-point-indoor-map-configuration",
  templateUrl: "./data-point-indoor-map.config.component.html",
  styleUrls: ["./data-point-indoor-map.config.component.less"],
  providers: [DataPointIndoorMapConfigService],
})
export class DataPointIndoorMapConfigComponent implements OnInit, OnBeforeSave {
  @Input() config!: WidgetConfiguration;

  private readonly DEFAULT_ZOOM_LEVEL = 0;

  mapConfigurations: MapConfiguration[] = [];

  dataPointSeries: string[] = [];

  selectedBuilding?: MapConfiguration;
  selectedMapConfigurationId?: string;

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
    private configService: DataPointIndoorMapConfigService,
    private modalService: BsModalService
  ) {}

  ngOnInit() {
    this.initConfiguration();
    this.initMapConfigurations();
    this.initThresholds();
    this.initPopupMarker();
  }

  onCreateNewMapConfiguration(): void {
    const a = this.modalService.show(MapConfigurationModalComponent, {
      class: "modal-lg",
    });
    a.content?.onSave$.subscribe((mapConfiguration) => {
      this.mapConfigurations.push(mapConfiguration);
      this.selectedMapConfigurationId = mapConfiguration.id;
      this.onMapConfigurationChanged();
    });
  }

  onEditMapConfiguration(): void {
    if (this.selectedBuilding && this.config.coordinates) {
      // Ensure the coordinates from the main config are passed for editing, if they exist
      this.selectedBuilding.coordinates = { ...this.config.coordinates as Coordinates};
    }
    console.log('Editing map configuration', this.selectedBuilding);
    console.log(this.config);
    const initialState = { building: this.selectedBuilding };
    const modal = this.modalService.show(MapConfigurationModalComponent, {
      initialState,
      class: "modal-lg",
    });
    modal.content?.onSave$.subscribe((mapConfiguration) => {
      this.selectedBuilding = mapConfiguration;
      this.onMapConfigurationChanged();
    });
  }

  onDrop(event: CdkDragDrop<Threshold[]>) {
    moveItemInArray(
      event.container.data,
      event.previousIndex,
      event.currentIndex
    );
  }

  onDeleteMapConfiguration(): void {
    this.configService
      .deleteMapConfiguration(this.selectedMapConfigurationId!)
      .then((success) => {
        if (success) {
          this.mapConfigurations = this.mapConfigurations.filter(
            (mapConfiguration) =>
              mapConfiguration.id !== this.selectedMapConfigurationId
          );
          this.selectedMapConfigurationId = undefined;
          this.selectedBuilding = undefined;
          this.updateDataPointSeries();
        }
      });
  }

  onMapConfigurationChanged(): void {
    const selectedMapConfiguration = this.mapConfigurations.find(
      (mapConfiguration) =>
        mapConfiguration.id === this.selectedMapConfigurationId
    );
    if (this.selectedMapConfigurationId && selectedMapConfiguration) {
      this.selectedBuilding = selectedMapConfiguration;
      this.config.mapConfigurationId = this.selectedMapConfigurationId;
      
      // Update config coordinates if building has stored coordinates
      if (selectedMapConfiguration.coordinates) {
          this.config.coordinates = selectedMapConfiguration.coordinates;
      }
    }
    this.updateDataPointSeries();
  }

  onPrimaryMeasurementChanged(): void {
    const measurement: string[] = this.selectedDataPoint!.split(".");
    this.config.measurement = {
      fragment: measurement[0],
      series: measurement[1],
    };
  }


  onUpdateDatapointsButtonClicked(): void {
    this.displayUpdateDatapointsPopupModal();
  }
  
  // 🌟 NEW: Placeholder for assigning devices to the current building/levels
  onAssignDevicesButtonClicked(): void {
      if (!this.selectedBuilding) return;
      console.log('Opening modal to assign devices to building:', this.selectedBuilding.name);
      
      // Implement modal logic here (e.g., this.modalService.show(AssignDevicesModalComponent))
  }

  // 🌟 NEW: Placeholder for editing a specific device's location
  onEditDeviceLocation(): void {
      if (!this.selectedBuilding) return;
      console.log('Opening modal to select a device and edit its location on the map.');
      
      const modalRef = this.modalService.show(AssignLocationModalComponent, {
        initialState: { building: this.selectedBuilding },
        class: "modal-lg",
      });
  }

    // 🌟 NEW: Placeholder for editing a specific device's location
  openMapBoundaryModal(): void {
      if (!this.selectedBuilding) return;
      console.log('Opening modal to set map boundaries for:', this.selectedBuilding.name);

      const modalRef = this.modalService.show(GPSComponent, {
        initialState: { coordinates: this.selectedBuilding.coordinates } as any,
        class: "modal-lg",
      });

      modalRef.content?.boundaryChange.subscribe((newConfig: any) => {
        console.log('Received new boundary config from modal:', newConfig);
        this.onGpsConfigChange(newConfig);
      });
  }

  private initConfiguration(): void {
    if (
      !!this.config &&
      this.config.mapConfigurationId &&
      this.config.measurement
    ) {
      return;
    }

    this.config = Object.assign(this.config, {
      mapConfigurationId: "",
      measurement: {
        fragment: "",
        series: "",
      },
      mapSettings: {
        zoomLevel: this.DEFAULT_ZOOM_LEVEL,
      },
      coordinates: {}, // Initialize coordinates object
      legend: {
        title: "",
        thresholds: [],
      },
      datapointsPopup: [],
    });
  }

  private initMapConfigurations(): void {
    this.configService
      .loadSmartMapConfigurations()
      .then((mapConfigurations) => {
        this.mapConfigurations = mapConfigurations;

        if (!this.config || !this.config.mapConfigurationId) {
          return;
        }

        this.selectedBuilding = this.mapConfigurations.find(
          (mapConfiguration) =>
            mapConfiguration.id === this.config.mapConfigurationId
        );
        this.selectedMapConfigurationId = this.selectedBuilding?.id;
        this.onMapConfigurationChanged();
      });
  }

  private updateDataPointSeries(): void {
    // Only proceed if a building is selected
    if (!this.selectedBuilding) {
        this.dataPointSeries = [];
        this.selectedDataPoint = undefined;
        return;
    }
    
    this.configService
      .getSupportedSeriesFromMapConfiguration(this.selectedBuilding)
      .then((datapoints) => {
        this.dataPointSeries = datapoints;
        if (!this.config || !this.config.measurement) {
          return;
        }

        const measurementStructure = `${this.config.measurement.fragment}.${this.config.measurement.series}`;
        this.selectedDataPoint = this.dataPointSeries.find(
          (dataPoint) => dataPoint === measurementStructure
        );

        if (!this.selectedDataPoint) {
          return;
        }

        this.onPrimaryMeasurementChanged();
      });
  }

  private initThresholds(): void {
    if (!this.config || !this.config.legend || !this.config.legend.thresholds) {
      return;
    }

    this.config.legend.thresholds.forEach((threshold) =>
      this.addThresholdToList(threshold)
    );
  }

  private initPopupMarker(): void {
    if (!this.config || !this.config.datapointsPopup) {
      return;
    }

    this.config.datapointsPopup = this.config.datapointsPopup;
  }


  private displayUpdateDatapointsPopupModal() {
    let config = {
      backdrop: true,
      ignoreBackdropClick: true,
      keyboard: false,
      ...(this.dataPointSeries
        ? {
            initialState: {
              supportedDatapoints: this.dataPointSeries,
              datapointsPopup: this.config.datapointsPopup,
            },
          }
        : {}),
    };

    const modalRef = this.modalService.show(
      ManagedDatapointsPopupModalComponent,
      config
    );
    modalRef.content?.onSave$.subscribe((datapointsPopup: DatapointPopup[]) => {
      this.config.datapointsPopup = datapointsPopup;
    });
  }

  private addThresholdToList(threshold: Threshold): void {
    let indexExistingThreshold = this.config?.legend?.thresholds?.findIndex(
      (existingThreshold) => existingThreshold.id === threshold.id
    );
    if (indexExistingThreshold !== -1 && !isNil(indexExistingThreshold)) {
      this.config!.legend!.thresholds![indexExistingThreshold] = {
        ...threshold,
      };
    } else {
      this.config?.legend?.thresholds?.push(threshold);
    }
  }

  private removeThresholdFromList(threshold: Threshold): void {
    let indexExistingThresholdToDelete =
      this.config?.legend?.thresholds?.findIndex(
        (existingThreshold) => existingThreshold.id === threshold.id
      );
    if (
      indexExistingThresholdToDelete === -1 ||
      isNil(indexExistingThresholdToDelete)
    ) {
      return;
    }

    this.config?.legend?.thresholds?.splice(indexExistingThresholdToDelete, 1);
  }

  onGpsConfigChange(newConfig: any): void {
    console.log("Parent received new config (Boundaries):", newConfig);
    // Update the widget config's coordinates property
    this.config.coordinates = newConfig;
    this.isSaved = false;
  }

  onBeforeSave(
    config?: WidgetConfiguration
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (!config?.mapConfigurationId) {
      return false;
    }

    const coords = config.coordinates as any;

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

    return true;
  }
}