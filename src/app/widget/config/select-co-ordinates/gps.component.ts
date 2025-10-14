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
import { GPSCoordinates } from "../../data-point-indoor-map.model";
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
  // NOTE: Assuming your initialConfig model now includes a polygonVerticesJson property
  @Output() configChange = new EventEmitter<any>();

  private map: L.Map | undefined;
  private featureGroup: L.FeatureGroup | undefined;
  polygonVertices = signal<L.LatLng[][] | null>(null);

  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  constructor(private bsModalRef: BsModalRef) {
    effect(() => {
      const bounds = this.imageBounds();
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
        console.log("Map size invalidated for modal rendering.");
      }, 300); // 300ms delay is usually safe for modals
    }
  }

  private initMap(): void {
    // 🌟 FIX 1: Initialize map using the ElementRef's native element, not a hardcoded ID
    this.map = L.map(this.mapReference.nativeElement, {
      center: [52.52, 13.4],
      zoom: 15,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
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
      leafletBounds = (layerToDraw as L.Polygon).getBounds();
    } else if (bounds.tl.lat !== 0) {
      // NOTE: L.rectangle expects SW and NE, which corresponds to TL/BR for the bounding box.
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
      this.map.fitBounds(leafletBounds);
    }
  }

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
    this.featureGroup = new L.FeatureGroup();
    this.map.addLayer(this.featureGroup);
    /*  if (typeof L.PM !== "undefined" && !mapWithPm.pm) {
      // This is a cleaner way to force the initialization hook without MapManager:
      mapWithPm.pm.enable(null);
    } */

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
      rotateMode: false, // Enable rotation control
      allowSelfIntersection: false,

      // Target the layers in the featureGroup for editing
      edit: {
        featureGroup: this.featureGroup,
      },
    });

    mapWithPm.on("pm:create", (e: any) => {
      const type = e.shape;
      const layer = e.layer;

      this.featureGroup?.clearLayers();
      this.featureGroup?.addLayer(layer);

      if (layer instanceof L.Rectangle || layer instanceof L.Polygon) {
        this.updateImageBoundsFromLeaflet(layer.getBounds());
      }

      if (type === "Polygon") {
        this.polygonVertices.set(layer.getLatLngs() as L.LatLng[][]);
      } else if (type === "Rectangle") {
        this.polygonVertices.set(null);
      }

      layer.pm.enable({ allowSelfIntersection: false });
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
      rotationAngle:
        payload.rotationAngle || this.initialConfig.rotationAngle || 0,
    };
    this.configChange.emit(finalConfig);
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
    this.emitConfigChange(bounds);
    this.bsModalRef.hide();
  }
}
