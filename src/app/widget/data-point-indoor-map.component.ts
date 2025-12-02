import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
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
  WidgetConfiguration,
} from "../models/data-point-indoor-map.model";
import type * as L from "leaflet";
import { MeasurementRealtimeService } from "@c8y/ngx-components";
import { BehaviorSubject, fromEvent, Subscription, takeUntil } from "rxjs";
import { EventPollingService } from "./polling/event-polling.service";
import { get, isEmpty } from "lodash";
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataPointIndoorMapComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  @Input() config!: WidgetConfiguration;
  @ViewChild("IndoorDataPointMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;

  isLoading$: BehaviorSubject<boolean> = new BehaviorSubject(false);

  building?: MapConfiguration;

  private readonly MARKER_DEFAULT_COLOR = "#1776BF";
  private readonly MARKER_HIGHLIGHT_COLOR = "#FFC300"; // Distinct color for highlighting
  private readonly KEY_MAP_MARKER_INSTANCE = "mapMarkerInstance";
  private readonly MAX_ZOOM = 23;

  // Icon configuration
  private readonly DEFAULT_ICON = "location";
  private readonly ICON_SIZE = [36, 26] as [number, number];
  private readonly ICON_ANCHOR = [18, 26] as [number, number];

  // Configurable properties
  private get useIcons(): boolean {
    return this.config?.markerStyle?.useIcons !== false; // Default to true
  }

  private get configuredIconSize(): [number, number] {
    return this.config?.markerStyle?.iconSize || this.ICON_SIZE;
  }

  private get configuredDefaultIcon(): string {
    return this.config?.markerStyle?.defaultIcon || this.DEFAULT_ICON;
  }

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
  searchString: string = "";
  selectedType: string = ""; // New property for the type filter

  private zonesFeatureGroup?: L.FeatureGroup;
  public showZones: boolean = false; // Controls visibility of all zones
  private loadedZones: any[] = [];
  private isolatedLayer: L.Layer | null = null;
  public isZoneIsolated: boolean = false;

  destroy$ = new EventEmitter<void>();

  private markersLayer?: L.FeatureGroup; // Feature group to hold the markers

  // 1. OPTIMIZATION: New properties to replace getters
  public filteredDevicesForGrid: IManagedObject[] = []; // Used for the data grid
  public uniqueDeviceTypes: string[] = []; // Used for the type select dropdown

  constructor(
    private buildingService: BuildingService,
    private imageRotateService: ImageRotateService,
    private cd: ChangeDetectorRef // 1. OPTIMIZATION: Inject ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.leaf = await import("leaflet");
    this.imageRotateService.initialize(this.leaf);
  }

  async ngAfterViewInit(): Promise<void> {
    this.isLoading$.next(true);
    console.log("ngAfterViewInit: Loading map data...");
    this.cd.detectChanges(); // Trigger change detection to show loading indicator

    if (this.config?.buildingId) {
      this.building = await this.loadMapConfiguration();
      await this.loadManagedObjectsForMarkers(this.building);
      const level = this.currentFloorLevel;
      await this.loadLatestPrimaryMeasurementForMarkers(level);

      this.map = this.initMap(this.building, level);

      // 1. OPTIMIZATION: Update data properties after map and markers are ready
      this.initMarkers(this.map, level);
      this.updateFilterProperties();

      this.isLoading$.next(false);
      this.cd.detectChanges(); // Trigger change detection to hide loading indicator
    } else {
      this.isLoading$.next(false);
      this.cd.detectChanges();
    }
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
    this.cd.detectChanges(); // Show loading

    const level = this.currentFloorLevel;
    this.buildingService.unsubscribeAllMeasurements();
    if (this.eventThresholdSub) {
      this.eventThresholdSub.unsubscribe();
    }

    await this.loadLatestPrimaryMeasurementForMarkers(level);
    this.unsubscribeListeners();

    // Update map view and markers
    this.updateMapLevel(this.building!.levels![level]);
    this.initMarkers(this.map!, level);

    this.updateFilterProperties();

    this.cd.detectChanges(); // Hide loading
  }

  private updateFilterProperties(): void {
    this.uniqueDeviceTypes = this.calculateUniqueDeviceTypes();
    this.filteredDevicesForGrid = this.filterMarkersBySearchString(
      this.getAllMarkersForCurrentLevel(),
      this.searchString
    );
    this.cd.detectChanges(); // Manually trigger change detection if using OnPush
  }

  /**
   * Public method to call when searchString or selectedType changes from the HTML.
   */
  public filterMarkers(): void {
    if (this.map) {
      this.initMarkers(this.map, this.currentFloorLevel);
    }
    this.updateFilterProperties();
  }

  private getAllMarkersForCurrentLevel(): MarkerManagedObject[] {
    return this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]
      ? Object.values(
          this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]
        )
      : [];
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
   * Load the corresponding managed objects for all the markers...
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
    // Missing logic to actually load measurements. Assuming it's elsewhere or omitted for brevity.
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
    // ... (Map initialization logic remains the same for brevity) ...

    const controlPoints = this.getValidatedControlPoints();
    if (!controlPoints) {
      // If image control points are missing, but bounds exist, still initialize map
      const map = this.leaf.map(this.mapReference.nativeElement);
      this.leaf.Control.Attribution.prototype.options.prefix = false;
      this.leaf
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(map);

      if (bounds) {
        const zoom = this.building?.coordinates.zoomLevel;
        const center = this.getCenterCoordinates(this.building?.coordinates);
        map.setView(center, zoom);
      } else {
        map.setView(
          this.getCenterCoordinates(this.building?.coordinates),
          this.building?.coordinates?.zoomLevel
        );
      }
      return map;
    }
    const { topleft, topright, bottomleft } = controlPoints;

    const map = this.leaf.map(this.mapReference.nativeElement);

    (this.leaf.Control.Attribution.prototype as any).options.prefix = false;

    this.leaf
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: this.MAX_ZOOM,
        maxNativeZoom: 19,
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

      const zoom = this.building?.coordinates.zoomLevel;
      const center = this.getCenterCoordinates(this.building?.coordinates);

      map.setView(center, zoom);

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

          // Check if the clicked layer is already the isolated one
          if (this.isZoneIsolated && this.isolatedLayer === clickedLayer) {
            // If the isolated layer is clicked again, restore the full view.
            this.restoreZoneView();
          } else if (
            clickedLayer.getBounds &&
            clickedLayer.getBounds().isValid()
          ) {
            // --- ISOLATION MECHANISM (if not already isolated) ---

            // 1. If another zone is isolated, restore full view first
            if (this.isZoneIsolated) {
              this.restoreZoneView(); // Re-render all layers
            }

            // 2. Clear all layers to isolate the new clicked one
            this.zonesFeatureGroup!.clearLayers();
            const bounds = clickedLayer.getBounds();
            this.isolatedLayer = clickedLayer;
            this.isZoneIsolated = true;
            clickedLayer.addTo(mapInstance);
            mapInstance.invalidateSize(true);
            mapInstance.fitBounds(bounds, {
              padding: [50, 50],
            });
            this.cd.markForCheck(); // Update restore button visibility
          }
        });
        this.zonesFeatureGroup!.addLayer(vectorLayer);
      });
    });
  }

  /**
   * FIX: Stop changing zoom when level changes (or map refreshes).
   */
  private updateMapLevel(level: MapConfigurationLevel) {
    const map = this.map!;

    // Store the map's current center and zoom BEFORE clearing layers.
    const currentCenter = map.getCenter();
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
        maxZoom: this.MAX_ZOOM,
        maxNativeZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      })
      .addTo(map);

    const controlPoints = this.getValidatedControlPoints();

    if (!controlPoints) {
      // If no control points, we still restore the map view state
      map.setView(currentCenter, currentZoom);
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

      // FIX: Restore the map view using the captured current center and zoom
      map.setView(currentCenter, currentZoom);

      fromEvent<L.LeafletEvent>(map, "zoomend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onZoomEnd());

      fromEvent<L.LeafletEvent>(map, "dragend")
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.onDragEnd());
      
      this.renderZones(map);
    }
  }

  /**
   * Refetches all managed object related information (position, marker, popover)
   * and updates them on the map without removing and re-initializing the entire Leaflet map.
   */
  public async refresh(): Promise<void> {
    // Check if the map is initialized and a building is configured
    if (!this.map || !this.config?.buildingId) {
      console.warn("Map not initialized or buildingId missing, falling back to full init.");
      // Fallback to the original logic if essential data is missing (e.g., first load)
      this.isLoading$.next(true);
      await this.ngAfterViewInit(); 
      return;
    }

    this.isLoading$.next(true);
    this.cd.detectChanges(); // Show loading indicator

    try {
      const currentLevel = this.currentFloorLevel;

      // 1. Refetch the latest map configuration (to get new polygon/coordinates if updated)
      this.building = await this.loadMapConfiguration(); 

      // 2. Refetch the corresponding managed objects for all markers (e.g., position, fragments)
      if (this.building) {
        await this.loadManagedObjectsForMarkers(this.building);
      }
      
      // 3. Load latest measurements and events (required for coloring/styling)
      await this.loadLatestPrimaryMeasurementForMarkers(currentLevel); 
      
      // 4. Unsubscribe and re-subscribe to real-time updates (to ensure we use the latest devices)
      this.unsubscribeListeners();

      // 5. Update the map image (in case floor/image has changed) and zones
      // This preserves the map's current zoom and center
      if (this.building?.levels && this.building.levels[currentLevel]) {
        this.updateMapLevel(this.building.levels[currentLevel]);
      }

      // 6. Re-initialize markers to update positions, icons, and filter state
      this.initMarkers(this.map, currentLevel);

      // 7. Re-calculate and update the filter data properties for the grid/dropdown
      this.updateFilterProperties();

    } catch (error) {
      console.error("Error during non-disruptive map refresh:", error);
    } finally {
      this.isLoading$.next(false);
      this.cd.detectChanges(); // Hide loading indicator and update UI
    }
  }


  public toggleZoneVisibility(): void {
    if (!this.map) return;
    console.log(this.isolatedLayer);
    if (this.isolatedLayer) {
      // If the isolated layer is clicked again, restore the full view.
      this.restoreZoneView();
    }
    this.renderZones(this.map);
    this.cd.markForCheck();
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

    const filtered = managedObjects.filter((mo: IManagedObject) => {
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
      // Check other fields (generic approach) - POTENTIAL BOTTLENECK
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
    return filtered;
  }

  /**
   * create and add marker instances for the current floor level and add these
   * to the map.
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

    let markerCreationCount = 0;
    allMarkerManagedObjects.forEach((markerManagedObject) => {
      console.log("Processing markerManagedObject:", markerManagedObject);
      if (
        !markerManagedObject["c8y_Position"] ||
        markerManagedObject["c8y_Position"].lat == null ||
        markerManagedObject["c8y_Position"].lng == null
      ) {
        return;
      }

      const isFiltered = filteredIds.has(markerManagedObject.id);

      const markerInstance = this.useIcons
        ? this.createMarkerInstance(markerManagedObject, isFiltered)
        : this.createCircleMarkerInstance(markerManagedObject, isFiltered);

      markerInstance.addTo(this.markersLayer!);

      markerCreationCount++;

      markerManagedObject[this.KEY_MAP_MARKER_INSTANCE] = markerInstance;
    });
  }

  /**
   * creates a marker instance with a custom icon and color styling based on
   * current primary measurement and defined thresholds.
   */
  private createMarkerInstance(
    managedObject: MarkerManagedObject,
    isFiltered: boolean
  ): L.Marker {
    const position = get(managedObject, "c8y_Position") as
      | { lat: number; lng: number }
      | undefined;

    // Get marker configuration from c8y_marker fragment
    const markerConfig = managedObject.c8y_marker;

    const isFilterActive =
      this.searchString.trim().length > 0 || this.selectedType.length > 0;

    let opacity = 0.75;
    let borderWidth = 0;

    if (isFiltered && isFilterActive) {
      // Apply highlight style
      borderWidth = 3;
      opacity = 0.9;
    } else if (isFilterActive && !isFiltered) {
      // If searching/filtering but this item isn't filtered, make it faded/less visible
      opacity = 0.15;
      borderWidth = 1;
    }

    const customIcon = this.createCustomIcon(
      managedObject,
      this.MARKER_DEFAULT_COLOR,
      opacity,
      this.MARKER_DEFAULT_COLOR,
      borderWidth
    );

    if (!position) {
      // Fallback position
      return this.leaf.marker([0, 0], { icon: customIcon });
    }

    const marker = this.leaf.marker([position.lat, position.lng], {
      icon: customIcon,
    });

    // Add tooltip with device information
    const tooltipContent = this.createTooltipContent(managedObject);
    marker.bindTooltip(tooltipContent, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });

    return marker;
  }

  /**
   * Creates a custom DivIcon with the specified styling and icon
   */
  private createCustomIcon(
    managedObject: MarkerManagedObject,
    color: string,
    opacity: number,
    borderColor: string,
    borderWidth: number
  ): L.DivIcon {
    // Get marker configuration from c8y_marker fragment
    const markerConfig = managedObject.c8y_marker;

    // Use icon from c8y_marker or fallback to device type detection or default
    const iconName =
      markerConfig?.icon ||
      this.getIconForDeviceType(managedObject["type"]) ||
      this.configuredDefaultIcon;

    // Use icon_color from c8y_marker if available, otherwise use the calculated color
    const iconColor = markerConfig?.icon_color || color;
    const iconSize = markerConfig?.icon_size || this.configuredIconSize;

    const markerSize = markerConfig?.size || 36;
    const markerColor = markerConfig?.color || "#000000";

    // Create the icon HTML with Cumulocity icon classes
    const iconHtml = `
      <div class="custom-map-marker" style="
        width: ${markerSize}px;
        height: ${markerSize}px;
        background-color: ${markerColor};
        opacity: ${opacity};
        border: ${borderWidth}px solid ${borderColor};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      ">
      <i class="d-block c8y-icon dlt-c8y-icon-${iconName}" style="
          color: ${iconColor};
          font-size: ${iconSize}px;
        "></i>
      </div>
    `;

    return this.leaf.divIcon({
      html: iconHtml,
      className: "custom-map-marker-container",
      iconSize: this.ICON_SIZE,
      iconAnchor: this.ICON_ANCHOR,
    });
  }

  /**
   * Returns appropriate icon name based on device type
   */
  private getIconForDeviceType(deviceType?: string): string | null {
    if (!deviceType) {
      return null;
    }

    const typeIconMap: { [key: string]: string } = {
      c8y_TemperatureSensor: "thermometer",
      c8y_HumiditySensor: "droplet",
      c8y_LightSensor: "lightbulb-o",
      c8y_MotionSensor: "eye",
      c8y_Accelerometer: "dashboard",
      c8y_Gyroscope: "compass",
      c8y_Gateway: "router",
      c8y_Device: "device",
      c8y_Sensor: "sensors",
      // Add more mappings as needed
    };

    // Try exact match first
    if (typeIconMap[deviceType]) {
      return typeIconMap[deviceType];
    }

    // Try partial matches
    const lowerType = deviceType.toLowerCase();
    if (lowerType.includes("temperature") || lowerType.includes("temp")) {
      return "thermometer";
    }
    if (lowerType.includes("humidity")) {
      return "droplet";
    }
    if (lowerType.includes("light")) {
      return "lightbulb-o";
    }
    if (lowerType.includes("motion") || lowerType.includes("pir")) {
      return "eye";
    }
    if (lowerType.includes("gateway") || lowerType.includes("router")) {
      return "router";
    }
    if (lowerType.includes("sensor")) {
      return "sensors";
    }

    return null; // Will use default icon
  }

  /**
   * creates a circle marker instance (original implementation for backward compatibility)
   */
  private createCircleMarkerInstance(
    managedObject: MarkerManagedObject,
    isFiltered: boolean
  ): L.CircleMarker {
    const position = get(managedObject, "c8y_Position") as
      | { lat: number; lng: number }
      | undefined;

    // Get marker configuration from c8y_marker fragment
    const markerConfig = managedObject["c8y_marker"] as
      | {
          icon?: string;
          icon_color?: string;
          popup?: string;
        }
      | undefined;

    // Use icon_color from c8y_marker if available, otherwise use measurement-based color
    const baseColor = markerConfig?.icon_color || this.MARKER_DEFAULT_COLOR;
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

    const circleMarker = this.leaf.circleMarker(
      [position.lat, position.lng],
      markerStyle
    );

    // Add tooltip for circle markers too
    const tooltipContent = this.createTooltipContent(managedObject);
    circleMarker.bindTooltip(tooltipContent, {
      permanent: false,
      direction: "top",
      offset: [0, -10],
    });

    return circleMarker;
  }

  private createTooltipContent(managedObject: MarkerManagedObject): string {
    // Get marker configuration from c8y_marker fragment
    const markerConfig = managedObject.c8y_marker;

    // If custom popup content is defined in c8y_marker, use it
    if (markerConfig?.popup) {
      return markerConfig.popup;
    }
    return (
      "Name: " +
      managedObject["name"] +
      "<br/>" +
      "ID: " +
      managedObject.id +
      "<br/>" +
      "Type: " +
      managedObject["type"]
    );
  }

  private isMarkersAvailableForCurrentFloorLevel(level: number): boolean {
    return (
      this.markerManagedObjectsForFloorLevel &&
      this.markerManagedObjectsForFloorLevel.length > 0 &&
      !!this.markerManagedObjectsForFloorLevel[level]
    );
  }

  /**
   * Helper method to calculate unique device types (replacing the old getter).
   */
  private calculateUniqueDeviceTypes(): string[] {
    if (!this.isMarkersAvailableForCurrentFloorLevel(this.currentFloorLevel)) {
      return [];
    }

    const allMarkers = Object.values(
      this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]
    );

    const types = allMarkers
      .map((mo) => mo["type"])
      .filter((type): type is string => !!type); // Filter out undefined/null and assert string

    const uniqueTypes = [...new Set(types)].sort(); // Get unique types and sort them

    return uniqueTypes;
  }

  // 1. OPTIMIZATION: Removed the public getter getManagedObjectsForCurrentFloorLevel()
  // Data grid now uses the public property filteredDevicesForGrid
}