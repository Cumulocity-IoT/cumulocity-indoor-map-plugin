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
import {
  GPSConfigWithImage,
  GPSCoordinates,
} from "../../data-point-indoor-map.model";
import { BsModalRef } from "ngx-bootstrap/modal";

// ⚠️ Assuming the Image URL and Rotation Angle are passed to the component

@Component({
  selector: "c8y-zone-creation-component",
  templateUrl: "./zones-creation.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./zones-creation.component.less"],
  encapsulation: ViewEncapsulation.None,
})
export class ZonesComponent implements OnInit, AfterViewInit, OnDestroy {
  // Update Input type to include image data
  @Input() initialConfig: GPSConfigWithImage = {
    topLeftLat: 0,
    topLeftLng: 0,
    bottomRightLat: 0,
    bottomRightLng: 0,
    imageUrl: undefined, // New property for image URL
    rotationAngle: 0, // New property for rotation angle
  };
  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;
  // Renamed from featureGroup to zoneFeatureGroup to distinguish from image bounds layer
  private zoneFeatureGroup: L.FeatureGroup | undefined;
  private imageOverlayLayer: L.ImageOverlay | undefined; // Reference for the image overlay

  polygonVertices = signal<L.LatLng[][] | null>(null);

  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  constructor(private bsModalRef: BsModalRef) {
    effect(() => {
      const bounds = this.imageBounds();
      // Ensure the saved boundary is drawn/updated
      if (this.map && (bounds.tl.lat !== 0 || this.polygonVertices())) {
        this.drawSavedBoundary(bounds);
      }
    });
    effect(
      () => {
        const bounds = this.imageBounds();
        this.emitConfigChange(bounds);
      },
      { allowSignalWrites: true }
    );
  }

  // --- Omitted ngOnInit for brevity (no changes needed there) ---
  ngOnInit(): void {
    if (this.initialConfig.topLeftLat !== 0) {
      this.imageBounds.set({
        tl: {
          lat: this.initialConfig.topLeftLat ?? 0,
          lng: this.initialConfig.topLeftLng ?? 0,
        },
        br: {
          lat: this.initialConfig.bottomRightLat ?? 0,
          lng: this.initialConfig.bottomRightLng ?? 0,
        },
      });
    }

    if ((this.initialConfig as any).polygonVerticesJson) {
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
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }

    this.initMap();

    // 🌟 FIX 2: Force redraw after modal transition to correct container size
    if (this.map) {
      setTimeout(() => {
        this.map!.invalidateSize();
        // 🌟 Center the map on the boundary after sizing is complete 🌟
        this.centerMapOnBounds();
        console.log("Map size invalidated for modal rendering.");
      }, 300); // 300ms delay is usually safe for modals
    }
  }

  // --- Rotated Image Overlay Helper (Imported from DataPointIndoorMapComponent) ---
  private createRotatedImageOverlay(
    url: string,
    bounds: L.LatLngBoundsExpression,
    rotationAngle: number,
    options?: L.ImageOverlayOptions
  ): L.ImageOverlay {
    // Alias the base Leaflet classes available in 'L'
    const L_ImageOverlay = L.ImageOverlay;

    const RotatedOverlay = (L_ImageOverlay as any).extend({
      initialize: function (
        url: string,
        bounds: L.LatLngBoundsExpression,
        options: any
      ) {
        options = options || {};
        options.rotation = rotationAngle;

        (L_ImageOverlay.prototype as any).initialize.call(
          this,
          url,
          bounds,
          options
        );
      },
      _updateImage: function () {
        (L_ImageOverlay.prototype as any)._updateImage.call(this);

        if (this._image && this.options.rotation !== 0) {
          const angle = this.options.rotation;
          const existingTransform = this._image.style.transform || "";

          this._image.style.transformOrigin = "center";
          this._image.style.transform = `${existingTransform} rotate(${angle}deg)`;
        }
      },
    });

    return new RotatedOverlay(url, bounds, options) as L.ImageOverlay;
  }
  // ----------------------------------------------------------------------------------

  private initMap(): void {
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);

    // 🌟 1. Map Initialization 🌟
    this.map = L.map(this.mapReference.nativeElement, {
      center: bounds?.getCenter() || [52.52, 13.4],
      zoom: 15,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    // 🌟 2. Image Overlay Placement 🌟
    if (this.initialConfig.imageUrl && bounds) {
      this.imageOverlayLayer = this.createRotatedImageOverlay(
        this.initialConfig.imageUrl,
        bounds,
        this.initialConfig.rotationAngle || 0,
        { opacity: 0.8, interactive: true }
      );
      this.imageOverlayLayer.addTo(this.map);
      this.map.fitBounds(bounds);
    }

    this.initGeomanControl();
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

  private drawSavedBoundary(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    if (!this.map || !this.zoneFeatureGroup) return;

    // Renamed from featureGroup to zoneFeatureGroup
    this.zoneFeatureGroup.clearLayers();

    let layerToDraw: L.Layer | undefined;

    // NOTE: This logic should ideally only draw the currently edited zone/polygon,
    // not all zones, but we reuse the single saved layer logic.

    const vertices = this.polygonVertices();
    if (vertices) {
      layerToDraw = L.polygon(vertices, {
        color: "#0000FF", // Changed color for drawn zones
        weight: 2,
        fillOpacity: 0.4,
      });
    } else if (bounds.tl.lat !== 0) {
      const leafletBounds = this.getLeafletBounds(bounds);
      layerToDraw = L.rectangle(leafletBounds!, {
        color: "#0000FF",
        weight: 2,
        fillOpacity: 0.4,
      });
    } else {
      return;
    }

    if (layerToDraw) {
      this.zoneFeatureGroup.addLayer(layerToDraw);
      // Ensure the newly drawn layer is enabled for editing immediately
      (layerToDraw as any).pm.enable({
        allowSelfIntersection: false,
        rotate: true,
      });
    }
  }

  // --- Omitted updateImageBoundsFromLeaflet for brevity (no changes needed) ---
  private updateImageBoundsFromLeaflet(bounds: L.LatLngBounds): void {
    const tl = bounds.getNorthWest(); // Top-Left (North-West)
    const br = bounds.getSouthEast(); // Bottom-Right (South-East)

    this.imageBounds.set({
      tl: { lat: tl.lat, lng: tl.lng },
      br: { lat: br.lat, lng: br.lng },
    });

    this.polygonVertices.set(null);
  }

  private initGeomanControl(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;

    // Initialize the FeatureGroup for all drawable zones/shapes
    this.zoneFeatureGroup = new L.FeatureGroup();
    this.map.addLayer(this.zoneFeatureGroup);

    // 🚩 Enable Geoman Controls for Drawing Zones 🚩
    mapWithPm.pm.addControls({
      position: "topleft",
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,

      // Allow drawing the boundary/zone shape
      drawRectangle: true,
      drawPolygon: true,

      editMode: true,
      dragMode: true,
      cutPolygon: true, // Allow cutting zones
      deleteMode: true,
      rotateMode: true, // Enable rotation control in the toolbar
      allowSelfIntersection: false,

      // Target the zones featureGroup for editing
      edit: {
        featureGroup: this.zoneFeatureGroup,
      },
    });

    // --- Geoman Event Handlers ---
    mapWithPm.on("pm:create", (e: any) => {
      const type = e.shape;
      const layer = e.layer;

      this.zoneFeatureGroup?.clearLayers(); // Assuming only ONE zone can be drawn for now
      this.zoneFeatureGroup?.addLayer(layer);

      // Re-enable editing/rotation on the new layer
      layer.pm.enable({ allowSelfIntersection: false, rotate: true });

      if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
        this.updateImageBoundsFromLeaflet(layer.getBounds());
      }
      if (type === "Polygon") {
        this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
      } else if (type === "Rectangle") {
        this.polygonVertices.set(null);
      }
    });

    mapWithPm.on("pm:edit", (e: any) => {
      e.layers.each((layer: any) => {
        if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
          this.updateImageBoundsFromLeaflet(layer.getBounds());
        }
        if (layer instanceof L.Polygon) {
          this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
        } else {
          this.polygonVertices.set(null);
        }
      });
    });

    // 🚩 Capture Rotation Angle 🚩
    mapWithPm.on("pm:rotateend", (e: any) => {
      const layer = e.layer;
      let rotationAngle = 0;

      // Access internal Geoman property (the final workaround)
      rotationAngle =
        layer.options.rotation || (layer as any)._pm_rotation || 0;

      if (rotationAngle !== 0) {
        console.log("Drawn Zone Rotated. Angle:", rotationAngle);
      }

      // Update config with the new bounds and rotation angle
      const currentBounds = this.imageBounds();
      this.emitConfigChange({ rotationAngle: rotationAngle });

      // Re-emit the entire config to ensure the rotated bounding box is also captured
      if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
        this.updateImageBoundsFromLeaflet(layer.getBounds());
      }
    });

    // Draw existing boundary if any
    const initialBounds = this.imageBounds();
    if (initialBounds.tl.lat !== 0 || this.polygonVertices()) {
      this.drawSavedBoundary(initialBounds);
    }
  }

  // --- Omitted mapToConfig for brevity (no changes needed) ---
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
      // Ensure rotationAngle is explicitly set, prioritizing the new payload
      rotationAngle:
        payload.rotationAngle ?? this.initialConfig.rotationAngle ?? 0,
    };
    this.boundaryChange.emit(finalConfig);
  }

  ngOnDestroy(): void {
    if (this.map) {
      (this.map as any).pm.removeControls();
      this.map.off();
      this.map.remove();
    }
  }

  onCancel(): void {
    //this.boundaryChange.emit();
    this.bsModalRef.hide();
  }

  onSave(): void {
    const bounds = this.imageBounds();
    this.emitConfigChange(bounds); // Emits the final captured coords and rotation
    this.bsModalRef.hide();
  }
}
