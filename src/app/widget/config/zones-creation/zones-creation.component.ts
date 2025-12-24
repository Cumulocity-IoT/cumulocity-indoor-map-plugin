import {
  ChangeDetectionStrategy,
  Component,
  AfterViewInit,
  OnDestroy,
  signal,
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
  public currentZoomLevel!: number;
  private readonly MAX_ZOOM = 23;

  private allZonesByLevel: { [levelId: string]: string } = {};
  private hasInitialBoundsFit = false;

  constructor(
    private bsModalRef: BsModalRef,
    private binaryService: InventoryBinaryService,
    private imageRotateService: ImageRotateService
  ) {}

  async ngOnInit() {
    if (typeof L !== "undefined") {
      this.imageRotateService.initialize(L);
    }

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

    const inputAllZones = this.initialConfig.allZonesByLevel as any;
    if (inputAllZones) {
      Object.assign(this.allZonesByLevel, inputAllZones);
    }

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
    if (this.initialConfig?.coordinates?.zoomLevel) {
      this.currentZoomLevel = Math.floor(
        this.initialConfig.coordinates.zoomLevel
      );
    } else {
      this.currentZoomLevel = 18;
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
    if (!coords) return undefined;

    if (coords.polygonVerticesJson) {
      try {
        const polygonData = JSON.parse(coords.polygonVerticesJson);
        const ring = Array.isArray(polygonData[0])
          ? polygonData[0]
          : polygonData;

        if (ring && ring.length >= 4) {
          // Stable sorting to prevent flipping
          // 1. Sort by Latitude (North to South)
          const sortedByLat = [...ring].sort((a, b) => b.lat - a.lat);

          // 2. Take top 2 (North-most) and sort by Longitude (West to East) -> TL, TR
          const topTwo = [sortedByLat[0], sortedByLat[1]].sort(
            (a, b) => a.lng - b.lng
          );
          const tl = topTwo[0];
          const tr = topTwo[1];

          // 3. Find remaining points
          const remaining = ring.filter(
            (p: any) =>
              (p.lat !== tl.lat || p.lng !== tl.lng) &&
              (p.lat !== tr.lat || p.lng !== tr.lng)
          );

          // 4. Sort remaining by Longitude -> BL (left-most of bottom set)
          const bl =
            remaining[0].lng < remaining[1].lng ? remaining[0] : remaining[1];

          return {
            topleft: L.latLng(tl.lat, tl.lng),
            topright: L.latLng(tr.lat, tr.lng),
            bottomleft: L.latLng(bl.lat, bl.lng),
          };
        }
      } catch (e) {
        console.error("Failed to parse polygonVerticesJson for overlay:", e);
      }
    }

    const topLat = coords.topLeftLat ?? 0;
    const leftLng = coords.topLeftLng ?? 0;
    const bottomLat = coords.bottomRightLat ?? 0;
    const rightLng = coords.bottomRightLng ?? 0;

    return {
      topleft: L.latLng(topLat, leftLng),
      topright: L.latLng(topLat, rightLng),
      bottomleft: L.latLng(bottomLat, leftLng),
    };
  }

  private async initMap() {
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);
    const currentLevelConfig =
      this.initialConfig.levels?.[this.currentFloorLevel];

    this.map = L.map(this.mapReference.nativeElement, {
      center: bounds?.getCenter() || [51.227, 6.773],
      zoom: this.currentZoomLevel,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: this.MAX_ZOOM,
      maxNativeZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.initGeomanControl();

    if (currentLevelConfig?.binaryId && bounds) {
      await this.placeImageOverlay(currentLevelConfig.binaryId);
    }

    // Draw zones after initialization
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        this.drawSavedZones();
        this.centerMapOnBounds();
      }
    }, 100);
  }

  // --- NEW HELPER: Forces update of 3-point positioning ---
  private updateImageOverlayPosition(): void {
    if (!this.imageOverlayLayer) return;
    const cp = this.getValidatedControlPoints();
    if (!cp) return;

    const layerAny = this.imageOverlayLayer as any;
    if (typeof layerAny.reposition === "function") {
      layerAny.reposition(cp.topleft, cp.topright, cp.bottomleft);
    }
  }

  private async placeImageOverlay(binaryId: string): Promise<void> {
    const controlPoints = this.getValidatedControlPoints();
    if (!controlPoints) return;

    try {
      const imgSource = URL.createObjectURL(await this.getImage(binaryId));
      const imageOverlayFactory = (L.imageOverlay as any).rotated;

      if (imageOverlayFactory) {
        this.imageOverlayLayer = imageOverlayFactory(
          imgSource,
          controlPoints.topleft,
          controlPoints.topright,
          controlPoints.bottomleft,
          {
            opacity: 1,
            interactive: true,
            crossOrigin: "anonymous", // Critical for SVG rendering at high zoom
          }
        );

        // --- FIX: Attach Load Listener ---
        this.imageOverlayLayer!.on("load", () => {
          // Force repositioning once the browser knows the image dimensions
          this.updateImageOverlayPosition();
        });

        // --- FIX: Add using requestAnimationFrame ---
        requestAnimationFrame(() => {
          if (this.imageOverlayLayer && this.map) {
            this.imageOverlayLayer.addTo(this.map);
            this.updateImageOverlayPosition();
          }
        });

        // Use the actual layer bounds to fit the map
        // We delay this slightly to ensure the layer is added
        setTimeout(() => {
          if (this.imageOverlayLayer && this.map) {
            const layerBounds = this.imageOverlayLayer.getBounds();
            this.map.fitBounds(layerBounds);
          }
        }, 50);
      } else {
        // Fallback logic
        const bounds = this.getLeafletBounds(this.imageBounds());
        this.imageOverlayLayer = L.imageOverlay(imgSource, bounds!, {
          opacity: 1,
        });
        this.imageOverlayLayer.addTo(this.map!);
      }
    } catch (error) {
      console.error("Failed to place image overlay:", error);
    }
  }

  private drawSavedZones(): void {
    if (!this.map) return;

    if (!this.zoneFeatureGroup) {
      this.zoneFeatureGroup = new L.FeatureGroup();
      this.map.addLayer(this.zoneFeatureGroup);
    }

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
      drawText: false,
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

    mapWithPm.on("pm:edit pm:dragend", (e: any) => {
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

    this.updateZonesState();
    this.currentFloorLevel = newLevelIndex;

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

    if (this.map) {
      await this.redrawMapContents();
    }
  }

  private async redrawMapContents() {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    this.map.eachLayer((layer) => {
      layer.remove();
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: this.MAX_ZOOM,
      maxNativeZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    const currentLevelConfig =
      this.initialConfig?.levels?.[this.currentFloorLevel];
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);

    if (currentLevelConfig?.binaryId && bounds) {
      await this.placeImageOverlay(currentLevelConfig.binaryId);

      this.zoneFeatureGroup = new L.FeatureGroup();
      this.map.addLayer(this.zoneFeatureGroup);
      mapWithPm.pm.setGlobalOptions({
        layerGroup: this.zoneFeatureGroup,
      });

      this.drawSavedZones();

      this.map.invalidateSize(true);
      this.centerMapOnBounds();
      this.map.setZoom(this.currentZoomLevel);
    }
  }

  private updateZonesState(): void {
    if (!this.zoneFeatureGroup) return;

    const currentZones: any[] = [];
    this.zoneFeatureGroup.eachLayer((layer: any) => {
      if (layer.toGeoJSON) {
        const geoJson = layer.toGeoJSON();
        let rotationAngle = 0;

        rotationAngle = layer.options.rotation || 0;

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

    //this.emitConfigChange(null);
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
