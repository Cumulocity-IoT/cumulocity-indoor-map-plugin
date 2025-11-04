/**
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or its licensors
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
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
import { IManagedObject } from "@c8y/client";
import {
  MapConfiguration,
  MapConfigurationLevel,
  MarkerManagedObject,
  Measurement,
  WidgetConfiguration,
} from "../models/data-point-indoor-map.model";
import type * as L from "leaflet";
import { MeasurementRealtimeService } from "@c8y/ngx-components";
import { fromEvent, Subscription, takeUntil } from "rxjs";
import { EventPollingService } from "./polling/event-polling.service";
import { get } from "lodash";
import { BuildingService } from "../services/building.service";
import { ImageRotateService } from "../services/image-rotate.service";

@Component({
  selector: "data-point-indoor-map",
  templateUrl: "data-point-indoor-map.component.html",
  styleUrls: ["./data-point-indoor-map.component.less"],
  providers: [
    MeasurementRealtimeService,
    EventPollingService,
    BuildingService,
    ImageRotateService,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class DataPointIndoorMapComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  @Input() config!: WidgetConfiguration;
  @ViewChild("IndoorDataPointMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;

  building?: MapConfiguration;

  private readonly MARKER_DEFAULT_COLOR = "#1776BF";
  private readonly KEY_LATEST_MEASUREMENT = "latestPrimaryMeasurement";
  private readonly KEY_MEASUREMENTS = "measurements";
  private readonly KEY_MAP_MARKER_INSTANCE = "mapMarkerInstance";

  currentFloorLevel = 0;
  currentLevel?: MapConfigurationLevel;

  private markerManagedObjectsForFloorLevel: {
    [deviceId: string]: MarkerManagedObject;
  }[] = [];

  leaf!: typeof L;
  map?: L.Map;
  measurementReceivedSub?: Subscription;
  primaryMeasurementReceivedSub?: Subscription;
  eventThresholdSub?: Subscription;
  isLoading = false;

  private zonesFeatureGroup?: L.FeatureGroup;
  public showZones: boolean = false; // Controls visibility of all zones
  private loadedZones: any[] = [];
  private isolatedLayer: L.Layer | null = null;
  public isZoneIsolated: boolean = false;

  destroy$ = new EventEmitter<void>();

  constructor(
    private buildingService: BuildingService,
    private imageRotateService: ImageRotateService
  ) {}

  async ngOnInit() {
    console.log("this.config,", this.config.buildingId);

    this.leaf = await import("leaflet");
    this.imageRotateService.initialize(this.leaf);
  }

  async ngAfterViewInit(): Promise<void> {
    this.isLoading = true;
    if (this.config?.buildingId) {
      this.building = await this.loadMapConfiguration();
      console.log("this.building", this.building);
      await this.loadManagedObjectsForMarkers(this.building);
      const level = this.currentFloorLevel;
      await this.loadLatestPrimaryMeasurementForMarkers(level);
      this.initMeasurementUpdates(level);
      this.isLoading = false;
      this.map = this.initMap(this.building, level);
      this.initMarkers(this.map, level);
    } else {
      this.isLoading = false;
    }
    // this.initEventUpdates(level);
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
    this.buildingService.unsubscribeAllMeasurements();
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
    return this.buildingService.loadMapConfigurationWithImages(
      this.config.buildingId
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

    console.log("Building levels:", building.levels);

    const managedObjectsForFloorLevels =
      await this.buildingService.loadMarkersForLevels(building.levels);
    console.log("managedObjectsForFloorLevels:", managedObjectsForFloorLevels);
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
    console.log(
      "Loaded managed objects for floor levels:",
      this.markerManagedObjectsForFloorLevel
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
  }

  private initMeasurementUpdates(level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    //this.subscribeForMeasurementUpdates(level);
    //this.listenToPrimaryMeasurementUpdates(level);
    this.listenToConfiguredMeasurementUpdates(level);
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
    this.measurementReceivedSub = this.buildingService.measurementReceived$
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
    if (this.building?.coordinates) {
      const { topLeftLat, topLeftLng, bottomRightLat, bottomRightLng } =
        this.building.coordinates;

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
    return null;
  }

  private getValidatedControlPoints():
    | {
        topleft: L.LatLng;
        topright: L.LatLng;
        bottomleft: L.LatLng;
      }
    | undefined {
    // 1. Try to get accurate polygon points first (for rotated images)
    const polygonPoints = this.getPolygonControlPoints();
    if (polygonPoints) {
      return polygonPoints;
    }

    // 2. Fallback: Use the bounding box corners if polygon data is missing
    const coords = this.building?.coordinates;
    if (!coords) {
      return undefined;
    }

    // Safely extract coordinates, defaulting to 0 for error prevention
    const topLat = coords.topLeftLat ?? 0;
    const leftLng = coords.topLeftLng ?? 0;
    const bottomLat = coords.bottomRightLat ?? 0;
    const rightLng = coords.bottomRightLng ?? 0;

    // Ensure at least some coordinate data is present (e.g., non-zero) for a valid overlay
    if (!topLat && !leftLng && !bottomLat && !rightLng) {
      return undefined;
    }

    // Create the three LatLng objects using bounding box logic
    const topleft = this.leaf.latLng(topLat, leftLng);
    const topright = this.leaf.latLng(topLat, rightLng);
    const bottomleft = this.leaf.latLng(bottomLat, leftLng);

    return { topleft, topright, bottomleft };
  }

  private initMap(building: MapConfiguration, level: number): L.Map {
    const currentMapConfigurationLevel = building.levels[level];

    const bounds = this.calculateBounds();
    if (!bounds) {
      return this.leaf.map(this.mapReference.nativeElement);
    }

    const controlPoints = this.getValidatedControlPoints();
    if (!controlPoints) {
      return this.leaf.map(this.mapReference.nativeElement);
    }
    const { topleft, topright, bottomleft } = controlPoints;

    const map = this.leaf.map(this.mapReference.nativeElement);

    this.leaf.Control.Attribution.prototype.options.prefix = false;

    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);

    if (currentMapConfigurationLevel?.blob) {
      const imgBlobURL = URL.createObjectURL(currentMapConfigurationLevel.blob);
      const imageOverlay = (this.leaf.imageOverlay as any).rotated(
        imgBlobURL,
        topleft,
        topright,
        bottomleft,
        {
          opacity: 1,
          interactive: true,
        }
      );
      imageOverlay.addTo(map);

      const zoom = this.building?.zoomLevel;
      const center = this.getCenterCoordinates(this.building?.coordinates);

      map.setView(center, zoom);
      map.fitBounds(bounds);

      fromEvent<L.LeafletEvent>(map, "zoomend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onZoomEnd());

      fromEvent<L.LeafletEvent>(map, "dragend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onDragEnd());
    }
    this.renderZones(map);
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
      `${this.config.buildingId}-${this.currentFloorLevel}-center`,
      JSON.stringify(this.map!.getCenter())
    );
  }

  private getPolygonControlPoints():
    | {
        topleft: L.LatLng;
        topright: L.LatLng;
        bottomleft: L.LatLng;
      }
    | undefined {
    if (this.building?.coordinates?.polygonVerticesJson) {
      try {
        const polygonData = JSON.parse(
          this.building.coordinates.polygonVerticesJson
        );
        // Assuming polygonData is an array of arrays, and we want the first vertex set
        const vertices = polygonData[0];

        // Assuming V1=TopLeft, V2=TopRight, V4=BottomLeft of the image area
        if (vertices && vertices.length >= 4) {
          const V1 = vertices[0];
          const V2 = vertices[1];
          const V4 = vertices[3]; // The fourth point in the array

          // We use the LatLng constructor with the true polygon points
          // Nullish coalescing is needed here in case polygon points themselves are undefined
          const topleft = this.leaf.latLng(V1.lat ?? 0, V1.lng ?? 0);
          const topright = this.leaf.latLng(V2.lat ?? 0, V2.lng ?? 0);
          const bottomleft = this.leaf.latLng(V4.lat ?? 0, V4.lng ?? 0);

          return { topleft, topright, bottomleft };
        }
      } catch (e) {
        console.error("Failed to parse polygonVerticesJson:", e);
      }
    }
    return undefined;
  }

  getCenterCoordinates(coordinates: any): [number, number] {
    if (coordinates) {
      const topLeftLat = coordinates.topLeftLat ?? 0;
      const bottomRightLat = coordinates.bottomRightLat ?? 0;
      const topLeftLng = coordinates.topLeftLng ?? 0;
      const bottomRightLng = coordinates.bottomRightLng ?? 0;

      const centerLat = (topLeftLat + bottomRightLat) / 2;
      const centerLng = (topLeftLng + bottomRightLng) / 2;

      return [centerLat, centerLng];
    } else {
      return [51.23544, 6.79599];
    }
  }
  private renderZones(map: L.Map): void {
    if (!this.zonesFeatureGroup) {
      this.zonesFeatureGroup = this.leaf.featureGroup().addTo(map);
    }

    this.zonesFeatureGroup.clearLayers();

    if (!this.showZones || !this.building?.coordinates) {
      // If zones are supposed to be hidden, ensure we are not isolated.
      this.isolatedLayer = null;
      this.isZoneIsolated = false;
      return;
    }

    // 1. Parse Zones from config (same logic as before)
    const allZonesData = this.building?.allZonesByLevel;

    let zonesJsonString;
    if (allZonesData) {
      zonesJsonString = allZonesData[this.currentFloorLevel];
    }

    if (!(zonesJsonString && typeof zonesJsonString === "string")) {
      this.loadedZones = [];
      return;
    }
    try {
      this.loadedZones = JSON.parse(zonesJsonString);
    } catch (e) {
      console.error("Failed to parse zones JSON during rendering:", e);
      this.loadedZones = [];
      return;
    }
    if (this.isZoneIsolated && this.isolatedLayer) {
      this.isolatedLayer.addTo(map);
      return;
    }
    // 2. Draw each zone and add click handlers
    this.loadedZones.forEach((zone: any) => {
      if (!zone.geometry) return;

      const layer = this.leaf.geoJSON(zone.geometry);

      layer.eachLayer((vectorLayer) => {
        // Check if it's a vector layer (L.Path) for styling
        if (vectorLayer instanceof this.leaf.Path) {
          (vectorLayer as any).setStyle({
            color: "#0000FF",
            weight: 3,
            fillOpacity: 0.3,
          });
        }
        vectorLayer.on("click", (e: L.LeafletMouseEvent) => {
          const clickedLayer = e.target;
          const mapInstance = map;

          if (clickedLayer.getBounds && clickedLayer.getBounds().isValid()) {
            const bounds = clickedLayer.getBounds();

            this.zonesFeatureGroup!.remove();

            this.isolatedLayer = clickedLayer;
            this.isZoneIsolated = true;

            clickedLayer.addTo(mapInstance); // Add the isolated layer to the map

            mapInstance.invalidateSize(true);

            mapInstance.fitBounds(bounds, {
              padding: [50, 50],
              maxZoom: 18,
            });
          }
        });
        this.zonesFeatureGroup!.addLayer(vectorLayer);
      });
    });
  }

  private updateMapLevel(level: MapConfigurationLevel) {
    const map = this.map!;

    if (this.zonesFeatureGroup) {
      this.zonesFeatureGroup.clearLayers();
    }

    map.eachLayer((layer) => {
      if (layer !== this.zonesFeatureGroup) {
        layer.removeFrom(map);
      }
    });
    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);

    const bounds = this.calculateBounds();

    const controlPoints = this.getValidatedControlPoints();
    if (!controlPoints) {
      return;
    }
    const { topleft, topright, bottomleft } = controlPoints;

    if (level.blob) {
      const imgBlobURL = URL.createObjectURL(level.blob);

      const imageOverlay = (this.leaf.imageOverlay as any).rotated(
        imgBlobURL,
        topleft,
        topright,
        bottomleft,
        {
          opacity: 1,
          interactive: true,
        }
      );
      imageOverlay.addTo(map);

      const zoom = this.building?.zoomLevel;
      const center = this.getCenterCoordinates(this.building?.coordinates);

      map.setView(center, zoom);
      map.fitBounds(imageOverlay.getBounds());

      // Add event listeners for zoom and drag
      fromEvent<L.LeafletEvent>(map, "zoomend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onZoomEnd());

      fromEvent<L.LeafletEvent>(map, "dragend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onDragEnd());
      this.renderZones(map);
    }
  }
  public toggleZoneVisibility(): void {
    if (!this.map) return;
    this.renderZones(this.map); // Rerun renderZones, which will show/hide based on this.showZones
  }
  /**
   * initialize the map markers for the current floor level
   */
  private initMarkers(map: L.Map, level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    console.log("Initializing markers for level:", level);
    console.log(this.markerManagedObjectsForFloorLevel);
    console.log(
      "Marker managed objects:",
      this.markerManagedObjectsForFloorLevel[level]
    );

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
    console.log("Adding markers to level:", markerManagedObjects);
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

      markerManagedObject[this.KEY_MAP_MARKER_INSTANCE] = circleMarkerInstance;
    });
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
    const position = get(managedObject, "c8y_Position") as
      | { lat: number; lng: number }
      | undefined;
    if (!position) {
      // Fallback position with default style, though this should never happen due to earlier check
      return this.leaf.circleMarker([0, 0], {
        fillColor: this.MARKER_DEFAULT_COLOR,
        fillOpacity: 0.75,
        radius: 13,
        weight: 0,
        interactive: true,
      });
    }
    return this.leaf.circleMarker([position.lat, position.lng], {
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
   * get the background color based on the thresholds which have been defined
   * in the widgets configuration. If there aren't any thresholds return the
   * default color
   *
   * @param measurement
   * @returns color as hex string
   */
  private getBackgroundColor(measurement: Measurement | undefined): string {
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
