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
import { GPSCoordinates } from "../../../models/data-point-indoor-map.model";
import { BsModalRef } from "ngx-bootstrap/modal";

@Component({
  selector: "c8y-gps-component",
  templateUrl: "./gps.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./gps.component.less"],
  encapsulation: ViewEncapsulation.None,
})
export class GPSComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() initialConfig: GPSCoordinates = {
    topLeftLat: 0,
    topLeftLng: 0,
    bottomRightLat: 0,
    bottomRightLng: 0,
  };

  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;
  private featureGroup: L.FeatureGroup | undefined;
  polygonVertices = signal<L.LatLng[][] | null>(null);

  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  public rotationAngle: number = 0;
  public currentZoomLevel: number = 15;
  constructor(private bsModalRef: BsModalRef) {
    effect(() => {
      const bounds = this.imageBounds();
      // Draw the saved boundary when bounds or vertices change, ensuring map is initialized
      if (this.map && (bounds.tl.lat !== 0 || this.polygonVertices())) {
        this.drawSavedBoundary(bounds);
      }
    });
  }

  ngOnInit(): void {
    // Initialize AABB bounds from config
    if (this.initialConfig?.topLeftLat !== 0) {
      this.imageBounds.set({
        tl: {
          lat: this.initialConfig?.topLeftLat ?? 0,
          lng: this.initialConfig?.topLeftLng ?? 0,
        },
        br: {
          lat: this.initialConfig?.bottomRightLat ?? 0,
          lng: this.initialConfig?.bottomRightLng ?? 0,
        },
      });
      this.currentZoomLevel = Math.floor(
        (this.initialConfig as any)?.zoomLevel ?? this.currentZoomLevel
      );
    }

    // Initialize Polygon vertices from config
    if ((this.initialConfig as any)?.polygonVerticesJson) {
      try {
        const savedVertices = JSON.parse(
          (this.initialConfig as any).polygonVerticesJson
        );
        // Convert plain object array back to L.LatLng objects
        const latLngs = savedVertices.map((ring: any[]) =>
          ring.map((v) => L.latLng(v.lat, v.lng))
        );
        this.polygonVertices.set(latLngs);
      } catch (e) {
        console.error("Failed to parse polygon vertices:", e);
        this.polygonVertices.set(null);
      }
    }
    // Initialize rotation angle
    this.rotationAngle = (this.initialConfig as any)?.rotationAngle ?? 0;
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }

    this.initMap();

    if (this.map) {
      // Invalidate size is necessary because the map starts in a modal/hidden element
      setTimeout(() => {
        this.map!.invalidateSize();

        const initialBounds = this.imageBounds();
        if (initialBounds.tl.lat !== 0 || this.polygonVertices()) {
          // Fit bounds to the loaded geometry after map size is correct
          const southWest = L.latLng(
            initialBounds.br.lat,
            initialBounds.tl.lng
          );
          const northEast = L.latLng(
            initialBounds.tl.lat,
            initialBounds.br.lng
          );
          this.map!.fitBounds(L.latLngBounds(southWest, northEast), {
            maxZoom: this.currentZoomLevel,
            animate: false, // Optional: use false to ensure immediate application
          });
        }
        console.log("Map size invalidated for modal rendering.");
      }, 300); // Wait for modal animation to settle
    }
  }

  private initMap(): void {
    // Basic map setup
    this.map = L.map(this.mapReference.nativeElement, {
      center: [52.52, 13.4],
      zoom: this.currentZoomLevel,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.initGeomanControl();
  }

  private drawSavedBoundary(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    if (!this.map || !this.featureGroup) return;

    this.featureGroup.clearLayers();

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
      // Use the actual bounds of the polygon
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
      });
    } else {
      return;
    }

    if (layerToDraw && leafletBounds) {
      this.featureGroup.addLayer(layerToDraw);

      // Apply saved rotation angle (requires Geoman extension)
      if (this.rotationAngle !== 0 && (layerToDraw as any).setRotation) {
        (layerToDraw as any).setRotation(this.rotationAngle);
      }

      // Enable editing and rotation on the drawn layer
      (layerToDraw as any).pm.enable({
        allowSelfIntersection: false,
        rotate: true,
      });

      this.map.fitBounds(leafletBounds, {
        maxZoom: this.currentZoomLevel,
        animate: false,
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

    // NOTE: We only set polygonVertices to null if a simple Rectangle is edited
    // For general edits, the pm:edit/pm:rotateend handlers will update the vertices
  }

  private initGeomanControl(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;
    this.featureGroup = new L.FeatureGroup();
    this.map.addLayer(this.featureGroup);

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
      cutPolygon: false,
      deleteMode: true,
      rotateMode: true,
      allowSelfIntersection: false,

      edit: {
        featureGroup: this.featureGroup,
      },
    });

    mapWithPm.on("pm:create", (e: any) => {
      const type = e.shape;
      const layer = e.layer;

      this.featureGroup?.clearLayers();
      this.featureGroup?.addLayer(layer);

      // 1. Update AABB bounds regardless of shape type
      if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
        this.updateImageBoundsFromLeaflet(layer.getBounds());
      }

      // 2. Update vertices based on shape
      if (
        type === "Polygon" ||
        (type === "Rectangle" && layer.getLatLngs().length > 2)
      ) {
        this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
      } else if (type === "Rectangle") {
        this.polygonVertices.set(null); // Simple rectangle only saves AABB
      }

      this.emitConfigChange(this.imageBounds());
      layer.pm.enable({ allowSelfIntersection: false, rotate: true });
    });

    mapWithPm.on("pm:edit", (e: any) => {
      e.layers.each((layer: any) => {
        if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
          this.updateImageBoundsFromLeaflet(layer.getBounds());
        }
        // Capture updated polygon vertices on edit
        if (layer instanceof L.Polygon) {
          this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
        } else if (layer instanceof L.Rectangle) {
          // If a rectangle is edited/skewed, Geoman may treat it like a polygon internally
          // We capture the new geometry, which is crucial for the rotated overlay display component
          this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
        } else {
          this.polygonVertices.set(null);
        }
        this.emitConfigChange(this.imageBounds());
      });
    });
    mapWithPm.on("pm:rotateend", (e: any) => {
      const layer = e.layer;
      console.log(e.layer, "layer");
      console.log(e.angle, "angle");

      // FIX: Use the official e.angle property provided by Leaflet-Geoman
      const angle = e.angle || 0;

      // Ensure the angle is captured and updated only if it has changed
      if (Math.abs(angle - this.rotationAngle) > 0.001) {
        this.rotationAngle = angle; // Capture the new angle

        // The rotation interaction ensures the LatLngs are updated.
        if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
          this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
        }

        // Update AABB bounds after rotation
        if (layer.getBounds) {
          this.updateImageBoundsFromLeaflet(layer.getBounds());
        }

        this.emitConfigChange(this.imageBounds());
      }
    });

    // Draw existing boundary if any
    const initialBounds = this.imageBounds();
    if (initialBounds.tl.lat !== 0 || this.polygonVertices()) {
      this.drawSavedBoundary(initialBounds);
    }
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

  zoomLevelChanged(): void {
    const zoomValue = Math.floor(this.currentZoomLevel);
    if (this.map && zoomValue !== this.map.getZoom()) {
      this.currentZoomLevel = zoomValue;
      this.map.setZoom(zoomValue);
    }
  }

  ngOnDestroy(): void {
    if (this.map) {
      // Clean up Geoman controls and map layers
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
    const bounds = this.imageBounds();
    this.emitConfigChange({});
    this.bsModalRef.hide();
  }
}
