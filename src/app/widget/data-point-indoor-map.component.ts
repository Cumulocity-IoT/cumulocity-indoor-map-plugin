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
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation,
} from "@angular/core";
import { IEvent, IManagedObject } from "@c8y/client";
import {
  Datapoint,
  MapConfiguration,
  MapConfigurationLevel,
  MarkerManagedObject,
  Measurement,
  Threshold,
  WidgetConfiguration,
} from "./data-point-indoor-map.model";
import { DataPointIndoorMapService } from "./data-point-indoor-map.service";
import type * as L from "leaflet";
import { MeasurementRealtimeService } from "@c8y/ngx-components";
import { fromEvent, Subscription, takeUntil } from "rxjs";
import { EventPollingService } from "./polling/event-polling.service";
import { get } from "lodash";

@Component({
  selector: "data-point-indoor-map",
  templateUrl: "data-point-indoor-map.component.html",
  styleUrls: ["./data-point-indoor-map.component.less"],
  providers: [
    DataPointIndoorMapService,
    MeasurementRealtimeService,
    EventPollingService,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class DataPointIndoorMapComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  @Input() config!: WidgetConfiguration;
  @ViewChild("IndoorDataPointMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;

  private readonly MARKER_DEFAULT_COLOR = "#1776BF";
  private readonly KEY_LATEST_MEASUREMENT = "latestPrimaryMeasurement";
  private readonly KEY_MEASUREMENTS = "measurements";
  private readonly KEY_MAP_MARKER_INSTANCE = "mapMarkerInstance";
  private readonly KEY_MAP_MARKER_POPUP_INSTANCE = "mapMarkerPopupInstance";
  private readonly DEFAULT_ZOOM_LEVEL = 0;

  currentFloorLevel = 0;
  currentLevel?: MapConfigurationLevel;

  private markerManagedObjectsForFloorLevel: {
    [deviceId: string]: MarkerManagedObject;
  }[] = [];
  private primaryMeasurements = new Map<string, Measurement>();
  private primaryEvents = new Map<string, IEvent>();

  leaf!: typeof L;
  map?: L.Map;
  building?: MapConfiguration;
  measurementReceivedSub?: Subscription;
  primaryMeasurementReceivedSub?: Subscription;
  eventThresholdSub?: Subscription;
  isLoading = false;

  destroy$ = new EventEmitter<void>();

  constructor(
    private mapService: DataPointIndoorMapService,
    private eventPollingService: EventPollingService
  ) {}

  async ngOnInit() {
    console.log("this.config,", this.config);

    this.leaf = await import("leaflet");
  }

  async ngAfterViewInit(): Promise<void> {
    this.isLoading = true;
    this.building = await this.loadMapConfiguration();
    await this.loadManagedObjectsForMarkers(this.building);
    const level = this.currentFloorLevel;
    await this.loadLatestPrimaryMeasurementForMarkers(level);
    this.initMeasurementUpdates(level);
    this.isLoading = false;
    this.map = this.initMap(this.building, level);
    this.initMarkers(this.map, level);
    // this.initEventUpdates(level);
    this.renderLegend(this.map);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    try {
      this.map?.clearAllEventListeners();
    } catch (e) {
      console.warn(e);
    }
  }

  async onLevelChanged() {
    this.isLoading = true;
    const level = this.currentFloorLevel;
    this.mapService.unsubscribeAllMeasurements();
    if (this.eventThresholdSub) {
      this.eventThresholdSub.unsubscribe();
    }

    await this.loadLatestPrimaryMeasurementForMarkers(level);
    this.unsubscribeListeners();
    this.initMeasurementUpdates(level);
    //    this.initEventUpdates(level);
    this.isLoading = false;
    this.updateMapLevel(this.building!.levels![level]);
    this.initMarkers(this.map!, level);
  }

  /**
   * Load the map configuration which has been assigned to this widget.
   */
  private async loadMapConfiguration() {
    return this.mapService.loadMapConfigurationWithImages(
      this.config.mapConfigurationId
    );
  }

  /**
   * Load the corresponding managed objects for all the markers which are
   * defined in the map configuration for each level. Store the managed objects
   * in a map with managed object id as key for each level to quickly access
   * them
   */
  private async loadManagedObjectsForMarkers(
    building: MapConfiguration
  ): Promise<void> {
    if (!building.levels) {
      return;
    }

    const managedObjectsForFloorLevels =
      await this.mapService.loadMarkersForLevels(building.levels);
    managedObjectsForFloorLevels.forEach(
      (managedObjectsForFloorLevel, index) => {
        let managedObjectsMap: { [deviceId: string]: IManagedObject } = {};
        managedObjectsForFloorLevel.forEach(
          (managedObject) =>
            (managedObjectsMap[managedObject.id] = managedObject)
        );
        this.markerManagedObjectsForFloorLevel[index] = managedObjectsMap;
      }
    );
  }

  /**
   * Load the latest primary measurement for all available markers on the
   * currently configured floor level. The latest measurement is stored as
   * a property on the corresponding managed object and used to initialize
   * the map markers and their colors based on the configured legend correctly.
   */
  private async loadLatestPrimaryMeasurementForMarkers(
    level: number
  ): Promise<void> {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    const currentVisibleMarkerManagedObjects =
      this.markerManagedObjectsForFloorLevel[level];
    const deviceIds = Object.keys(currentVisibleMarkerManagedObjects);

    const measurements = await this.mapService.loadLatestMeasurements(
      deviceIds,
      this.config.measurement.fragment,
      this.config.measurement.series
    );

    deviceIds.forEach((deviceId, index) => {
      const measurement = measurements[index];
      if (measurement) {
        const managedObject = currentVisibleMarkerManagedObjects[deviceId];
        managedObject[this.KEY_LATEST_MEASUREMENT] = measurement;
      }
    });
  }

  private initMeasurementUpdates(level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    //this.subscribeForMeasurementUpdates(level);
    //this.listenToPrimaryMeasurementUpdates(level);
    this.listenToConfiguredMeasurementUpdates(level);
  }

  /* private initEventUpdates(level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }
    const thresholds = this.config.legend?.thresholds ?? [];
    if (!thresholds.length) {
      return;
    }
    const deviceIds: string[] = Object.keys(
      this.markerManagedObjectsForFloorLevel[level]
    );
    this.eventThresholdSub = this.eventPollingService
      .startPolling(deviceIds, thresholds)
      .pipe(takeUntil(this.destroy$))
      .subscribe((update) => {
        this.primaryEvents.set(update.deviceId, update.event);
        this.updateMarkerColor(update.deviceId);
      });
  } */

  /**
   * subscribe for measurements (primary and configured measurements) for each device
   * which is available on the current floor level
   */
  /*   private subscribeForMeasurementUpdates(level: number): void {
    const deviceIds: string[] = Object.keys(
      this.markerManagedObjectsForFloorLevel[level]
    );
    const datapoints: Datapoint[] =
      this.config.datapointsPopup?.map(
        (datapointPopup) => datapointPopup.measurement
      ) ?? [];
    this.mapService.subscribeForMeasurements(
      deviceIds,
      this.config.measurement,
      datapoints
    );
  } */

  /**
   * subscribe for primary measurements updates. For the received measurement its value
   * is used to color the map marker instance correctly based on the legend.
   */
  /*  private listenToPrimaryMeasurementUpdates(level: number): void {
    this.primaryMeasurementReceivedSub =
      this.mapService.primaryMeasurementReceived$
        .pipe(takeUntil(this.destroy$))
        .subscribe(({ deviceId, measurement }) => {
          this.primaryMeasurements.set(deviceId, measurement);
          this.updateMarkerColor(deviceId);
        });
  }
 */
  private updateMarkerColor(deviceId: string) {
    if (!this.config.legend?.thresholds?.length) {
      return;
    }
    const thresholds = this.config.legend?.thresholds;
    const primaryMeasurement = this.primaryMeasurements.get(deviceId);
    const measurementThresholds = thresholds.filter(
      (t) => t.type === "measurement"
    );
    const primaryEvent = this.primaryEvents.get(deviceId);
    const eventThresholds = thresholds.filter((t) => t.type === "event");
    let measurementThresholdMatch: Threshold | undefined = undefined;
    let eventThresholdMatch: Threshold | undefined = undefined;

    if (primaryMeasurement) {
      measurementThresholdMatch = measurementThresholds.find(
        (threshold) =>
          primaryMeasurement.value >= threshold.min &&
          primaryMeasurement.value <= threshold.max
      );
    }
    if (primaryEvent) {
      eventThresholdMatch = eventThresholds.find(
        (threshold) =>
          threshold.text === primaryEvent.text &&
          threshold.eventType === primaryEvent.type
      );
    }

    if (measurementThresholdMatch && !eventThresholdMatch) {
      this.updateMarkerWithColor(deviceId, measurementThresholdMatch.color);
    } else if (!measurementThresholdMatch && eventThresholdMatch) {
      this.updateMarkerWithColor(deviceId, eventThresholdMatch.color);
    } else if (measurementThresholdMatch && eventThresholdMatch) {
      const measurementThresholdMatchIndex = thresholds.indexOf(
        measurementThresholdMatch
      );
      const eventThresholdMatchIndex = thresholds.indexOf(eventThresholdMatch);
      if (measurementThresholdMatchIndex < eventThresholdMatchIndex) {
        this.updateMarkerWithColor(deviceId, measurementThresholdMatch.color);
      } else {
        this.updateMarkerWithColor(deviceId, eventThresholdMatch.color);
      }
    } else if (!measurementThresholdMatch && !eventThresholdMatch) {
      this.updateMarkerWithColor(deviceId, this.MARKER_DEFAULT_COLOR);
    }
  }

  private updateMarkerWithColor(deviceId: string, fillColor: string) {
    let markerManagedObject: MarkerManagedObject | undefined;
    const markerMOS =
      this.markerManagedObjectsForFloorLevel[this.currentFloorLevel];
    markerManagedObject = markerMOS[deviceId];

    if (!markerManagedObject) {
      return;
    }

    let mapMarkerInstance = markerManagedObject[this.KEY_MAP_MARKER_INSTANCE];
    if (!mapMarkerInstance) {
      return;
    }
    mapMarkerInstance.setStyle({ fillColor });
  }

  /**
   * listen to updates for measurements, which should be displayed in the popup
   * for a corresponding map marker instance. Configure the popup based on the
   * received measurements
   */
  private listenToConfiguredMeasurementUpdates(level: number) {
    this.measurementReceivedSub = this.mapService.measurementReceived$
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ deviceId, measurement }) => {
        const datapoint = `${measurement.datapoint.fragment}.${measurement.datapoint.series}`;
        const managedObject =
          this.markerManagedObjectsForFloorLevel[level][deviceId];

        if (!managedObject) {
          return;
        }

        managedObject[this.KEY_MEASUREMENTS] = Object.assign(
          !!managedObject[this.KEY_MEASUREMENTS]
            ? managedObject[this.KEY_MEASUREMENTS]
            : {},
          { [datapoint]: measurement }
        );

        const popup = managedObject[this.KEY_MAP_MARKER_POPUP_INSTANCE];
        if (popup) {
          popup.setContent(
            this.getPopupContent(
              managedObject,
              Object.values(managedObject[this.KEY_MEASUREMENTS])
            )
          );
        }
      });
  }

  private unsubscribeListeners() {
    if (this.primaryMeasurementReceivedSub) {
      this.primaryMeasurementReceivedSub.unsubscribe();
      this.primaryMeasurementReceivedSub = undefined;
    }

    if (this.measurementReceivedSub) {
      this.measurementReceivedSub.unsubscribe();
      this.measurementReceivedSub = undefined;
    }
  }

  private calculateBounds(): L.LatLngBounds | null {
    if (!!this.config.coordinates) {
      /*  if (this.config.coordinates.placementMode === "dimensions") {
        const {
          anchorLat,
          anchorLng,
          width,
          height,
          scaleX,
          scaleY,
          offsetX,
          offsetY,
        } = this.config.coordinates;

        if (
          anchorLat == null ||
          anchorLng == null ||
          width == null ||
          height == null
        ) {
          console.error(
            "Dimension parameters are missing from the configuration."
          );
          return null;
        }

        // Use default values for optional scale and offset
        const scaleXVal = scaleX ?? 1;
        const scaleYVal = scaleY ?? 1;
        const offsetXVal = offsetX ?? 0;
        const offsetYVal = offsetY ?? 0;

        const scaledWidth = width * scaleXVal;
        const scaledHeight = height * scaleYVal;

        const latPerMeter = 1 / 111132;
        const lngPerMeter =
          1 / (111320 * Math.cos((anchorLat * Math.PI) / 180));

        const latOffset = offsetYVal * latPerMeter;
        const lngOffset = offsetXVal * lngPerMeter;

        const heightInLat = scaledHeight * latPerMeter;
        const widthInLng = scaledWidth * lngPerMeter;

        const topLeft = this.leaf.latLng(
          parseFloat(anchorLat.toString()) + latOffset,
          parseFloat(anchorLng.toString()) + lngOffset
        );
        const bottomRight = this.leaf.latLng(
          topLeft.lat - heightInLat,
          topLeft.lng + widthInLng
        );

        return this.leaf.latLngBounds(topLeft, bottomRight);
      } else { */
      const { topLeftLat, topLeftLng, bottomRightLat, bottomRightLng } =
        this.config.coordinates;

      if (!topLeftLat || !topLeftLng || !bottomRightLat || !bottomRightLng) {
        console.error(
          "GPS corner coordinates are missing from the configuration."
        );
        return null;
      }

      const southWest = this.leaf.latLng(bottomRightLat, topLeftLng);
      const northEast = this.leaf.latLng(topLeftLat, bottomRightLng);
      return this.leaf.latLngBounds(southWest, northEast);
    }
    //}
    return null;
  }

  private initMap(building: MapConfiguration, level: number): L.Map {
    const currentMapConfigurationLevel = building.levels[level];

    const bounds = this.calculateBounds();
    if (!bounds) {
      return this.leaf.map(this.mapReference.nativeElement);
    }

    const map = this.leaf.map(this.mapReference.nativeElement);

    // Overwrite the default prefix for map controls
    this.leaf.Control.Attribution.prototype.options.prefix = false;

    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);

    if (currentMapConfigurationLevel.blob) {
      const imgBlobURL = URL.createObjectURL(currentMapConfigurationLevel.blob);
      this.leaf
        .imageOverlay(imgBlobURL, bounds, {
          opacity: 1,
          interactive: true,
        })
        .addTo(map);

      const zoom = this.config.mapSettings.zoomLevel;
      const center = this.getCenterCoordinates(this.config.coordinates);

      map.setView(center, zoom);
      map.fitBounds(bounds);

      fromEvent<L.LeafletEvent>(map, "zoomend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onZoomEnd());

      fromEvent<L.LeafletEvent>(map, "dragend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onDragEnd());
    }

    return map;
  }

  private onZoomEnd() {
    /* localStorage.setItem(
      `${this.config.mapConfigurationId}-${this.currentFloorLevel}-zoom`,
      this.map!.getZoom().toString()
    ); */
  }

  private onDragEnd() {
    localStorage.setItem(
      `${this.config.mapConfigurationId}-${this.currentFloorLevel}-center`,
      JSON.stringify(this.map!.getCenter())
    );
  }

  getCenterCoordinates(coordinates: any): [number, number] {
    if (coordinates) {
      const centerLat =
        (coordinates.topLeftLat + coordinates.bottomRightLat) / 2;
      const centerLng =
        (coordinates.topLeftLng + coordinates.bottomRightLng) / 2;
      console.log(centerLat, centerLng);

      return [centerLat, centerLng];
    } /* else if (coordinates?.placementMode === "dimensions") {
      const centerLat =
        coordinates.anchorLat +
        coordinates.offsetY +
        (coordinates.height / 2) * coordinates.scaleY;
      const centerLng =
        coordinates.anchorLng +
        coordinates.offsetX +
        (coordinates.width / 2) * coordinates.scaleX;
      console.log(centerLat, centerLng);
      return [centerLat, centerLng];
    } */ else {
      return [51.23544, 6.79599];
    }
  }

  private updateMapLevel(level: MapConfigurationLevel) {
    const map = this.map!;

    map.eachLayer((layer) => {
      layer.removeFrom(map);
    });

    // Add the base tile layer
    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);

    // Fetch the bounds using the shared calculateBounds function
    const bounds = this.calculateBounds();

    // If no valid bounds are returned, return early
    if (!bounds) {
      return;
    }

    /*  const map = this.leaf.map(this.mapReference.nativeElement, {
      minZoom: 0,
      maxZoom: 18,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
    }); */

    if (level.blob) {
      const imgBlobURL = URL.createObjectURL(level.blob);
      const imageOverlay = this.leaf.imageOverlay(imgBlobURL, bounds, {
        opacity: 1,
        interactive: true,
      });
      imageOverlay.addTo(map);

      const zoom = this.config.mapSettings.zoomLevel;
      const center = this.getCenterCoordinates(this.config.coordinates);

      map.setView(center, zoom);
      map.fitBounds(imageOverlay.getBounds());

      // Add event listeners for zoom and drag
      fromEvent<L.LeafletEvent>(map, "zoomend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onZoomEnd());

      fromEvent<L.LeafletEvent>(map, "dragend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onDragEnd());
    }
  }
  /**
   * initialize the map markers for the current floor level
   */
  private initMarkers(map: L.Map, level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    const markerManagedObjects = Object.values(
      this.markerManagedObjectsForFloorLevel[level]
    );
    this.addMarkersToLevel(markerManagedObjects, map);
  }

  /**
   * create and add marker instances for the current floor level and add these
   * to the map. Register an event listener for click events to display the
   * corresponding popup with latest measurements.
   *
   * @param markerManagedObjects managed objects with geolocations, which should
   * be displayed on the map
   */
  private addMarkersToLevel(
    markerManagedObjects: MarkerManagedObject[],
    map: L.Map
  ): void {
    const markersLayer = this.leaf.featureGroup().addTo(map);
    markerManagedObjects.forEach((markerManagedObject) => {
      // if (!this.isGeolocationAvailable(markerManagedObject)) {
      //   return;
      // }
      if (!markerManagedObject["c8y_Position"]) {
        return;
      }

      const circleMarkerInstance =
        this.createCircleMarkerInstance(markerManagedObject).addTo(
          markersLayer
        );
      circleMarkerInstance.on("click", (event) => {
        // load measurements for all configured datapoints
        if (!markerManagedObject[this.KEY_MEASUREMENTS]) {
          this.loadLatestMeasurements(markerManagedObject).then(() =>
            this.updatePopupInstanceContent(markerManagedObject)
          );
        }

        this.openPopupForMarkerInstance(
          markerManagedObject,
          event.target._latlng
        );
      });

      markerManagedObject[this.KEY_MAP_MARKER_INSTANCE] = circleMarkerInstance;
    });
  }

  /**
   * render the legend of the thresholds in case they have been defined in the configuration for the widget
   */
  private renderLegend(map: L.Map): void {
    if (
      !this.config.legend ||
      !this.config.legend.thresholds ||
      this.config.legend.thresholds.length === 0
    ) {
      return;
    }

    const legend = this.leaf.control.attribution({ position: "bottomleft" });
    legend.onAdd = () => {
      const div = this.leaf.DomUtil.create("div", "legend");

      if (this.config?.legend?.title) {
        div.innerHTML += `<h4>${this.config.legend.title}</h4>`;
      }

      this.config?.legend?.thresholds?.forEach((threshold) => {
        div.innerHTML += `<div class="entry"><i style="background: ${threshold.color}"></i><span>${threshold.label}</span ></div>`;
      });

      return div;
    };

    legend.addTo(map);
  }

  /**
   * creates a circle marker instance with background color depending on the
   * current primary measurement and the defined thresholds.
   *
   * @param managedObject
   * @returns circle marker instance
   */
  private createCircleMarkerInstance(
    managedObject: MarkerManagedObject
  ): L.CircleMarker {
    // return this.leaf.circleMarker([get(managedObject, 'c8y_Position.lat'), get(managedObject, 'c8y_Position.lng')], {
    //   fillColor: this.getBackgroundColor(managedObject[this.KEY_LATEST_MEASUREMENT]),
    //   fillOpacity: 0.75,
    //   radius: 40,
    //   weight: 0,
    //   interactive: true,
    // });
    const { lat, lng } = get(managedObject, "c8y_Position");
    //managedObject.[c8y_Position]!;
    return this.leaf.circleMarker([lat, lng], {
      fillColor: this.getBackgroundColor(
        managedObject[this.KEY_LATEST_MEASUREMENT]
      ),
      fillOpacity: 0.75,
      radius: 13,
      weight: 0,
      interactive: true,
    });
  }

  /**
   * display a popup if user clicked on a marker instance
   *
   * @param managedObject to which the popup should be related to
   * @param geolocation at which the popup should be displayed
   */
  private openPopupForMarkerInstance(
    managedObject: IManagedObject,
    geolocation: any
  ) {
    const popup = this.createPopupInstance(managedObject, geolocation);
    popup.openOn(this.map);
    managedObject[this.KEY_MAP_MARKER_POPUP_INSTANCE] = popup;
  }

  /**
   * creates the popup instance
   *
   * @param managedObject to get name and measurements which should be displayed
   * @param geolocation at which the popup should be displayed
   * @returns instance of popup
   */
  private createPopupInstance(
    managedObject: IManagedObject,
    geolocation: any
  ): any {
    const popup = this.leaf.popup({
      closeButton: false,
      autoClose: true,
      className: "indoor-map-popup",
    });
    popup
      .setLatLng(geolocation)
      .setContent(
        this.getPopupContent(
          managedObject,
          !!managedObject[this.KEY_MEASUREMENTS]
            ? Object.values(managedObject[this.KEY_MEASUREMENTS])
            : []
        )
      );

    return popup;
  }

  /**
   * Updates the content of a popup assigned to the given managed object
   *
   * @param managedObject whose popup should be updated
   */
  private updatePopupInstanceContent(managedObject: IManagedObject): void {
    const popupInstance = managedObject[this.KEY_MAP_MARKER_POPUP_INSTANCE];

    if (!popupInstance) {
      return;
    }

    popupInstance.setContent(
      this.getPopupContent(
        managedObject,
        !!managedObject[this.KEY_MEASUREMENTS]
          ? Object.values(managedObject[this.KEY_MEASUREMENTS])
          : []
      )
    );
  }

  /**
   * create an html string which describes the content of a popup instance.
   * It includes the device name and the measurements.
   *
   * @param deviceName used for the headline
   * @param measurements to display in the popup
   * @returns html string
   */
  private getPopupContent(
    managedObject: IManagedObject,
    measurements?: Measurement[]
  ): string {
    let contentString = this.getPopupHeader(managedObject);

    if (!measurements || measurements.length === 0) {
      contentString += `<p style="text-align:center">Type : ${managedObject["type"]}</p>`;
      return contentString;
    }

    measurements.forEach((measurement) => {
      const datapointConfig = this.config.datapointsPopup?.find(
        (datapoint) =>
          `${datapoint.measurement.fragment}.${datapoint.measurement.series}` ===
          `${measurement.datapoint.fragment}.${measurement.datapoint.series}`
      );
      const measurementString = measurement.unit
        ? `${measurement.value}${measurement.unit}`
        : `${measurement.value}`;
      contentString += `<p>${datapointConfig?.label}: <span class="measurement-value">${measurementString}</span></p>`;
    });

    return contentString;
  }

  /**
   * returns the header for the popup. In case the device has a dashboard id assigned to
   * it, the dashboard will linked in the header.
   *
   * @param managedObject for which the popup should be created
   * @returns header as an html string
   */
  private getPopupHeader(managedObject: IManagedObject): string {
    // if (!has(managedObject, 'dashboardId')) {
    //   return `<h5>${managedObject['name']}</h5><hr />`;
    // }

    return `<a href="#/device/${managedObject.id}"><h5>${managedObject["name"]}</h5></a><hr />`;
  }

  /**
   * Load the latest measurement based on the configured popup measurements for a
   * given managedObject. The measurements will be directly stored on the
   * managed object as a custom property.
   *
   * @param managedObject
   */
  private async loadLatestMeasurements(
    managedObject: IManagedObject
  ): Promise<void> {
    const datapoints: Datapoint[] =
      this.config.datapointsPopup?.map(
        (datapointPopup) => datapointPopup.measurement
      ) ?? [];

    const promises = datapoints.map((datapoint) =>
      this.mapService.loadLatestMeasurement(
        managedObject.id,
        datapoint.fragment,
        datapoint.series
      )
    );
    const measurements = await Promise.all(promises);

    measurements.forEach((measurement, index) => {
      if (measurement) {
        const datapoint = `${datapoints[index].fragment}.${datapoints[index].series}`;
        managedObject[this.KEY_MEASUREMENTS] = Object.assign(
          !!managedObject[this.KEY_MEASUREMENTS]
            ? managedObject[this.KEY_MEASUREMENTS]
            : {},
          { [datapoint]: measurement }
        );
      }
    });
  }

  /**
   * get the background color based on the thresholds which have been defined
   * in the widgets configuration. If there aren't any thresholds return the
   * default color
   *
   * @param measurement
   * @returns color as hex string
   */
  private getBackgroundColor(measurement: Measurement | undefined): string {
    if (
      !this.config.legend ||
      !this.config.legend.thresholds ||
      this.config.legend.thresholds.length === 0
    ) {
      return this.MARKER_DEFAULT_COLOR;
    }

    if (!measurement) {
      return this.MARKER_DEFAULT_COLOR;
    }

    return this.MARKER_DEFAULT_COLOR;
  }

  private isMarkersAvailableForCurrentFloorLevel(level: number): boolean {
    return (
      this.markerManagedObjectsForFloorLevel &&
      this.markerManagedObjectsForFloorLevel.length > 0 &&
      !!this.markerManagedObjectsForFloorLevel[level]
    );
  }
}
