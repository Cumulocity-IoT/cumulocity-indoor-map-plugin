import {
  ChangeDetectionStrategy,
  Component,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  effect,
  // ... other imports
  Input, // ADDED: Import Input
  OnInit, // ADDED: Import OnInit
  ViewEncapsulation,
  EventEmitter,
  Output,
} from "@angular/core";

import * as L from "leaflet";
import "leaflet-draw";
import { GPSCoordinates } from "../../data-point-indoor-map.model";

@Component({
  selector: "c8y-gps-component",
  templateUrl: "./gps.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./gps.component.less"],
  encapsulation: ViewEncapsulation.None,
})
// ADDED: OnInit to the implemented interfaces
export class GPSComponent implements OnInit, AfterViewInit, OnDestroy {
  // ADDED: Input property to receive initial configuration (from the parent component's 'config.coordinates')
  @Input() initialConfig: GPSCoordinates = {
    topLeftLat: 0,
    topLeftLng: 0,
    bottomRightLat: 0,
    bottomRightLng: 0,
  };
  @Output() configChange = new EventEmitter<any>();

  private map: L.Map | undefined;
  private featureGroup: L.FeatureGroup | undefined;

  // ... (other signals remain the same)

  // Initialized the imageBounds signal here, will update it in ngOnInit
  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  // ... (canPlaceOverlay and constructor logic remains the same)
  constructor() {
    // ... (existing effects for rotation and emitConfigChange)

    // ADDED: Effect to draw the saved boundary when map is ready and bounds are non-zero
    effect(() => {
      const bounds = this.imageBounds();
      // Check if map is ready and coordinates are valid (non-zero)
      if (this.map && bounds.tl.lat !== 0 && bounds.br.lat !== 0) {
        this.drawSavedBoundary(bounds);
      }
    });
  }

  // ADDED: OnInit to populate imageBounds from Input
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
    // We can also infer the initial drawing type here if the configuration stored it (e.g., this.initialConfig.placementMode === 'polygon')
    // For now, we assume it's bounds defined by corners (rectangle/bounding box of polygon).
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }

    this.initMap();
  }
  private initMap(): void {
    // Basic map setup
    this.map = L.map("gps-map", {
      center: [52.52, 13.4], // Example coordinates (Berlin)
      zoom: 13,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.initDrawControl();
  }

  // ADDED: Function to draw the saved shape
  private drawSavedBoundary(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    if (!this.map || !this.featureGroup) return;

    this.featureGroup.clearLayers(); // Ensure map is clean before drawing saved shape

    // Create Leaflet bounds object
    const leafletBounds = L.latLngBounds(
      L.latLng(bounds.tl.lat, bounds.tl.lng),
      L.latLng(bounds.br.lat, bounds.br.lng)
    );

    const savedRectangle = L.rectangle(leafletBounds, {
      color: "#ff0000",
      weight: 1,
      dashArray: "5, 5", // Use a dashed line to indicate it's the saved boundary
    });

    this.featureGroup.addLayer(savedRectangle);

    // Zoom the map to fit the boundary
    this.map.fitBounds(leafletBounds);
  }

  private updateImageBoundsFromLeaflet(bounds: L.LatLngBounds): void {
    const tl = bounds.getNorthWest(); // Top-Left (North-West)
    const br = bounds.getSouthEast(); // Bottom-Right (South-East)

    this.imageBounds.set({
      tl: { lat: tl.lat, lng: tl.lng },
      br: { lat: br.lat, lng: br.lng },
    });
  }

  // Emit configuration change to parent
  private emitConfigChange(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    const config = {
      placementMode: "corners",
      topLeftLat: bounds.tl.lat,
      topLeftLng: bounds.tl.lng,
      bottomRightLat: bounds.br.lat,
      bottomRightLng: bounds.br.lng,
    };
    this.configChange.emit(config);
  }

  private initDrawControl(): void {
    if (!this.map) return;

    this.featureGroup = new L.FeatureGroup();
    this.map.addLayer(this.featureGroup);

    const drawControl = new (L.Control as any).Draw({
      edit: {
        featureGroup: this.featureGroup,
      },
      draw: {
        polyline: false,
        marker: false,
        circlemarker: false,
        circle: false,

        rectangle: {
          shapeOptions: {
            color: "#ff0000",
          },
        },
        polygon: true,
      },
    });

    this.map.addControl(drawControl);

    // Listen for the 'draw:created' event
    this.map.on((L.Draw as any).Event.CREATED, (e: any) => {
      const type = e.layerType;
      const layer = e.layer;
      this.featureGroup?.clearLayers();

      this.featureGroup?.addLayer(layer);

      if (type === "rectangle" || type === "polygon") {
        const bounds = layer.getBounds();
        this.updateImageBoundsFromLeaflet(bounds);
      }
    });

    // Listen for the 'draw:edited' event
    this.map.on((L.Draw as any).Event.EDITED, (e: any) => {
      e.layers.each((layer: any) => {
        if (layer.getBounds) {
          const bounds = layer.getBounds();
          this.updateImageBoundsFromLeaflet(bounds);
        }
      });
    });
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }
  }
}
