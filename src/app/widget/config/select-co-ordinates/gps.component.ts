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
import "leaflet-draw";
import { GPSCoordinates } from "../../../models/data-point-indoor-map.model"; // Assuming correct path
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

  constructor( private bsModalRef: BsModalRef) {
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

    if (this.initialConfig.polygonVerticesJson) {
      try {
        const savedVertices = JSON.parse(
          this.initialConfig.polygonVerticesJson
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

    this.initDrawControl();
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
      leafletBounds = L.latLngBounds(
        L.latLng(bounds.tl.lat, bounds.tl.lng),
        L.latLng(bounds.br.lat, bounds.br.lng)
      );

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

  private emitConfigChange(bounds: {
    tl: { lat: number; lng: number };
    br: { lat: number; lng: number };
  }): void {
    const vertices = this.polygonVertices();
    let polygonVerticesJson: string | undefined = undefined;

    if (vertices) {
      // Serialize L.LatLng objects to a JSON string for storage
      polygonVerticesJson = JSON.stringify(
        vertices.map((ring) => ring.map((v) => ({ lat: v.lat, lng: v.lng })))
      );
    }

    const config = {
      placementMode: vertices ? "polygon" : "corners",
      topLeftLat: bounds.tl.lat,
      topLeftLng: bounds.tl.lng,
      bottomRightLat: bounds.br.lat,
      bottomRightLng: bounds.br.lng,
      polygonVerticesJson: polygonVerticesJson,
    };
    this.boundaryChange.emit(config);
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
        polygon: {
          shapeOptions: {
            color: "#ff0000",
          },
        },
      },
    });

    this.map.addControl(drawControl);

    // Listen for the 'draw:created' event
    this.map.on((L.Draw as any).Event.CREATED, (e: any) => {
      const type = e.layerType;
      const layer = e.layer;
      this.featureGroup?.clearLayers();

      this.featureGroup?.addLayer(layer);

      if (
        layer instanceof L.Rectangle ||
        layer instanceof L.Polygon ||
        layer instanceof L.Circle
      ) {
        this.updateImageBoundsFromLeaflet(layer.getBounds());
      }
      if (type === "polygon") {
        const latLngs = layer.getLatLngs();

        if (latLngs.length > 0 && latLngs[0] instanceof L.LatLng) {
          this.polygonVertices.set([latLngs as L.LatLng[]]);
        } else {
          this.polygonVertices.set(latLngs as L.LatLng[][]);
        }
      } else if (type === "rectangle") {
        this.polygonVertices.set(null);
      }
    });

    this.map.on((L.Draw as any).Event.EDITED, (e: any) => {
      e.layers.each((layer: any) => {
        if (
          layer instanceof L.Rectangle ||
          layer instanceof L.Polygon ||
          layer instanceof L.Circle
        ) {
          const bounds = layer.getBounds();
          this.updateImageBoundsFromLeaflet(bounds);
        }

        if (layer instanceof L.Polygon) {
          const latLngs = layer.getLatLngs();

          if (latLngs.length > 0 && latLngs[0] instanceof L.LatLng) {
            this.polygonVertices.set([latLngs as L.LatLng[]]);
          } else {
            this.polygonVertices.set(latLngs as L.LatLng[][]);
          }
        } else {
          this.polygonVertices.set(null);
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
