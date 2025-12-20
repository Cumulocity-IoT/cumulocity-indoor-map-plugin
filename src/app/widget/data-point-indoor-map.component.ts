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
  OnChanges,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from "@angular/core";
import { Router, ActivatedRoute } from "@angular/router";
import { IManagedObject } from "@c8y/client";
import { AlertService } from "@c8y/ngx-components";
import {
  MapConfiguration,
  MapConfigurationLevel,
  MarkerManagedObject,
  WidgetConfiguration,
} from "../models/data-point-indoor-map.model";
import type * as L from "leaflet";
import { MeasurementRealtimeService, Row } from "@c8y/ngx-components";
import { BehaviorSubject, fromEvent, Subscription, takeUntil } from "rxjs";
import { EventPollingService } from "./polling/event-polling.service";
import { get } from "lodash";
import { BuildingService } from "../services/building.service";
import { ImageRotateService } from "../services/image-rotate.service";
import { BsModalService } from "ngx-bootstrap/modal";
import { LeafletPopupActionModalComponent } from "./shared/components/leaflet-popup-action-modal/leaflet-popup-action-modal.component";

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
  implements OnInit, AfterViewInit, OnDestroy, OnChanges
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
  private isolatedZoneId: string | null = null; // Track isolated zone for URL sharing

  destroy$ = new EventEmitter<void>();

  private markersLayer?: L.FeatureGroup; // Feature group to hold the markers
  private highlightedMarker?: L.Marker | L.CircleMarker; // Currently highlighted marker
  private originalMarkerStyle?: any; // Original style of highlighted marker

  // 1. OPTIMIZATION: New properties to replace getters
  public filteredDevicesForGrid: IManagedObject[] = []; // Used for the data grid
  public uniqueDeviceTypes: string[] = []; // Used for the type select dropdown

  constructor(
    private buildingService: BuildingService,
    private imageRotateService: ImageRotateService,
    private modalService: BsModalService,
    private cd: ChangeDetectorRef, // 1. OPTIMIZATION: Inject ChangeDetectorRef
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private alertService: AlertService
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes["config"] && changes["config"].currentValue) {
      // Config has changed, trigger any necessary updates
    }
  }

  async ngOnInit() {
    this.leaf = await import("leaflet");
    this.imageRotateService.initialize(this.leaf);

    // Read URL parameters and set initial filter state
    this.readUrlParameters();

    // Subscribe to URL parameter changes (for browser back/forward navigation)
    this.activatedRoute.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        this.applyUrlParameters(params);
      });
  }

  async ngAfterViewInit(): Promise<void> {
    this.isLoading$.next(true);
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

    // Clear any existing highlight when changing levels
    this.clearMarkerHighlight();

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
    // Clear any existing highlight when filtering
    this.clearMarkerHighlight();

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
    | { topleft: L.LatLng; topright: L.LatLng; bottomleft: L.LatLng }
    | undefined {
    // 1. Try to get accurate polygon points first (for rotated images)
    const polygonPoints = this.getPolygonControlPoints();
    if (polygonPoints) {
      return polygonPoints;
    }

    // 2. Fallback: Use bounding box corners ONLY if polygon data is missing
    const coords = this.building?.coordinates;
    if (!coords) return undefined;

    const topLat = coords.topLeftLat ?? 0;
    const leftLng = coords.topLeftLng ?? 0;
    const bottomLat = coords.bottomRightLat ?? 0;
    const rightLng = coords.bottomRightLng ?? 0;

    if (!topLat && !leftLng && !bottomLat && !rightLng) return undefined;

    // Manual mapping for non-rotated rectangles
    return {
      topleft: this.leaf.latLng(topLat, leftLng),
      topright: this.leaf.latLng(topLat, rightLng),
      bottomleft: this.leaf.latLng(bottomLat, leftLng),
    };
  }

  private initMap(building: MapConfiguration, level: number): L.Map {
    const currentMapConfigurationLevel = building.levels[level];
    const controlPoints = this.getValidatedControlPoints();

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

    if (currentMapConfigurationLevel?.blob && controlPoints) {
      const imgBlobURL = URL.createObjectURL(currentMapConfigurationLevel.blob);

      // Using the rotated factory with three-point anchoring for perfect alignment
      const imageOverlay = (this.leaf.imageOverlay as any).rotated(
        imgBlobURL,
        controlPoints.topleft,
        controlPoints.topright,
        controlPoints.bottomleft,
        { opacity: 1, interactive: true }
      );
      imageOverlay.addTo(map);

      // FIX: Center map on building coordinates with the correct zoom level
      const zoom = this.building?.coordinates.zoomLevel || 18;
      const center = this.getCenterCoordinates(this.building?.coordinates);
      map.setView(center, zoom);

      // Setup event listeners for persistence
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
        // Ensure we are accessing the first ring
        const vertices = Array.isArray(polygonData[0])
          ? polygonData[0]
          : polygonData;

        if (vertices && vertices.length >= 4) {
          // COORDINATE LOCK:
          // GPSComponent now saves in order: 0:TL, 1:TR, 2:BR, 3:BL
          const V1 = vertices[0]; // Top-Left
          const V2 = vertices[1]; // Top-Right
          const V4 = vertices[3]; // Bottom-Left

          return {
            topleft: this.leaf.latLng(V1.lat, V1.lng),
            topright: this.leaf.latLng(V2.lat, V2.lng),
            bottomleft: this.leaf.latLng(V4.lat, V4.lng),
          };
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
    this.isolatedZoneId = null;
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

    // Apply isolated zone from URL if specified
    if (this.isolatedZoneId && !this.isZoneIsolated) {
      this.applyIsolatedZoneFromUrl();
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
            // Store zone ID for URL sharing
            this.isolatedZoneId =
              zone.id ||
              zone.properties?.id ||
              `zone_${this.loadedZones.indexOf(zone)}`;
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
   * Refetches only device-related managed object information (position, marker, popover)
   * and updates them on the map, skipping the expensive map/image configuration reload.
   */
  public async refresh(): Promise<void> {
    // Check if the map and building configuration are already initialized.
    if (!this.map || !this.building || !this.config?.buildingId) {
      console.warn(
        "Map not fully initialized, falling back to full initialization."
      );
      // Fallback to the original logic if essential data is missing (e.g., first load)
      this.isLoading$.next(true);
      await this.ngAfterViewInit();
      return;
    }

    this.isLoading$.next(true);
    this.cd.detectChanges(); // Show loading indicator

    try {
      const currentLevel = this.currentFloorLevel;

      // 1. *** IMPORTANT FIX: SKIP loadMapConfiguration() ***
      // We skip reloading the map configuration to ensure the floor plan image BLOB
      // is not re-fetched or re-initialized.

      // 2. Refetch the corresponding managed objects for all markers (position, fragments)
      await this.loadManagedObjectsForMarkers(this.building);

      // 3. Load latest measurements and events (required for coloring/styling)
      await this.loadLatestPrimaryMeasurementForMarkers(currentLevel);

      // 4. Unsubscribe and re-subscribe to real-time updates
      this.unsubscribeListeners();

      // 5. Re-initialize markers to update positions, icons, and filter state
      // This is the core update mechanism: it clears and redraws all device markers.
      this.initMarkers(this.map, currentLevel);

      // 6. Re-calculate and update the filter data properties for the grid/dropdown
      this.updateFilterProperties();
    } catch (error) {
      console.error("Error during lightweight map refresh:", error);
    } finally {
      this.isLoading$.next(false);
      this.cd.detectChanges(); // Hide loading indicator and update UI
    }
  }

  public toggleZoneVisibility(): void {
    if (!this.map) return;
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

    marker
      .bindPopup(tooltipContent, {
        // must set this to true for the click handler to work reliably.
        interactive: true,
      })
      .openPopup();
    marker.on("popupopen", (e) => {
      // Get the DOM element containing the popup content
      const popupElement = e.popup.getElement();

      // Selector to find ALL action icons we added
      const actionIcons =
        popupElement?.querySelectorAll<HTMLElement>("[data-action-type]");

      if (actionIcons && actionIcons.length > 0) {
        // Use a self-referencing variable (self = this) to call the Angular method
        const self = this;

        // Define the common click handler
        const iconClickHandler = function (this: HTMLElement) {
          // Retrieve both the device ID and the action type
          const deviceId = this.getAttribute("data-device-id");
          const actionType = this.getAttribute("data-action-type") as
            | "alarm"
            | "event"
            | "operation"
            | null;

          if (deviceId && actionType) {
            self.openActionModal(managedObject, actionType);
            e.target.closePopup();
          }
        };

        actionIcons.forEach((icon) => {
          icon.addEventListener("click", iconClickHandler);
        });

        const cleanupListener = () => {
          actionIcons.forEach((icon) => {
            icon.removeEventListener("click", iconClickHandler);
          });
          marker.off("popupclose", cleanupListener); // Remove the cleanup listener itself
        };
        marker.once("popupclose", cleanupListener);
      }
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

    const markerSize = Number(markerConfig?.size) || 36;
    const markerColor = markerConfig?.color || "#000000";

    // Get label content from managed object
    const labelContent = this.createMarkerLabelContent(managedObject);

    // Create the icon HTML with Cumulocity icon classes and label
    const iconHtml = `
      <div class="custom-map-marker-wrapper">
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
        ${labelContent ? `<div class="marker-label">${labelContent}</div>` : ""}
      </div>
    `;

    // Adjust icon size and anchor to account for label
    const iconSizeWithLabel: [number, number] = [
      Math.max(markerSize, 120),
      markerSize + (labelContent ? 25 : 0),
    ];
    const iconAnchorWithLabel: [number, number] = [
      iconSizeWithLabel[0] / 2,
      markerSize / 2,
    ];

    return this.leaf.divIcon({
      html: iconHtml,
      className: "custom-map-marker-container",
      iconSize: iconSizeWithLabel,
      iconAnchor: iconAnchorWithLabel,
    });
  }

  /**
   * Creates label content for marker based on managed object data
   *
   * Usage: Add a label to your managed object with the c8y_marker fragment:
   * {
   *   "c8y_marker": {
   *     "label": "Custom Label Text"
   *   }
   * }
   *
   * If no custom label is provided, it falls back to:
   * 1. Device name (truncated to 20 chars)
   * 2. Device type
   * 3. Device ID
   */
  private createMarkerLabelContent(managedObject: MarkerManagedObject): string {
    // Check if custom label is defined in c8y_marker fragment
    const markerConfig = managedObject.c8y_marker;
    if (markerConfig?.label) {
      return markerConfig.label;
    }

    // Default label logic - show device name or type
    const name = managedObject["name"];
    const type = managedObject["type"];

    // Priority: name > type > id
    if (name && name.length <= 20) {
      return name;
    } else if (name && name.length > 20) {
      return name.substring(0, 17) + "...";
    } else if (type) {
      return type;
    } else {
      return managedObject.id || "Device";
    }
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

    circleMarker
      .bindPopup(tooltipContent, {
        // must set this to true for the click handler to work reliably.
        interactive: true,
      })
      .openPopup();
    circleMarker.on("popupopen", (e) => {
      // Get the DOM element containing the popup content
      const popupElement = e.popup.getElement();

      // Selector to find ALL action icons we added
      const actionIcons =
        popupElement?.querySelectorAll<HTMLElement>("[data-action-type]");

      if (actionIcons && actionIcons.length > 0) {
        // Use a self-referencing variable (self = this) to call the Angular method
        const self = this;

        // Define the common click handler
        const iconClickHandler = function (this: HTMLElement) {
          // Retrieve both the device ID and the action type
          const deviceId = this.getAttribute("data-device-id");
          const actionType = this.getAttribute("data-action-type") as
            | "alarm"
            | "event"
            | "operation"
            | null;

          if (deviceId && actionType) {
            self.openActionModal(managedObject, actionType);

            e.target.closePopup();
          }
        };

        actionIcons.forEach((icon) => {
          icon.addEventListener("click", iconClickHandler);
        });

        const cleanupListener = () => {
          actionIcons.forEach((icon) => {
            icon.removeEventListener("click", iconClickHandler);
          });
          circleMarker.off("popupclose", cleanupListener); // Remove the cleanup listener itself
        };
        circleMarker.once("popupclose", cleanupListener);
      }
    });
    return circleMarker;
  }

  public openActionModal(
    managedObject: IManagedObject,
    actionType: "alarm" | "event" | "operation"
  ): void {
    console.log(
      `Open modal for Device ID: ${managedObject.id}, Action Type: ${actionType}`
    );

    this.modalService.show(LeafletPopupActionModalComponent, {
      initialState: {
        device: managedObject,
        actionType: actionType,
      },
    });
  }

  private createTooltipContent(managedObject: MarkerManagedObject): string {
    // Get marker configuration from c8y_marker fragment
    const markerConfig = managedObject.c8y_marker;

    const deviceId = managedObject.id;

    const modalIconHtml = `
        <i 
            id="alarm-${deviceId}" 
            class="c8y-icon dlt-c8y-icon-alarm pull-right" 
            style="cursor: pointer;  font-size: 18px; margin-left: 10px;"
            data-device-id="${deviceId}"
            data-action-type="alarm"
            title ="Create Alarm"
        ></i>
        <i 
            id="event-${deviceId}" 
            class="c8y-icon dlt-c8y-icon-online1 pull-right" 
            style="cursor: pointer;  font-size: 18px; margin-left: 10px;"
            data-device-id="${deviceId}"
            data-action-type="event"
             title ="Create Event"
        ></i>
        <i 
            id="op-${deviceId}" 
            class="c8y-icon c8y-icon-device-control pull-right" 
            style="cursor: pointer;  font-size: 18px; margin-left: 10px;"
            data-device-id="${deviceId}"
            data-action-type="operation"
             title ="Create Operation"
        ></i>
    `;

    if (markerConfig?.popup) {
      // Note: The icons are now prepended to the custom popup content
      return modalIconHtml + markerConfig.popup;
    }

    // Default content with the icons
    return `
        <div class="indoor-map-popup-content">
            <span style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: bold;">
                   Name: ${managedObject["name"]}
                </span>
                ${modalIconHtml}
            </span>
        </div>
        <hr style="margin: 5px 0; border-top: 1px solid #eee;">
        <div>ID: ${managedObject.id}</div>
        <div>Type: ${managedObject["type"]}</div>
    `;
  }

  private isMarkersAvailableForCurrentFloorLevel(level: number): boolean {
    return (
      this.markerManagedObjectsForFloorLevel &&
      this.markerManagedObjectsForFloorLevel.length > 0 &&
      !!this.markerManagedObjectsForFloorLevel[level]
    );
  }

  /**
   * Highlights and zooms to the marker corresponding to the clicked row
   */
  public highlightRow(row: Row): void {
    if (!this.map || !row) {
      return;
    }

    // The device data is directly in the row object, not in row.item
    const deviceId = row.id || row["item"]?.id;

    const markerManagedObject =
      this.markerManagedObjectsForFloorLevel[this.currentFloorLevel]?.[
        deviceId
      ];

    if (!markerManagedObject) {
      return;
    }

    const markerInstance = markerManagedObject[this.KEY_MAP_MARKER_INSTANCE] as
      | L.Marker
      | L.CircleMarker;

    if (!markerInstance) {
      return;
    }

    // Clear previous highlight
    this.clearMarkerHighlight();

    // Store reference to currently highlighted marker
    this.highlightedMarker = markerInstance;

    // Get marker position
    const position = markerInstance.getLatLng();

    // Apply highlight styling
    this.applyMarkerHighlight(markerInstance);

    // Pan and zoom to the marker with fixed zoom level
    const currentZoom = this.map.getZoom();
    const targetZoom = 18; // Fixed zoom level to prevent continuous zooming

    // Use flyTo for smooth combined pan and zoom
    this.map.flyTo(position, targetZoom, {
      animate: true,
      duration: 0.8,
      easeLinearity: 0.25,
    });

    // Optional: Open popup if marker has one
    if (markerInstance.getPopup()) {
      markerInstance.openPopup();
    }
  }

  /**
   * Applies highlight styling to a marker
   */
  private applyMarkerHighlight(marker: L.Marker | L.CircleMarker): void {
    // Check if it's a circle marker by checking if it has setStyle method
    if (marker && typeof (marker as any).setStyle === "function") {
      // Store original style for circle markers
      this.originalMarkerStyle = {
        color: (marker as any).options.color,
        weight: (marker as any).options.weight,
        fillOpacity: (marker as any).options.fillOpacity,
      };

      // Apply highlight style with prominent border
      (marker as any).setStyle({
        color: this.MARKER_HIGHLIGHT_COLOR,
        weight: 6, // Thicker border for clicked highlight
        fillOpacity: 1.0,
      });
    } else {
      // For icon markers, add border highlight effect
      const markerElement = marker.getElement();

      if (markerElement) {
        markerElement.classList.add("marker-highlighted");
        markerElement.classList.add("marker-clicked-highlight");
      }
    }
  }

  /**
   * Clears the current marker highlight
   */
  private clearMarkerHighlight(): void {
    if (!this.highlightedMarker) {
      return;
    }

    // Check if it's a circle marker by checking if it has setStyle method
    if (
      typeof (this.highlightedMarker as any).setStyle === "function" &&
      this.originalMarkerStyle
    ) {
      // Restore original style for circle markers
      (this.highlightedMarker as any).setStyle(this.originalMarkerStyle);
    } else {
      // Remove highlight class and inline styles for icon markers
      const markerElement = this.highlightedMarker.getElement();
      if (markerElement) {
        markerElement.classList.remove("marker-highlighted");
        markerElement.classList.remove("marker-clicked-highlight");
        (markerElement as HTMLElement).style.border = "";
        (markerElement as HTMLElement).style.borderRadius = "";
        (markerElement as HTMLElement).style.boxShadow = "";
        (markerElement as HTMLElement).style.animation = "";
        (markerElement as HTMLElement).style.zIndex = "";
      }
    }

    this.highlightedMarker = undefined;
    this.originalMarkerStyle = undefined;
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

  /**
   * Read URL parameters and set initial filter state
   */
  private readUrlParameters(): void {
    const params = this.activatedRoute.snapshot.queryParams;
    this.applyUrlParameters(params);
  }

  /**
   * Apply URL parameters to component state
   */
  private applyUrlParameters(params: any): void {
    // Apply search string from URL
    if (params["search"]) {
      this.searchString = params["search"];
    }

    // Apply selected type from URL
    if (params["type"]) {
      this.selectedType = params["type"];
    }

    // Apply floor level from URL
    if (params["floor"] !== undefined) {
      const floorLevel = parseInt(params["floor"], 10);
      if (!isNaN(floorLevel) && floorLevel >= 0) {
        this.currentFloorLevel = floorLevel;
      }
    }

    // Apply zone configuration from URL
    if (params["zones"] === "true") {
      this.showZones = true;
    } else if (params["zones"] === "false") {
      this.showZones = false;
    }

    // Apply isolated zone from URL
    if (params["isolatedZone"]) {
      this.isolatedZoneId = params["isolatedZone"];
      // Note: Zone isolation will be applied after zones are loaded in renderZones
    }
  }

  /**
   * Get a shareable URL with current filter configuration
   */
  public getShareableUrl(): string {
    const queryParams: any = {};

    if (this.searchString && this.searchString.trim()) {
      queryParams["search"] = this.searchString.trim();
    }

    if (this.selectedType) {
      queryParams["type"] = this.selectedType;
    }

    if (this.currentFloorLevel !== 0) {
      queryParams["floor"] = this.currentFloorLevel;
    }

    // Include zone configuration
    if (this.showZones) {
      queryParams["zones"] = "true";
    }

    if (this.isZoneIsolated && this.isolatedZoneId) {
      queryParams["isolatedZone"] = this.isolatedZoneId;
    }

    const urlTree = this.router.createUrlTree([], {
      relativeTo: this.activatedRoute,
      queryParams: queryParams,
    });

    return window.location.origin + this.router.serializeUrl(urlTree);
  }

  /**
   * Share button click handler - updates URL and copies to clipboard with notification
   */
  public onShareConfiguration(): void {
    // Update URL with current configuration
    this.updateUrlParameters();

    // Get the shareable URL
    const shareableUrl = this.getShareableUrl();

    // Try to copy to clipboard if supported
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(shareableUrl)
        .then(() => {
          this.alertService.success("Configuration URL copied to clipboard!");
        })
        .catch((err) => {
          console.warn("Failed to copy to clipboard:", err);
          this.fallbackCopyToClipboard(shareableUrl);
        });
    } else {
      this.fallbackCopyToClipboard(shareableUrl);
    }
  }

  /**
   * Fallback method to copy URL to clipboard for older browsers
   */
  private fallbackCopyToClipboard(text: string): void {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand("copy");
      if (successful) {
        this.alertService.success("Configuration URL copied to clipboard!");
      } else {
        this.alertService.warning("Please copy the URL manually: " + text);
      }
    } catch (err) {
      console.warn("Fallback copy failed:", err);
      this.alertService.warning("Please copy the URL manually: " + text);
    }

    document.body.removeChild(textArea);
  }

  /**
   * Update URL parameters to reflect current filter state (manual trigger only)
   */
  private updateUrlParameters(): void {
    const queryParams: any = {};

    // Add search string to URL if not empty
    if (this.searchString && this.searchString.trim()) {
      queryParams["search"] = this.searchString.trim();
    }

    // Add selected type to URL if not empty
    if (this.selectedType) {
      queryParams["type"] = this.selectedType;
    }

    // Add floor level to URL if not default (0)
    if (this.currentFloorLevel !== 0) {
      queryParams["floor"] = this.currentFloorLevel;
    }

    // Add zone configuration
    if (this.showZones) {
      queryParams["zones"] = "true";
    }

    if (this.isZoneIsolated && this.isolatedZoneId) {
      queryParams["isolatedZone"] = this.isolatedZoneId;
    }

    // Update URL without triggering navigation
    this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: queryParams,
      queryParamsHandling: "replace", // Replace current query params
      replaceUrl: true, // Don't add to browser history
    });
  }

  /**
   * Apply isolated zone from URL parameters after zones are loaded
   */
  private applyIsolatedZoneFromUrl(): void {
    if (this.isolatedZoneId && this.loadedZones.length > 0 && this.map) {
      const targetZone = this.loadedZones.find((zone) => {
        return (
          zone.id === this.isolatedZoneId ||
          zone.properties?.id === this.isolatedZoneId ||
          `zone_${this.loadedZones.indexOf(zone)}` === this.isolatedZoneId
        );
      });

      if (targetZone && targetZone.geometry) {
        const layer = this.leaf.geoJSON(targetZone.geometry);
        layer.eachLayer((vectorLayer) => {
          if (vectorLayer instanceof this.leaf.Path) {
            (vectorLayer as any).setStyle({
              color: "#0000FF",
              weight: 3,
              fillOpacity: 0.3,
            });
          }

          if (
            (vectorLayer as any).getBounds &&
            (vectorLayer as any).getBounds().isValid()
          ) {
            this.zonesFeatureGroup!.clearLayers();
            this.isolatedLayer = vectorLayer;
            this.isZoneIsolated = true;
            vectorLayer.addTo(this.map!);
            this.map!.invalidateSize(true);
            this.map!.fitBounds((vectorLayer as any).getBounds(), {
              padding: [50, 50],
            });
          }
        });
      }
    }
  }
}
