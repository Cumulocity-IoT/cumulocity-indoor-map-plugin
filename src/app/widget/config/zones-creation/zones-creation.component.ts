import {
  ChangeDetectionStrategy,
  Component,
  AfterViewInit,
  OnDestroy,
  signal,
  effect,
  Input,
  OnInit,
  ViewEncapsulation,
  EventEmitter,
  Output,
  ViewChild,
  ElementRef,
} from "@angular/core";
import * as L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import { BsModalRef } from "ngx-bootstrap/modal";
import { InventoryBinaryService } from "@c8y/client";
import {
  GPSCoordinates,
  MapConfiguration,
} from "../../../models/data-point-indoor-map.model";
import { ImageRotateService } from "../../../services/image-rotate.service";

@Component({
  selector: "c8y-zone-creation-component",
  templateUrl: "./zones-creation.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./zones-creation.component.less"],
  providers: [ImageRotateService],
  encapsulation: ViewEncapsulation.None,
})
export class ZonesComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() initialConfig!: MapConfiguration;
  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;

  private zoneFeatureGroup: L.FeatureGroup | undefined;
  private imageOverlayLayer: L.ImageOverlay | undefined;

  zones = signal<any[]>([]);
  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });
  public currentFloorLevel: number = 0;

  private allZonesByLevel: { [levelId: string]: string } = {};
  private hasInitialBoundsFit = false;

  constructor(
    private bsModalRef: BsModalRef,
    private binaryService: InventoryBinaryService,
    private imageRotateService: ImageRotateService // <--- INJECTED SERVICE
  ) {}

  async ngOnInit() {
    // 1. Initialize ImageRotateService (must be done before using L.imageOverlay.rotated)
    if (typeof L !== "undefined") {
      this.imageRotateService.initialize(L);
    }

    // 2. Set imageBounds from initial config
    if (this.initialConfig?.coordinates?.topLeftLat !== 0) {
      this.imageBounds.set({
        tl: {
          lat: this.initialConfig.coordinates.topLeftLat ?? 0,
          lng: this.initialConfig.coordinates.topLeftLng ?? 0,
        },
        br: {
          lat: this.initialConfig.coordinates.bottomRightLat ?? 0,
          lng: this.initialConfig.coordinates.bottomRightLng ?? 0,
        },
      });
    }

    // 3. Initialize allZonesByLevel cache from input
    const inputAllZones = this.initialConfig.allZonesByLevel as any;
    if (inputAllZones) {
      Object.assign(this.allZonesByLevel, inputAllZones);
    }

    // 4. Load current floor's zones into the 'zones' signal
    const currentLevelIndex = this.currentFloorLevel.toString();
    const zonesJsonString = this.allZonesByLevel[currentLevelIndex];

    if (
      zonesJsonString &&
      typeof zonesJsonString === "string" &&
      zonesJsonString.length > 0
    ) {
      try {
        const savedZones = JSON.parse(zonesJsonString);
        this.zones.set(savedZones);
      } catch (e) {
        console.error(
          `Failed to parse zones JSON for level ${currentLevelIndex}:`,
          e
        );
      }
    }
  }

  async ngAfterViewInit(): Promise<void> {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }

    await this.initMap();
    if (this.map) {
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize(true);
          this.centerMapOnBounds();
          this.drawSavedZones();
        }
      }, 300);
    }
  }

  private async getImage(imageId: string): Promise<Blob> {
    const imageBlob = await (
      (await this.binaryService.download(imageId)) as Response
    ).blob();
    return imageBlob;
  }

  private getValidatedControlPoints():
    | { topleft: L.LatLng; topright: L.LatLng; bottomleft: L.LatLng }
    | undefined {
    const coords = this.initialConfig.coordinates;
    if (!coords) {
      return undefined;
    }

    // 1. Prioritize true Polygon vertices if available (for rotation/skew)
    if (coords.polygonVerticesJson) {
      try {
        const polygonData = JSON.parse(coords.polygonVerticesJson);
        const vertices = polygonData[0]; // Assuming array of arrays

        if (vertices && vertices.length >= 4) {
          const V1 = vertices[0];
          const V2 = vertices[1];
          const V4 = vertices[3];

          // Use L.latLng directly with optional chaining/nullish coalescing for safety
          const topleft = L.latLng(V1.lat ?? 0, V1.lng ?? 0);
          const topright = L.latLng(V2.lat ?? 0, V2.lng ?? 0);
          const bottomleft = L.latLng(V4.lat ?? 0, V4.lng ?? 0);

          return { topleft, topright, bottomleft };
        }
      } catch (e) {
        console.error("Failed to parse polygonVerticesJson for overlay:", e);
      }
    }

    // 2. Fallback: Use the bounding box corners
    const topLat = coords.topLeftLat ?? 0;
    const leftLng = coords.topLeftLng ?? 0;
    const bottomLat = coords.bottomRightLat ?? 0;
    const rightLng = coords.bottomRightLng ?? 0;

    if (!topLat && !leftLng && !bottomLat && !rightLng) {
      return undefined;
    }

    // Create the three LatLng objects using bounding box logic
    const topleft = L.latLng(topLat, leftLng);
    const topright = L.latLng(topLat, rightLng);
    const bottomleft = L.latLng(bottomLat, leftLng);

    return { topleft, topright, bottomleft };
  }

  private async initMap() {
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);
    const currentLevelConfig =
      this.initialConfig.levels?.[this.currentFloorLevel];

    // Map initialization
    this.map = L.map(this.mapReference.nativeElement, {
      center: bounds?.getCenter() || [52.52, 13.4],
      zoom: 15,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    // Initialize Geoman controls first (and feature group)
    this.initGeomanControl();

    // Image Overlay Placement using three-point logic
    if (currentLevelConfig?.binaryId && bounds) {
      await this.placeImageOverlay(currentLevelConfig.binaryId);
    }
  }

  /**
   * Refactored logic to place the image overlay using the three-point method.
   */
  private async placeImageOverlay(binaryId: string): Promise<void> {
    const controlPoints = this.getValidatedControlPoints();

    if (!controlPoints) {
      console.warn("Cannot place image overlay: Control points missing.");
      return;
    }

    try {
      const imgSource = URL.createObjectURL(await this.getImage(binaryId));

      // Access the rotated factory registered by ImageRotateService
      const imageOverlayFactory = (L.imageOverlay as any).rotated;

      // Use the three-point factory for accurate georeferencing
      if (imageOverlayFactory) {
        this.imageOverlayLayer = imageOverlayFactory(
          imgSource,
          controlPoints.topleft,
          controlPoints.topright,
          controlPoints.bottomleft,
          { opacity: 1, interactive: true }
        );

        this.imageOverlayLayer!.addTo(this.map!);
        this.map!.fitBounds(this.imageOverlayLayer!.getBounds());
      } else {
        // Fallback to standard overlay if plugin is not initialized (should not happen)
        const bounds = this.getLeafletBounds(this.imageBounds());
        this.imageOverlayLayer = L.imageOverlay(imgSource, bounds!, {
          opacity: 1,
          interactive: true,
        });
        this.imageOverlayLayer.addTo(this.map!);
        this.map!.fitBounds(bounds!);
      }
    } catch (error) {
      console.error("Failed to place image overlay:", error);
    }
  }

  private drawSavedZones(): void {
    if (!this.map) return;

    // Ensure we have a feature group
    if (!this.zoneFeatureGroup) {
      this.zoneFeatureGroup = new L.FeatureGroup();
      this.map.addLayer(this.zoneFeatureGroup);
    }

    // Clear existing layers
    this.zoneFeatureGroup.clearLayers();

    const currentZones = this.zones();

    if (!currentZones || currentZones.length === 0) {
      return;
    }

    currentZones.forEach((zone: any, index: number) => {
      if (!zone.geometry) {
        return;
      }

      try {
        const layer = L.geoJSON(zone.geometry);
        layer.eachLayer((vectorLayer) => {
          if (vectorLayer instanceof L.Path) {
            (vectorLayer as any).setStyle({
              color: "#0000FF",
              weight: 2,
              fillOpacity: 0.4,
            });
          }

          this.zoneFeatureGroup!.addLayer(vectorLayer);

          (vectorLayer as any).pm.enable({
            allowSelfIntersection: false,
            rotate: true,
          });

          if (zone.rotation && (vectorLayer as any).setRotation) {
            (vectorLayer as any).setRotation(zone.rotation);
          }
        });
      } catch (error) {
        console.error(`Failed to create layer for zone ${index}:`, error);
      }
    });

    if (
      this.zoneFeatureGroup.getLayers().length > 0 &&
      !this.hasInitialBoundsFit
    ) {
      this.map!.fitBounds(this.zoneFeatureGroup.getBounds());
      this.hasInitialBoundsFit = true;
    }
  }

  private initGeomanControl(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    // Initialize the FeatureGroup
    this.zoneFeatureGroup = new L.FeatureGroup();
    this.map.addLayer(this.zoneFeatureGroup);

    mapWithPm.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawRectangle: true,
      drawPolygon: true,

      editMode: true,
      dragMode: true,
      cutPolygon: false,
      deleteMode: true,
      rotateMode: true,
      allowSelfIntersection: false,

      edit: {
        featureGroup: this.zoneFeatureGroup,
      },
    });

    mapWithPm.on("pm:create", (e: any) => {
      const layer = e.layer;
      this.zoneFeatureGroup?.addLayer(layer);
      layer.pm.enable({ allowSelfIntersection: false, rotate: true });
      this.updateZonesState();
    });

    mapWithPm.on("pm:remove", (e: any) => {
      this.zoneFeatureGroup!.removeLayer(e.layer);
      setTimeout(() => {
        this.updateZonesState();
      }, 50);
    });

    mapWithPm.on("pm:edit", (e: any) => {
      this.updateZonesState();
    });

    mapWithPm.on("pm:rotateend", (e: any) => {
      setTimeout(() => {
        this.updateZonesState();
      }, 0);
    });
  }

  public async onFloorLevelChanged(newLevelIndex: number): Promise<void> {
    if (this.currentFloorLevel === newLevelIndex) return;

    // 1. Save the current state of the old floor
    this.updateZonesState();

    // 2. Update the active level index
    this.currentFloorLevel = newLevelIndex;

    // 3. Load the new floor's data from the allZonesByLevel cache
    const zonesJsonString = this.allZonesByLevel[newLevelIndex.toString()];

    let savedZones: any[] = [];
    if (zonesJsonString) {
      try {
        savedZones = JSON.parse(zonesJsonString);
      } catch (e) {
        console.error(
          `Failed to parse zones JSON for level ${newLevelIndex}:`,
          e
        );
      }
    }
    this.zones.set(savedZones);

    // 4. Redraw map contents
    if (this.map) {
      await this.redrawMapContents();
    }
  }

  private async redrawMapContents() {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    // Clear all layers
    this.map.eachLayer((layer) => {
      layer.remove();
    });

    // Add base tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    const currentLevelConfig =
      this.initialConfig?.levels?.[this.currentFloorLevel];
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);

    if (currentLevelConfig?.binaryId && bounds) {
      // Use the injected service logic for image placement
      await this.placeImageOverlay(currentLevelConfig.binaryId);

      // Re-initialize feature group and geoman controls
      this.zoneFeatureGroup = new L.FeatureGroup();
      this.map.addLayer(this.zoneFeatureGroup);
      mapWithPm.pm.setGlobalOptions({
        layerGroup: this.zoneFeatureGroup,
      });

      this.drawSavedZones();

      this.map.invalidateSize(true);
      this.centerMapOnBounds();
    }
  }

  private updateZonesState(): void {
    if (!this.zoneFeatureGroup) return;

    const currentZones: any[] = [];
    this.zoneFeatureGroup.eachLayer((layer: any) => {
      if (layer.toGeoJSON) {
        const geoJson = layer.toGeoJSON();
        let rotationAngle = 0;

        // 1. Check layer options (where Geoman typically stores the final rotation)
        rotationAngle = layer.options.rotation || 0;

        // 2. If not found in options, check the Geoman editing instance state
        if (rotationAngle === 0 && layer.pm) {
          rotationAngle =
            (layer.pm as any)._rotation || (layer.pm as any)._rotateAngle || 0;
        }

        currentZones.push({
          geometry: geoJson.geometry,
          rotation: rotationAngle,
        });
      }
    });

    this.zones.set(currentZones);
    const currentLevelIndex = this.currentFloorLevel.toString();
    this.allZonesByLevel[currentLevelIndex] = JSON.stringify(currentZones);

    this.emitConfigChange(null);
  }

  private emitConfigChange(payload: any): void {
    const finalConfig = {
      allZonesByLevel: this.allZonesByLevel,
    };
    this.boundaryChange.emit(finalConfig as GPSCoordinates);
  }

  private getLeafletBounds(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): L.LatLngBounds | undefined {
    if (bounds.tl.lat === 0) return undefined;
    const southWest = L.latLng(bounds.br.lat, bounds.tl.lng);
    const northEast = L.latLng(bounds.tl.lat, bounds.br.lng);
    return L.latLngBounds(southWest, northEast);
  }
  private centerMapOnBounds(): void {
    const bounds = this.getLeafletBounds(this.imageBounds());
    if (this.map && bounds) {
      this.map.fitBounds(bounds);
    }
  }
  ngOnDestroy(): void {
    if (this.map) {
      (this.map as any).pm.removeControls();
      this.map.off();
      this.map.remove();
    }
  }

  onCancel(): void {
    this.boundaryChange.emit();
    this.bsModalRef.hide();
  }

  onSave(): void {
    this.updateZonesState();
    this.emitConfigChange(null);
    this.bsModalRef.hide();
  }
}
