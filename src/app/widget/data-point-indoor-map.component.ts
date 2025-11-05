/**
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or its licensors
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
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
  private readonly MARKER_HIGHLIGHT_COLOR = "#FFC300"; // Distinct color for highlighting
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
  searchString: string = "";
  selectedType: string = ""; // New property for the type filter

  private zonesFeatureGroup?: L.FeatureGroup;
  public showZones: boolean = false; // Controls visibility of all zones
  private loadedZones: any[] = [];
  private isolatedLayer: L.Layer | null = null;
  public isZoneIsolated: boolean = false;

  destroy$ = new EventEmitter<void>();

  private markersLayer?: L.FeatureGroup; // Feature group to hold the markers
  private filteredDevicesForGrid: IManagedObject[] = []; // Used for the data grid

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
    this.isLoading = false;
    this.updateMapLevel(this.building!.levels![level]);
    // Re-initialize markers to apply level change and current search string
    this.initMarkers(this.map!, level);
  }

  /**
   * Public method to call when searchString or selectedType changes from the HTML.
   */
  public filterMarkers(): void {
    if (this.map) {
      // Re-initialize markers to apply the new filter
      this.initMarkers(this.map, this.currentFloorLevel);
    }
    // The data grid is automatically filtered via the getter
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
    const managedObjectsForFloorLevels =
      await this.buildingService.loadMarkersForLevels(building.levels);
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
    (mapMarkerInstance as L.CircleMarker).setStyle({ fillColor });
  }

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
      // If bounds are completely missing, initialize map without image focus
      const map = this.leaf.map(this.mapReference.nativeElement);
      this.leaf.Control.Attribution.prototype.options.prefix = false;
      this.leaf
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(map);
      map.setView(
        this.getCenterCoordinates(this.building?.coordinates),
        this.building?.zoomLevel
      );
      return map;
    }

    const controlPoints = this.getValidatedControlPoints();
    if (!controlPoints) {
      // If image control points are missing, but bounds exist, still initialize map
      const map = this.leaf.map(this.mapReference.nativeElement);
      this.leaf.Control.Attribution.prototype.options.prefix = false;
      this.leaf
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(map);
      map.fitBounds(bounds);
      return map;
    }
    const { topleft, topright, bottomleft } = controlPoints;

    const map = this.leaf.map(this.mapReference.nativeElement);

    (this.leaf.Control.Attribution.prototype as any).options.prefix = false;

    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
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
      map.fitBounds(bounds); // Fit map to initial bounds

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
    /* ... */
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

  public restoreZoneView(): void {
    if (!this.map) return;
    this.isZoneIsolated = false;
    if (this.isolatedLayer) {
      this.map.removeLayer(this.isolatedLayer);
      this.isolatedLayer = null;
    }
    this.renderZones(this.map);
    const fullBounds = this.calculateBounds();
    if (fullBounds) {
      this.map.fitBounds(fullBounds, { padding: [20, 20] });
    }
  }

  private renderZones(map: L.Map): void {
    if (!this.zonesFeatureGroup) {
      this.zonesFeatureGroup = this.leaf.featureGroup().addTo(map);
    }

    this.zonesFeatureGroup.clearLayers();
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

    if (!this.showZones || !this.loadedZones.length) {
      this.isolatedLayer = null;
      this.isZoneIsolated = false;
      return;
    }

    if (this.isZoneIsolated && this.isolatedLayer) {
      if (!map.hasLayer(this.isolatedLayer)) {
        this.isolatedLayer.addTo(map);
      }
      return;
    }
    this.loadedZones.forEach((zone: any) => {
      if (!zone.geometry) return;
      const layer = this.leaf.geoJSON(zone.geometry);
      layer.eachLayer((vectorLayer) => {
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

          // --- ISOLATION MECHANISM ---
          if (clickedLayer.getBounds && clickedLayer.getBounds().isValid()) {
            const bounds = clickedLayer.getBounds();
            this.zonesFeatureGroup!.clearLayers();
            this.isolatedLayer = clickedLayer;
            this.isZoneIsolated = true;
            clickedLayer.addTo(mapInstance);
            mapInstance.invalidateSize(true);
            mapInstance.fitBounds(bounds, {
              padding: [50, 50],
              maxZoom: 19,
            });
          }
        });
        this.zonesFeatureGroup!.addLayer(vectorLayer);
      });
    });
  }

  /**
   * FIX: Stop changing zoom when level changes.
   * 1. Get current map zoom before clearing layers.
   * 2. Remove all calls to map.fitBounds().
   */
  private updateMapLevel(level: MapConfigurationLevel) {
    const map = this.map!;

    // FIX: Get the current zoom level before clearing the map
    const currentZoom = map.getZoom();

    // 1. Clear existing layers (except base tiles)
    if (this.zonesFeatureGroup) {
      this.zonesFeatureGroup.clearLayers();
    }
    if (this.markersLayer) {
      this.markersLayer.clearLayers();
    }
    map.eachLayer((layer) => {
      if (
        layer !== this.zonesFeatureGroup &&
        layer !== this.markersLayer &&
        !(layer instanceof this.leaf.TileLayer)
      ) {
        layer.removeFrom(map);
      }
    });

    // 2. Re-add base tile layer
    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
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

    // 3. Load and add the new floor image overlay
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

      const center = this.getCenterCoordinates(this.building?.coordinates);

      // FIX: Set view using the center of the building and the saved current zoom
      map.setView(center, currentZoom);

      // ❌ REMOVED: map.fitBounds(bounds) and map.fitBounds(imageOverlay.getBounds())
      // This prevents the map from forcing a new zoom level based on the image size.

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
    this.renderZones(this.map);
  }

  /**
   * Initializes (or re-initializes) the map markers for the current floor level,
   * applying the current search filter.
   */
  private initMarkers(map: L.Map, level: number): void {
    if (!this.isMarkersAvailableForCurrentFloorLevel(level)) {
      return;
    }

    // 1. Clear existing markers layer if it exists
    if (this.markersLayer) {
      this.markersLayer.clearLayers();
      this.markersLayer.removeFrom(map);
    }

    const allMarkerManagedObjects = Object.values(
      this.markerManagedObjectsForFloorLevel[level]
    );

    // 2. Filter the markers based on searchString AND selectedType
    const filteredMarkers = this.filterMarkersBySearchString(
      allMarkerManagedObjects,
      this.searchString
    );

    // 3. Add the markers to a new layer
    this.addMarkersToLevel(allMarkerManagedObjects, map, filteredMarkers);
  }

  /**
   * Filters the list of managed objects based on the search string AND selected type.
   * Searches in 'name', 'type', and 'id' and all string fields for the searchString.
   */
  private filterMarkersBySearchString(
    managedObjects: MarkerManagedObject[],
    searchString: string
  ): MarkerManagedObject[] {
    const term = searchString ? searchString.toLowerCase().trim() : "";

    return managedObjects.filter((mo: IManagedObject) => {
      // 1. Filter by selected Type first
      if (this.selectedType && mo["type"] !== this.selectedType) {
        return false;
      }

      // 2. Filter by Search String (if present)
      if (!term) {
        return true; // No search term, so it passed the type filter
      }

      // Check Name
      if (mo["name"] && mo["name"].toLowerCase().includes(term)) {
        return true;
      }
      // Check Type
      if (mo["type"] && mo["type"].toLowerCase().includes(term)) {
        return true;
      }
      // Check ID (as string)
      if (mo.id && mo.id.toString().toLowerCase().includes(term)) {
        return true;
      }
      // Check other fields (generic approach)
      for (const key in mo) {
        if (Object.prototype.hasOwnProperty.call(mo, key)) {
          const value = (mo as any)[key];
          if (typeof value === "string" && value.toLowerCase().includes(term)) {
            return true;
          }
        }
      }
      return false;
    });
  }

  /**
   * create and add marker instances for the current floor level and add these
   * to the map.
   *
   * @param allMarkerManagedObjects All devices for the level.
   * @param map The Leaflet map instance.
   * @param filteredMarkers The subset of devices that match the search filter (for highlighting).
   */
  private addMarkersToLevel(
    allMarkerManagedObjects: MarkerManagedObject[],
    map: L.Map,
    filteredMarkers: MarkerManagedObject[]
  ): void {
    // Initialize or re-initialize the markers layer
    if (this.markersLayer) {
      this.markersLayer.clearLayers();
    } else {
      this.markersLayer = this.leaf.featureGroup();
    }

    this.markersLayer.addTo(map);

    // Create a set of IDs for quick lookup of filtered markers
    const filteredIds = new Set(filteredMarkers.map((mo) => mo.id));

    allMarkerManagedObjects.forEach((markerManagedObject) => {
      if (!markerManagedObject["c8y_Position"]) {
        return;
      }

      const isFiltered = filteredIds.has(markerManagedObject.id);

      const circleMarkerInstance = this.createCircleMarkerInstance(
        markerManagedObject,
        isFiltered
      ).addTo(
        this.markersLayer! // Use the class property FeatureGroup
      );

      markerManagedObject[this.KEY_MAP_MARKER_INSTANCE] = circleMarkerInstance;
    });
  }

  /**
   * creates a circle marker instance with background color depending on the
   * current primary measurement and the defined thresholds.
   *
   * @param managedObject
   * @param isFiltered True if this marker matches the current search filter (searchString or selectedType).
   * @returns circle marker instance
   */
  private createCircleMarkerInstance(
    managedObject: MarkerManagedObject,
    isFiltered: boolean
  ): L.CircleMarker {
    const position = get(managedObject, "c8y_Position") as
      | { lat: number; lng: number }
      | undefined;

    const baseColor = this.getBackgroundColor(
      managedObject[this.KEY_LATEST_MEASUREMENT]
    );

    const markerStyle: L.CircleMarkerOptions = {
      fillColor: baseColor,
      fillOpacity: 0.75,
      radius: 13,
      weight: 0,
      interactive: true,
    };

    const isFilterActive =
      this.searchString.trim().length > 0 || this.selectedType.length > 0;

    if (isFiltered && isFilterActive) {
      // Apply highlight style
      markerStyle.color = this.MARKER_HIGHLIGHT_COLOR; // Stroke color
      markerStyle.weight = 3; // Thicker stroke
      markerStyle.fillOpacity = 0.9; // Slightly brighter fill
    } else if (isFilterActive && !isFiltered) {
      // If searching/filtering but this item isn't filtered, make it faded/less visible
      markerStyle.fillOpacity = 0.15;
      markerStyle.color = "rgba(0,0,0,0.1)";
      markerStyle.weight = 1;
    }

    if (!position) {
      // Fallback position
      return this.leaf.circleMarker([0, 0], markerStyle);
    }

    return this.leaf.circleMarker([position.lat, position.lng], markerStyle);
  }

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

  /**
   * Helper method to extract unique device types from the current floor's markers.
   */
  public getUniqueDeviceTypes(): string[] {
    if (!this.isMarkersAvailableForCurrentFloorLevel(this.currentFloorLevel)) {
      return [];
    }

    const allMarkers = Object.values(
      this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]
    );

    const types = allMarkers
      .map((mo) => mo["type"])
      .filter((type): type is string => !!type); // Filter out undefined/null and assert string

    return [...new Set(types)].sort(); // Get unique types and sort them
  }

  /**
   * Getter for the data grid: Filters all managed objects based on the current search string and selected type.
   */
  public getManagedObjectsForCurrentFloorLevel(): IManagedObject[] {
    const allMarkers = this.markerManagedObjectsForFloorLevel[
      this.currentFloorLevel
    ]
      ? Object.values(
          this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]
        )
      : [];

    // Apply the same filtering logic used for the map markers to the data grid list
    this.filteredDevicesForGrid = this.filterMarkersBySearchString(
      allMarkers,
      this.searchString
    );

    return this.filteredDevicesForGrid;
  }
}
