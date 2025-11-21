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

// Define the required control point structure for the rotated plugin
interface ControlPoints {
  tl: L.LatLngExpression;
  tr: L.LatLngExpression;
  bl: L.LatLngExpression;
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
    this.map = L.map(this.mapReference.nativeElement, {
      center: [52.52, 13.4],
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

  private initGeomanControl(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    if (!this.featureGroup) {
      this.featureGroup = new L.FeatureGroup();
      this.map.addLayer(this.featureGroup);
    }

    // --- GEOMAN CONTROL SETUP ---
    mapWithPm.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawRectangle: true,
      drawPolygon: false,
      drawText: false,
      editMode: true, // Set to true to make the Edit button available
      dragMode: true,
      cutPolygon: false,
      deleteMode: true,
      rotateMode: true,
      allowSelfIntersection: false,
      edit: {
        featureGroup: this.featureGroup,
      },
    });

    // --- 1. pm:create Handler (User draws a NEW shape) ---
    mapWithPm.on("pm:create", (e: any) => {
      const layer = e.layer;

      // Clear existing layers so we only have one boundary
      this.featureGroup?.clearLayers();
      this.featureGroup?.addLayer(layer);

      // Enable interaction and attach listeners immediately
      this.enableLayerInteraction(layer);

      // Initial update
      this.handleLayerUpdate(layer);
    });

    // --- 2. pm:remove Handler ---
    mapWithPm.on("pm:remove", (e: any) => {
      this.imageBounds.set({ tl: { lat: 0, lng: 0 }, br: { lat: 0, lng: 0 } });
      this.polygonVertices.set(null);
      this.rotationAngle = 0;
      this.updateImageOverlayPosition();
      this.emitConfigChange(this.imageBounds());
    });

    // NOTE: Removed map-level listeners for pm:edit, pm:dragend, pm:rotateend
    // since they are now handled directly on the layer in enableLayerInteraction
    // for reliability.
  }

  // Helper to centralize update logic
  private handleLayerUpdate(layer: any) {
    if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
      // Get the current AABB of the drawn shape (required for imageBounds state)
      this.updateImageBoundsFromLeaflet(layer.getBounds());

      // Always capture the actual vertices (polygon vertices for rotated/skewed shapes)
      this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
    } else {
      this.polygonVertices.set(null);
    }

    this.updateImageOverlayPosition();
    this.emitConfigChange(this.imageBounds());
  }

  // Helper to enable PM on a layer
  private enableLayerInteraction(layer: any) {
    if (layer.pm) {
      // 1. Enable Geoman modes
      layer.pm.enable({
        allowSelfIntersection: false,
      });
      // Ensure drag is also explicitly enabled
      (layer as any).pm.enableLayerDrag();

      // **FIX:** Add listeners directly to the layer for reliable event capturing
      layer.on("pm:dragend", () => {
        console.log("Layer pm:dragend triggered.");
        this.handleLayerUpdate(layer);
      });

      layer.on("pm:edit", () => {
        console.log("Layer pm:edit triggered.");
        this.handleLayerUpdate(layer);
      });

      layer.on("pm:rotateend", (e: any) => {
        console.log("Layer pm:rotateend triggered.");
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

  private getOverlayControlPoints(): ControlPoints {
    const vertices = this.polygonVertices();
    const bounds = this.imageBounds();

    // 1. Use Polygon Vertices (preferred for rotation/skew)
    if (vertices) {
      const ring = vertices[0];

      if (ring.length >= 4) {
        // Geoman points are stored sequentially: TL, TR, BR, BL
        const tl = ring[0];
        const tr = ring[1];
        const bl = ring[3];

        return { tl, tr, bl };
      }
    }

    // 2. Fallback: Axis-aligned bounding box corners (no rotation)
    const tl = L.latLng(bounds.tl.lat, bounds.tl.lng);
    const tr = L.latLng(bounds.tl.lat, bounds.br.lng);
    const bl = L.latLng(bounds.br.lat, bounds.tl.lng); // South-West point

    return { tl, tr, bl };
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
    if (this.map && bounds.isValid()) {
      const center = bounds.getCenter();
      this.map.setView(center, this.currentZoomLevel, {
        animate: false,
      });
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

  private drawSavedBoundary(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    if (!this.map || !this.featureGroup) return;

    // Only draw if the feature group is empty to prevent duplication on signal change
    if (this.featureGroup.getLayers().length > 0) {
      // If a layer already exists, ensure its listeners are correctly attached
      const existingLayer = this.featureGroup.getLayers()[0];
      if (existingLayer) {
        this.enableLayerInteraction(existingLayer);
      }
      return;
    }

    let layerToDraw: L.Layer | undefined;
    let leafletBounds: L.LatLngBounds | undefined;

    const vertices = this.polygonVertices();
    if (vertices) {
      layerToDraw = L.polygon(vertices, {
        color: "#ff0000",
        weight: 1,
        dashArray: "5, 5",
        fillOpacity: 0.1,
      });
      // Use the actual bounds of the polygon (for centering, etc.)
      leafletBounds = (layerToDraw as L.Polygon).getBounds();
    } else if (bounds.tl.lat !== 0) {
      // Use standard rectangle if only AABB is saved
      const southWest = L.latLng(bounds.br.lat, bounds.tl.lng);
      const northEast = L.latLng(bounds.tl.lat, bounds.br.lng);
      leafletBounds = L.latLngBounds(southWest, northEast);

      layerToDraw = L.rectangle(leafletBounds, {
        color: "#ff0000",
        weight: 1,
        dashArray: "5, 5",
        fillOpacity: 0.1,
      });
    } else {
      return;
    }

    if (layerToDraw) {
      this.featureGroup.addLayer(layerToDraw);

      if (this.rotationAngle !== 0 && (layerToDraw as any).setRotation) {
        (layerToDraw as any).setRotation(this.rotationAngle);
      }

      // **FIX: Use setTimeout to ensure the layer is fully added and rendered**
      // **before enabling Geoman interaction and attaching layer-specific listeners.**
      setTimeout(() => {
        this.enableLayerInteraction(layerToDraw);
      }, 50);
    }
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
