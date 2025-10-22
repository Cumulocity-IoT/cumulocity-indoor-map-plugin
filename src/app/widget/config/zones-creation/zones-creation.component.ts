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
  MapConfiguration,
} from "../../data-point-indoor-map.model";
import { BsModalRef } from "ngx-bootstrap/modal";
import { DataPointIndoorMapService } from "../../data-point-indoor-map.service";

@Component({
  selector: "c8y-zone-creation-component",
  templateUrl: "./zones-creation.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ["./zones-creation.component.less"],
  encapsulation: ViewEncapsulation.None,
})
export class ZonesComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() initialConfig: GPSConfigWithImage = {
    topLeftLat: 0,
    topLeftLng: 0,
    bottomRightLat: 0,
    bottomRightLng: 0,
    mapConfigId: "",
    rotationAngle: 0,
  };
  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;

  private zoneFeatureGroup: L.FeatureGroup | undefined;
  private imageOverlayLayer: L.ImageOverlay | undefined;
  building?: MapConfiguration;
  polygonVertices = signal<L.LatLng[][] | null>(null);
  zones = signal<any[]>([]);
  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });

  constructor(
    private bsModalRef: BsModalRef // private mapService: DataPointIndoorMapService
  ) {
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

  async ngOnInit() {
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
    const zonesJsonString = (this.initialConfig as any).zones.zonesJson;

    if (
      zonesJsonString &&
      typeof zonesJsonString === "string" &&
      zonesJsonString.length > 0
    ) {
      try {
        // Use the correct property name: zonesJson
        const savedZones = JSON.parse(zonesJsonString);
        this.zones.set(savedZones);
      } catch (e) {
        // Keep the console error, but ensure the state is reset
        console.error("Failed to parse zones JSON:", e);
      }
    }

    // this.building = await this.loadMapConfiguration();
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }
    this.initMap();
    if (this.map) {
      setTimeout(() => {
        this.map!.invalidateSize();
        this.centerMapOnBounds();
        console.log("Map size invalidated for modal rendering.");
      }, 300);
    }
  }
  /* private async loadMapConfiguration() {
    return this.mapService.loadMapConfigurationWithImages(
      this.initialConfig.mapConfigId ?? ""
    );
  } */

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
    // const currentMapConfigurationLevel = this.building?.levels?.[0];

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
    if (this.initialConfig.mapConfigId && bounds) {
      //  const imgBlobURL = URL.createObjectURL(currentMapConfigurationLevel.blob);
      this.imageOverlayLayer = this.createRotatedImageOverlay(
        this.initialConfig.mapConfigId || "",
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

    this.zoneFeatureGroup.clearLayers();

    let layerToDraw: L.Layer | undefined;

    const vertices = this.polygonVertices();
    if (vertices) {
      layerToDraw = L.polygon(vertices, {
        color: "#0000FF",
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
      (layerToDraw as any).pm.enable({
        allowSelfIntersection: false,
        rotate: true,
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

    this.polygonVertices.set(null);
  }

  private drawSavedZones(): void {
    if (!this.map || !this.zoneFeatureGroup || this.zones().length === 0)
      return;

    console.log(this.zones);

    this.zones().forEach((zone: any) => {
      if (!zone.geometry) return;

      // Use L.GeoJSON to convert the geometry back to a Leaflet layer
      const layer = L.GeoJSON.geometryToLayer(zone.geometry);

      if (layer) {
        // 🚩 FIX: Use a Type Guard to safely check for L.Path methods 🚩
        if (layer instanceof L.Path) {
          // Add styling and rotation options
          (layer as any).setStyle({
            // Cast layer to 'any' or L.Path to access setStyle
            color: "#0000FF",
            weight: 2,
            fillOpacity: 0.4,
          });
        }

        this.zoneFeatureGroup!.addLayer(layer);

        // Enable Geoman editing and rotation on the loaded layer
        // Note: This often requires the layer to be cast to 'any' for Geoman methods as well.
        (layer as any).pm.enable({
          allowSelfIntersection: false,
          rotate: true,
        });

        // If rotation angle was saved, apply it.
        if (zone.rotation && (layer as any).setRotation) {
          (layer as any).setRotation(zone.rotation);
        }
      }
    });

    // Optional: Center map on all zones if they were loaded
    if (this.zoneFeatureGroup.getLayers().length > 0) {
      this.map!.fitBounds(this.zoneFeatureGroup.getBounds());
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

      editMode: true,
      dragMode: true,
      cutPolygon: false,
      deleteMode: true,
      rotateMode: false,
      allowSelfIntersection: false,

      edit: {
        featureGroup: this.zoneFeatureGroup,
      },
    });

    // 1. Load Saved Zones
    if ((this.initialConfig as any).zonesJson) {
      try {
        const savedZones = JSON.parse((this.initialConfig as any).zonesJson);
        savedZones.forEach((zone: any) => {
          const layer = L.GeoJSON.geometryToLayer(zone.geometry, {
            // You might need to adjust options here
          });

          // If a rotation angle was saved, apply it back to the layer (requires Geoman)
          if (zone.rotation) {
            (layer as any).setRotation(zone.rotation);
          }

          this.zoneFeatureGroup!.addLayer(layer);
          // Also enable editing on the loaded layer
          (layer as any).pm.enable({
            allowSelfIntersection: false,
            rotate: true,
          });
        });
        this.zones.set(savedZones);
      } catch (e) {
        console.error("Failed to load saved zones:", e);
      }
    }

    // 2. pm:create (Handle New Zones)
    mapWithPm.on("pm:create", (e: any) => {
      const layer = e.layer;

      // Add layer to the feature group
      this.zoneFeatureGroup?.addLayer(layer);

      // Re-enable editing/rotation on the new layer
      layer.pm.enable({ allowSelfIntersection: false, rotate: true });

      // Update the central zones array
      this.updateZonesState();
    });

    // 3. pm:edit (Handle drag/resize/vertex edit)
    mapWithPm.on("pm:edit", (e: any) => {
      // No need to loop over layers; the whole group is being managed
      this.updateZonesState();
    });

    // 4. pm:rotateend (Handle Rotation)
    mapWithPm.on("pm:rotateend", (e: any) => {
      this.updateZonesState();
    });

    // 5. pm:remove (Handle Deletion)
    mapWithPm.on("pm:remove", (e: any) => {
      this.updateZonesState();
    });
    this.drawSavedZones();
  }

  private updateZonesState(): void {
    if (!this.zoneFeatureGroup) return;

    const currentZones: any[] = [];
    this.zoneFeatureGroup.eachLayer((layer: any) => {
      if (layer.toGeoJSON) {
        const geoJson = layer.toGeoJSON();
        const rotationAngle = layer.options.rotation || layer._pm_rotation || 0;

        currentZones.push({
          geometry: geoJson.geometry,
          rotation: rotationAngle,
        });
      }
    });

    this.zones.set(currentZones);
    this.emitConfigChange(null);
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
    const currentBounds = this.imageBounds();
    const currentZones = this.zones();

    // Use currentBounds for topLeft/bottomRight (the overall map view)
    const finalConfig = {
      placementMode: currentZones.length > 0 ? "zones" : "corners",
      topLeftLat: currentBounds.tl.lat,
      topLeftLng: currentBounds.tl.lng,
      bottomRightLat: currentBounds.br.lat,
      bottomRightLng: currentBounds.br.lng,

      // Store all drawn zones as a JSON string
      zonesJson: JSON.stringify(currentZones),

      // Keep the rotation angle for the ImageOverlay separate from the zone data
      rotationAngle: this.initialConfig.rotationAngle || 0,
    };
    this.boundaryChange.emit(finalConfig as GPSCoordinates);
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
    this.updateZonesState(); // Ensure the final state is saved
    this.emitConfigChange(null);
    this.bsModalRef.hide();
  }
}
