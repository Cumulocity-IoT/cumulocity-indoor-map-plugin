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
    rotationAngle: 0,
    building: {
      id: "",
      name: "",
      coordinates: {
        topLeftLat: 0,
        topLeftLng: 0,
        bottomRightLat: 0,
        bottomRightLng: 0,
      },
      location: "",
      assetType: "",
      levels: [],
      type: "c8y_Building",
    },
  };
  @Output() boundaryChange = new EventEmitter<GPSCoordinates>();

  @ViewChild("boundaryMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private map: L.Map | undefined;

  private zoneFeatureGroup: L.FeatureGroup | undefined;
  private imageOverlayLayer: L.ImageOverlay | undefined;

  polygonVertices = signal<L.LatLng[][] | null>(null);
  zones = signal<any[]>([]); // Current floor's zones
  imageBounds = signal({
    tl: { lat: 0, lng: 0 },
    br: { lat: 0, lng: 0 },
  });
  public currentFloorLevel: number = 0;

  // Stores ALL zones data keyed by level index
  private allZonesByLevel: { [levelId: string]: string } = {};

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
    // 1. Set imageBounds from initial config
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

    // 2. Initialize allZonesByLevel cache from input
    const inputAllZones = this.initialConfig.allZonesByLevel as any;
    if (inputAllZones) {
      // Use Object.assign to copy properties safely, assuming key:string, value:string
      Object.assign(this.allZonesByLevel, inputAllZones);
    }

    // 3. Load current floor's zones into the 'zones' signal
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

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }
    this.initMap();
    if (this.map) {
      setTimeout(() => {
        this.map!.invalidateSize(true);
        this.centerMapOnBounds();

        this.drawSavedZones();

        console.log("Map initialized and size invalidated.");
      }, 300);
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

  private initMap(): void {
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);
    const currentLevelConfig =
      this.initialConfig.building?.levels?.[this.currentFloorLevel];

    this.map = L.map(this.mapReference.nativeElement, {
      center: bounds?.getCenter() || [52.52, 13.4],
      zoom: 15,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    // Image Overlay Placement
    if (currentLevelConfig?.blob && bounds) {
      // Use image string or blob URL if available
      const imgSource =
        currentLevelConfig.blob instanceof Blob
          ? URL.createObjectURL(currentLevelConfig.blob)
          : currentLevelConfig.image || "";

      this.imageOverlayLayer = this.createRotatedImageOverlay(
        imgSource,
        bounds,
        this.initialConfig.rotationAngle || 0,
        { opacity: 0.8, interactive: true }
      );
      this.imageOverlayLayer.addTo(this.map);
      this.map.fitBounds(bounds);
    }

    this.initGeomanControl();
  }

  private drawSavedZones(): void {
    if (!this.map || !this.zoneFeatureGroup) return;

    this.zoneFeatureGroup.clearLayers();

    const currentZones = this.zones();

    if (currentZones.length === 0) return;

    currentZones.forEach((zone: any) => {
      if (!zone.geometry) return;

      const layer = L.GeoJSON.geometryToLayer(zone.geometry);

      if (layer) {
        if (layer instanceof L.Path) {
          (layer as any).setStyle({
            color: "#0000FF",
            weight: 2,
            fillOpacity: 0.4,
          });
        }

        this.zoneFeatureGroup!.addLayer(layer);

        (layer as any).pm.enable({
          allowSelfIntersection: false,
          rotate: true,
        });

        if (zone.rotation && (layer as any).setRotation) {
          (layer as any).setRotation(zone.rotation);
        }
      }
    });

    if (this.zoneFeatureGroup.getLayers().length > 0) {
      this.map!.fitBounds(this.zoneFeatureGroup.getBounds());
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
      rotateMode: true, // Rotation enabled globally
      allowSelfIntersection: false,

      edit: {
        featureGroup: this.zoneFeatureGroup,
      },
    });

    // 1. Initial Load is now handled by ngOnInit and the call to drawSavedZones in ngAfterViewInit

    // 2. pm:create (Handle New Zones)
    mapWithPm.on("pm:create", (e: any) => {
      const layer = e.layer;
      this.zoneFeatureGroup?.addLayer(layer);
      layer.pm.enable({ allowSelfIntersection: false, rotate: true });
      this.updateZonesState();
    });

    // 3. pm:edit (Handle drag/resize/vertex edit)
    mapWithPm.on("pm:edit", (e: any) => {
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
  }

  public onFloorLevelChanged(newLevelIndex: number): void {
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
      this.redrawMapContents();
    }
  }

  private redrawMapContents(): void {
    if (!this.map) return;
    const mapWithPm = this.map as any;
    // 1. Clear existing layers (zones and old image overlay)
    this.map.eachLayer((layer) => {
      if (layer !== this.map?.options.layers?.[0]) {
        layer.remove();
      }
    });

    // 2. Load the current floor's configuration data
    const currentLevelConfig =
      this.initialConfig?.building?.levels?.[this.currentFloorLevel];
    const initialBounds = this.imageBounds();
    const bounds = this.getLeafletBounds(initialBounds);

    // 3. Redraw Image Overlay
    if (currentLevelConfig?.blob && bounds) {
      const imgSource =
        currentLevelConfig.blob instanceof Blob
          ? URL.createObjectURL(currentLevelConfig.blob)
          : currentLevelConfig.image || "";
      const rotationAngle = this.initialConfig.rotationAngle || 0;

      this.imageOverlayLayer = this.createRotatedImageOverlay(
        imgSource,
        bounds,
        rotationAngle,
        { opacity: 0.8, interactive: true }
      );
      this.imageOverlayLayer.addTo(this.map);
    }

    // 4. Re-enable Geoman FeatureGroup
    this.zoneFeatureGroup = new L.FeatureGroup();
    this.map.addLayer(this.zoneFeatureGroup);
    if (mapWithPm.pm.controls) {
      // Find the edit control instance (this assumes you used the default toolbar structure)
      const editControl = mapWithPm.pm
        .getControls()
        .find((c: any) => c.name === "edit");

      if (editControl) {
        editControl.setOptions({
          edit: { featureGroup: this.zoneFeatureGroup },
        });
      }
    }
    // 5. Redraw Zones
    this.drawSavedZones();

    // 6. Final refresh
    this.map.invalidateSize(true);
    this.centerMapOnBounds();
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

    // Save stringified data back to the dictionary for the current level
    const currentLevelIndex = this.currentFloorLevel.toString();
    this.allZonesByLevel[currentLevelIndex] = JSON.stringify(currentZones);

    this.emitConfigChange(null);
  }

  // ... (mapToConfig remains the same)

  private emitConfigChange(payload: any): void {
    const currentBounds = this.imageBounds();
    const currentZones = this.zones();

    const finalConfig = {
      placementMode:
        this.allZonesByLevel["0"] || this.allZonesByLevel["1"]
          ? "zones"
          : "corners",
      topLeftLat: currentBounds.tl.lat,
      topLeftLng: currentBounds.tl.lng,
      bottomRightLat: currentBounds.br.lat,
      bottomRightLng: currentBounds.br.lng,

      allZonesByLevel: this.allZonesByLevel,
      rotationAngle: this.initialConfig.rotationAngle || 0,
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
