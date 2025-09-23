/**
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or its licensors
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Component, Input, OnInit } from "@angular/core";
import { BsModalService } from "ngx-bootstrap/modal";
import { AlertService, OnBeforeSave } from "@c8y/ngx-components";
import { DataPointIndoorMapConfigService } from "../data-point-indoor-map.config.service";
import { AddThresholdModalComponent } from "./add-threshold-modal/add-threshold-modal.component";
import {
  DatapointPopup,
  MapConfiguration,
  Threshold,
  WidgetConfiguration,
} from "../data-point-indoor-map.model";
import { ManagedDatapointsPopupModalComponent } from "./managed-datapoints-popup-modal/managed-datapoints-popup-modal.component";
import { isNil } from "lodash";
import { MapConfigurationModalComponent } from "./map-config-modal/map-config-modal.component";
import { Observable } from "rxjs";
import { CdkDragDrop, moveItemInArray } from "@angular/cdk/drag-drop";

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

  selectedMapConfiguration?: MapConfiguration;
  selectedMapConfigurationId?: string;

  selectedDataPoint: string | undefined = "";
  isSaving = false;
  isSaved = false;
  constructor(
    private configService: DataPointIndoorMapConfigService,
    private alertService: AlertService,
    private modalService: BsModalService
  ) {}

  indoorMapConfig = {
    placementMode: "corners",
    topLeftLat: 52.52,
    topLeftLng: 13.4,
    bottomRightLat: 52.51,
    bottomRightLng: 13.41,
  };
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
    const initialState = { building: this.selectedMapConfiguration };
    const modal = this.modalService.show(MapConfigurationModalComponent, {
      initialState,
      class: "modal-lg",
    });
    modal.content?.onSave$.subscribe((mapConfiguration) => {
      this.selectedMapConfiguration = mapConfiguration;
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
          this.selectedMapConfiguration = undefined;
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
      this.selectedMapConfiguration = selectedMapConfiguration;
      this.config.mapConfigurationId = this.selectedMapConfigurationId;
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

  onThresholdClicked(threshold: Threshold) {
    this.displayAddThresholdModal(threshold);
  }

  onAddThresholdButtonClicked(): void {
    this.displayAddThresholdModal();
  }

  onUpdateDatapointsButtonClicked(): void {
    this.displayUpdateDatapointsPopupModal();
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
      coordinates: {},
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

        this.selectedMapConfiguration = this.mapConfigurations.find(
          (mapConfiguration) =>
            mapConfiguration.id === this.config.mapConfigurationId
        );
        this.selectedMapConfigurationId = this.selectedMapConfiguration?.id;
        this.onMapConfigurationChanged();
      });
  }

  private updateDataPointSeries(): void {
    this.configService
      .getSupportedSeriesFromMapConfiguration(this.selectedMapConfiguration!)
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

  private displayAddThresholdModal(thresholdConfiguration?: Threshold) {
    let config = {
      backdrop: true,
      ignoreBackdropClick: true,
      keyboard: false,
      ...(thresholdConfiguration
        ? {
            initialState: { threshold: thresholdConfiguration },
          }
        : {}),
    };

    const modalRef = this.modalService.show(AddThresholdModalComponent, config);
    modalRef.content?.onSave$.subscribe((threshold: Threshold) => {
      this.addThresholdToList(threshold);
    });
    modalRef.content?.onDelete$.subscribe((threshold: Threshold) => {
      this.removeThresholdFromList(threshold);
    });
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
    console.log("Parent received new config:", newConfig);
    this.config.coordinates = newConfig;
    this.isSaved = false; // Mark as unsaved since data has changed
  }

  onBeforeSave(
    config?: WidgetConfiguration
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (!config?.mapConfigurationId) {
      return false;
    }
    return true;
  }
}
