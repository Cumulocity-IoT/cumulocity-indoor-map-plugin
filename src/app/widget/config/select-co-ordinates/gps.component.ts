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
import { GPSCoordinates } from "../../../models/data-point-indoor-map.model";
import { BsModalRef } from "ngx-bootstrap/modal";
import { InventoryBinaryService } from "@c8y/client";

interface ControlPoints {
  tl: L.LatLng;
  tr: L.LatLng;
  bl: L.LatLng;
}
@Component({
  selector: "c8y-gps-component",
  templateUrl: "./gps.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./gps.component.less"],
  encapsulation: ViewEncapsulation.None,
})
export class GPSComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() initialConfig: any;
  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;
  private featureGroup: L.FeatureGroup | undefined;

  // State Signals
  polygonVertices = signal<L.LatLng[][] | null>(null);
  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  // UI/Config Properties
  public rotationAngle: number = 0;
  public currentZoomLevel: number = 15;
  public showFloorPlan: boolean = false;
  public floorPlanOpacity: number = 0.5;
  private floorPlanLayer: L.ImageOverlay | undefined;
  private readonly DEFAULT_CENTER: [number, number] = [51.227, 6.773];

  // Image Loading Properties
  private imageBlob?: Blob;
  private initialBinaryId?: string;

  constructor(
    private bsModalRef: BsModalRef,
    private binaryService: InventoryBinaryService
  ) {
    effect(() => {
      const bounds = this.imageBounds();
      const vertices = this.polygonVertices();

      // Only run if the map is initialized and we have non-default geometry
      if (this.map && (bounds.tl.lat !== 0 || vertices)) {
        // Redraw boundary on signal change, crucial for initial load
        this.drawSavedBoundary(bounds);
        this.updateImageOverlayPosition(); // Reposition overlay when geometry changes
      }
    });
  }

  ngOnInit(): void {
    // Initialize properties from initialConfig
    const config = this.initialConfig || {};

    // Initialize AABB bounds
    this.imageBounds.set({
      tl: {
        lat: config.topLeftLat ?? 0,
        lng: config.topLeftLng ?? 0,
      },
      br: {
        lat: config.bottomRightLat ?? 0,
        lng: config.bottomRightLng ?? 0,
      },
    });

    // Initialize Polygon vertices
    if (config.polygonVerticesJson) {
      try {
        const savedVertices = JSON.parse(config.polygonVerticesJson);
        const latLngs = savedVertices.map((ring: any[]) =>
          ring.map((v) => L.latLng(v.lat, v.lng))
        );
        this.polygonVertices.set(latLngs);
      } catch (e) {
        console.error("Failed to parse polygon vertices:", e);
      }
    }

    // Initialize numeric properties
    this.rotationAngle = config.rotationAngle ?? 0;
    this.currentZoomLevel = Math.floor(
      config.zoomLevel ?? this.currentZoomLevel
    );
    this.initialBinaryId = config.levels?.[0]?.binaryId;
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }
    // Start async initialization sequence
    this.initializeMapComponent();
  }

  private async initializeMapComponent(): Promise<void> {
    // 1. Load image if binaryId exists and await its completion
    if (this.initialBinaryId) {
      try {
        await this.getImage(this.initialBinaryId);
      } catch (e) {
        console.error("Image loading failed:", e);
      }
    }

    // 2. Initialize Map
    this.initMap();

    if (this.map) {
      // 3. Post-initialization tasks
      setTimeout(() => {
        this.map!.invalidateSize();
        this.centerMapOnBounds();
        this.setActualZoom(); // Syncs zoom after fitBounds runs
      }, 300);
    }
  }

  private async initMap(): Promise<void> {
    const hasSavedCoords =
      this.initialConfig?.topLeftLat && this.initialConfig?.topLeftLat !== 0;
    const initialCenter = hasSavedCoords
      ? this.getCenterCoordinates(this.initialConfig)
      : this.DEFAULT_CENTER;

    this.map = L.map(this.mapReference.nativeElement, {
      center: initialCenter,
      zoom: this.currentZoomLevel,
    });

    // 1. Base Map Layer (e.g., OpenStreetMap)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 23,
      maxNativeZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    // 2. Image Overlay Setup
    if (this.imageBlob) {
      const imageUrl = URL.createObjectURL(this.imageBlob);
      const cp = this.getOverlayControlPoints();
      const rotatedFactory = (L as any).imageOverlay?.rotated;

      if (rotatedFactory) {
        this.floorPlanLayer = rotatedFactory(imageUrl, cp.tl, cp.tr, cp.bl, {
          opacity: this.floorPlanOpacity,
          interactive: true,
        }) as L.ImageOverlay;
      } else {
        // Fallback to non-rotated standard L.imageOverlay
        this.floorPlanLayer = L.imageOverlay(imageUrl, this.getImageBounds(), {
          opacity: this.floorPlanOpacity,
          interactive: true,
        });
      }
      if (this.showFloorPlan) {
        (this.floorPlanLayer as any).addTo(this.map);
      }
    } else {
      console.warn("Floor plan image not available. Skipping image overlay.");
    }

    this.initGeomanControl();
    this.map.on("zoomend", () => {
      this.setActualZoom();
    });

    // Draw existing boundary if any, right after initGeomanControl
    const initialBounds = this.imageBounds();
    if (initialBounds.tl.lat !== 0 || this.polygonVertices()) {
      this.drawSavedBoundary(initialBounds);
    }
  }

  getCenterCoordinates(coordinates: any): [number, number] {
    if (coordinates && coordinates.topLeftLat && coordinates.topLeftLat !== 0) {
      const topLeftLat = coordinates.topLeftLat;
      const bottomRightLat = coordinates.bottomRightLat;
      const topLeftLng = coordinates.topLeftLng;
      const bottomRightLng = coordinates.bottomRightLng;

      const centerLat = (topLeftLat + bottomRightLat) / 2;
      const centerLng = (topLeftLng + bottomRightLng) / 2;

      return [centerLat, centerLng];
    }
    return [this.DEFAULT_CENTER[0] as number, this.DEFAULT_CENTER[1] as number];
  }

  private initGeomanControl(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    if (!this.featureGroup) {
      this.featureGroup = new L.FeatureGroup();
      this.map.addLayer(this.featureGroup);
    }

    mapWithPm.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawRectangle: true,
      drawPolygon: false,
      drawText: false,
      editMode: true,
      dragMode: true,
      rotateMode: true,
      cutPolygon: false,
      deleteMode: true,
    });

    // Global options to maintain "Rectangle" identity and rotation support
    mapWithPm.pm.setGlobalOptions({
      rectangleEditable: true,
      snappable: true,
      // Use the current rotation angle for new rectangles
      //rectangleAngle: this.rotationAngle,
    });

    mapWithPm.on("pm:create", (e: any) => {
      const layer = e.layer;
      this.featureGroup?.clearLayers();
      this.featureGroup?.addLayer(layer);

      // Explicitly tag as Rectangle to prevent vertex skewing
      /*  if (layer.pm) {
        layer.pm._type = "Rectangle";
      } */

      this.enableLayerInteraction(layer);
      this.handleLayerUpdate(layer);
    });

    mapWithPm.on("pm:remove", (e: any) => {
      this.imageBounds.set({ tl: { lat: 0, lng: 0 }, br: { lat: 0, lng: 0 } });
      this.polygonVertices.set(null);
      this.rotationAngle = 0;
      this.updateImageOverlayPosition();
      this.emitConfigChange(this.imageBounds());
    });
  }

  private drawSavedBoundary(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    if (
      !this.map ||
      !this.featureGroup ||
      this.featureGroup.getLayers().length > 0
    )
      return;

    const vertices = this.polygonVertices();
    let layerToDraw: L.Rectangle | undefined;

    if (vertices && vertices[0] && vertices[0].length >= 4) {
      const ring = vertices[0];
      // Create base rectangle from stored bounds
      const rectBounds = L.latLngBounds(ring[0], ring[2]);

      layerToDraw = L.rectangle(rectBounds, {
        color: "#ff0000",
        weight: 1,
        dashArray: "5, 5",
        fillOpacity: 0.1,
      });

      // Restore the tilted coordinates immediately
      layerToDraw.setLatLngs(vertices);

      // Tell Geoman this rectangle is rotated so the Edit handles align
      if ((layerToDraw as any).pm) {
        (layerToDraw as any).pm.setInitAngle(this.rotationAngle);
      }
    }

    if (layerToDraw) {
      this.featureGroup.addLayer(layerToDraw);
      setTimeout(() => {
        this.enableLayerInteraction(layerToDraw);
      }, 100);
    }
  }

  private getOverlayControlPoints(): ControlPoints {
    const vertices = this.polygonVertices();
    const bounds = this.imageBounds();

    if (vertices && vertices[0] && vertices[0].length >= 4) {
      const ring: L.LatLng[] = vertices[0];

      // 1. Sort points by Latitude (descending) to find the "top" two vertices
      const sortedByLat = [...ring].sort((a, b) => b.lat - a.lat);
      const topTwo = [sortedByLat[0], sortedByLat[1]];

      // 2. Of those top two, the one with the smaller Longitude is the Top-Left (TL)
      // The other is the Top-Right (TR)
      const tl = topTwo[0].lng < topTwo[1].lng ? topTwo[0] : topTwo[1];
      const tr = topTwo[0].lng < topTwo[1].lng ? topTwo[1] : topTwo[0];

      // 3. Find the Bottom-Left (BL): The point that is NOT TL or TR and is further "West"
      const remaining = ring.filter((p) => p !== tl && p !== tr);
      const bl =
        remaining[0].lng < remaining[1].lng ? remaining[0] : remaining[1];

      return {
        tl: L.latLng(tl.lat, tl.lng),
        tr: L.latLng(tr.lat, tr.lng),
        bl: L.latLng(bl.lat, bl.lng),
      };
    }

    // Fallback for AABB
    return {
      tl: L.latLng(bounds.tl.lat, bounds.tl.lng),
      tr: L.latLng(bounds.tl.lat, bounds.br.lng),
      bl: L.latLng(bounds.br.lat, bounds.tl.lng),
    };
  }

  private handleLayerUpdate(layer: any) {
    if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
      // 1. Capture the upright bounding box for standard metadata
      this.updateImageBoundsFromLeaflet(layer.getBounds());

      // 2. Capture the actual skewed/rotated vertices
      let latLngs = layer.getLatLngs();

      // Normalize to LatLng[][] so it matches the expected signal type
      const normalizedVertices = Array.isArray(latLngs[0])
        ? latLngs
        : [latLngs];
      this.polygonVertices.set(normalizedVertices as L.LatLng[][]);
    }

    // 3. Force the image overlay to reposition using the new vertices
    this.updateImageOverlayPosition();
    this.emitConfigChange(this.imageBounds());
  }

  private enableLayerInteraction(layer: any) {
    if (layer.pm) {
      layer.pm.enable({
        allowSelfIntersection: false,
        rectangleEditable: true,
      });

      layer.off("pm:edit pm:dragend pm:rotateend"); // Clear old to prevent duplicates

      layer.on("pm:edit pm:dragend", () => {
        this.handleLayerUpdate(layer);
      });

      layer.on("pm:rotateend", (e: any) => {
        this.rotationAngle = e.angle || 0;
        this.handleLayerUpdate(layer);
      });
    }
  }

  private updateImageBoundsFromLeaflet(bounds: L.LatLngBounds): void {
    const tl = bounds.getNorthWest(); // Top-Left (North-West)
    const br = bounds.getSouthEast(); // Bottom-Right (South-East)

    this.imageBounds.set({
      tl: { lat: tl.lat, lng: tl.lng },
      br: { lat: br.lat, lng: br.lng },
    });
  }

  private getImageBounds(): L.LatLngBounds {
    const bounds = this.imageBounds();
    return L.latLngBounds(
      L.latLng(bounds.br.lat, bounds.tl.lng), // SouthWest
      L.latLng(bounds.tl.lat, bounds.br.lng) // NorthEast
    );
  }

  private centerMapOnBounds(): void {
    const bounds = this.getImageBounds();

    // Only attempt to fit bounds if the coordinates are actually set (not 0)
    if (this.map && bounds.isValid() && this.imageBounds().tl.lat !== 0) {
      const center = bounds.getCenter();
      this.map.setView(center, this.currentZoomLevel, {
        animate: false,
      });
    } else if (this.map) {
      // Fallback if no bounds drawn yet: Center on Düsseldorf
      this.map.setView(this.DEFAULT_CENTER, this.currentZoomLevel);
    }
  }

  private async getImage(imageId: string): Promise<Blob> {
    if (this.imageBlob) return this.imageBlob; // Avoid double download

    this.imageBlob = await (
      (await this.binaryService.download(imageId)) as Response
    ).blob();
    return this.imageBlob;
  }

  private updateImageOverlayPosition(): void {
    console.log("Updating image overlay position...");
    if (!this.floorPlanLayer) return;

    const cp = this.getOverlayControlPoints();
    const layerAny = this.floorPlanLayer as any;

    if (typeof layerAny.reposition === "function") {
      // Reposition is the official way to move rotated overlays
      layerAny.reposition(cp.tl, cp.tr, cp.bl);
      return;
    }

    // Fallback: This code is necessary if reposition is not available (non-rotated layer or older plugin)
    if (this.map) {
      try {
        this.map.removeLayer(this.floorPlanLayer);
      } catch {}
      const imageUrl = layerAny._url || layerAny._rawImage?.src;
      if (imageUrl) {
        // Recreate the layer with new bounds
        this.floorPlanLayer = L.imageOverlay(imageUrl, this.getImageBounds(), {
          opacity: this.floorPlanOpacity,
          interactive: true,
        });
        if (this.showFloorPlan) (this.floorPlanLayer as any).addTo(this.map);
      }
    }
  }

  private setActualZoom(): void {
    if (this.map) {
      const actualZoom = this.map.getZoom();
      const roundedActualZoom = Math.floor(actualZoom);

      if (this.currentZoomLevel !== roundedActualZoom) {
        this.currentZoomLevel = roundedActualZoom;
      }
    }
  }

  onToggleFloorPlan(event: any): void {
    this.showFloorPlan = event.target.checked;
    if (!this.map || !this.floorPlanLayer) {
      console.warn("Floor plan layer not initialized or map not ready.");
      return;
    }

    if (this.showFloorPlan) {
      this.floorPlanLayer.addTo(this.map);
    } else {
      this.map.removeLayer(this.floorPlanLayer);
    }
  }

  onOpacityChange(newOpacity: number): void {
    this.floorPlanOpacity = newOpacity;
    if (this.floorPlanLayer && (this.floorPlanLayer as any).setOpacity) {
      (this.floorPlanLayer as L.ImageOverlay).setOpacity(newOpacity);
    }
  }

  private emitConfigChange(payload: any): void {
    const finalConfig = {
      ...this.mapToConfig(this.imageBounds()),
      ...payload,
      rotationAngle: this.rotationAngle,
      zoomLevel: this.currentZoomLevel,
    };
    console.log("Emitting GPS Config Change:", finalConfig);
    this.boundaryChange.emit(finalConfig);
  }

  private mapToConfig(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): any {
    const vertices = this.polygonVertices();
    let polygonVerticesJson: string | undefined = undefined;

    if (vertices) {
      polygonVerticesJson = JSON.stringify(
        vertices.map((ring) => ring.map((v) => ({ lat: v.lat, lng: v.lng })))
      );
    }

    return {
      placementMode: vertices ? "polygon" : "corners",
      topLeftLat: bounds.tl.lat,
      topLeftLng: bounds.tl.lng,
      bottomRightLat: bounds.br.lat,
      bottomRightLng: bounds.br.lng,
      polygonVerticesJson: polygonVerticesJson,
    };
  }

  ngOnDestroy(): void {
    if (this.map) {
      // Ensure Geoman controls are removed before map destruction
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
    // Current boundary state is saved implicitly through the effect/handleLayerUpdate calls
    // during drawing/editing. We just need to trigger the final emit.
    this.emitConfigChange({});
    this.bsModalRef.hide();
  }
}
