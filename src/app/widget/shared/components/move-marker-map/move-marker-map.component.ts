import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnInit,
  ViewChild,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
  Output,
  EventEmitter,
} from "@angular/core";
import { CoreModule } from "@c8y/ngx-components";
import type * as L from "leaflet";
import { MarkerManagedObject } from "../../../../models/data-point-indoor-map.model";

// Define the structure of the position data being emitted
interface PositionData {
  lat: number;
  lng: number;
}

@Component({
  selector: "move-marker-map",
  templateUrl: "./move-marker-map.component.html",
  styleUrls: ["./move-marker-map.component.less"],
  standalone: true,
  imports: [CoreModule, CommonModule],
  encapsulation: ViewEncapsulation.None,
})
export class MoveMarkerMapComponent
  implements OnInit, AfterViewInit, OnChanges
{
  leaf!: Promise<typeof L>;
  map?: L.Map;
  private imageLayer?: L.ImageOverlay;
  private marker?: L.CircleMarker;

  @Input() imageBlob?: Blob;
  @Input() item?: MarkerManagedObject;

  @Input() topleftLat: number = 51.52;
  @Input() topleftLng: number = -0.12;
  @Input() bottomrightLat: number = 51.49;
  @Input() bottomrightLng: number = -0.07;
  @Input() zoomLevel?: number = 18;
  @Input() polygonVerticesJson?: string;
  @Input() rotationAngle: number = 0;

  @Output() positionChanged = new EventEmitter<PositionData>();

  @ViewChild("markerMap", { read: ElementRef, static: true })
  mapReference!: ElementRef;
  private readonly MAX_ZOOM = 23;
  constructor() {}

  async ngOnInit() {
    this.leaf = import("leaflet");
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    await this.waitForMapInitialization();

    if (
      changes["imageBlob"] ||
      changes["topleftLat"] ||
      changes["topleftLng"] ||
      changes["bottomrightLat"] ||
      changes["bottomrightLng"] ||
      changes["polygonVerticesJson"]
    ) {
      await this.updateImageOverlay();
    }

    // Update marker position or existence when the item changes
    if (changes["item"] || (this.map && this.marker)) {
      console.log(changes["item"]);
      await this.updateMarkerPosition(changes);
    }
  }

  async ngAfterViewInit() {
    const l = await this.leaf;
    const map = l.map(this.mapReference.nativeElement, {});
    this.map = map;

    // Setup Tile Layer
    l.Control.Attribution.prototype.options.prefix = false;
    l.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: this.MAX_ZOOM,
      maxNativeZoom: 19,
    }).addTo(map);

    await this.updateImageOverlay();

    const bounds = this.calculateBounds(l);

    const hasValidBounds = this.topleftLat !== 51.52 && this.topleftLat !== 0;

    if (hasValidBounds) {
      map.setView(bounds.getCenter(), this.zoomLevel);
      map.fitBounds(bounds);
    } else {
      map.setView([51.227, 6.773], this.zoomLevel);
    }

    this.setupMarkerAndClickListener(l, map);

    this.redrawMap(true);
  }

  private calculateBounds(l: typeof L): L.LatLngBounds {
    const southWest = l.latLng(this.bottomrightLat, this.topleftLng);
    const northEast = l.latLng(this.topleftLat, this.bottomrightLng);
    return l.latLngBounds(southWest, northEast);
  }

  private getValidatedControlPoints(
    l: typeof L
  ):
    | { topleft: L.LatLng; topright: L.LatLng; bottomleft: L.LatLng }
    | undefined {
    // 1. Prioritize true Polygon vertices (handles tilt/skew)
    if (this.polygonVerticesJson) {
      try {
        const polygonData = JSON.parse(this.polygonVerticesJson);
        // Geoman usually saves as a nested array [[p1, p2, p3, p4]]
        const ring = Array.isArray(polygonData[0])
          ? polygonData[0]
          : polygonData;

        if (ring && ring.length >= 4) {
          // Geometric Sort: Find TL, TR, and BL regardless of vertex order
          const sortedByLat = [...ring].sort((a, b) => b.lat - a.lat);
          const topTwo = [sortedByLat[0], sortedByLat[1]].sort(
            (a, b) => a.lng - b.lng
          );

          const tl = topTwo[0]; // Most Northern + Most Western
          const tr = topTwo[1]; // Most Northern + Most Eastern

          const remaining = ring.filter(
            (p: any) =>
              (p.lat !== tl.lat || p.lng !== tl.lng) &&
              (p.lat !== tr.lat || p.lng !== tr.lng)
          );
          const bl =
            remaining[0].lng < remaining[1].lng ? remaining[0] : remaining[1];

          return {
            topleft: l.latLng(tl.lat, tl.lng),
            topright: l.latLng(tr.lat, tr.lng),
            bottomleft: l.latLng(bl.lat, bl.lng),
          };
        }
      } catch (e) {
        console.error("Failed to parse polygonVerticesJson:", e);
      }
    }

    // 2. Fallback: Use standard AABB corners if no rotation is present
    if (
      !this.topleftLat ||
      !this.topleftLng ||
      !this.bottomrightLat ||
      !this.bottomrightLng
    ) {
      return undefined;
    }

    return {
      topleft: l.latLng(this.topleftLat, this.topleftLng),
      topright: l.latLng(this.topleftLat, this.bottomrightLng),
      bottomleft: l.latLng(this.bottomrightLat, this.topleftLng),
    };
  }

  private async updateImageOverlay(): Promise<void> {
    if (!this.map || !this.topleftLat || !this.topleftLng) return;

    const l = await this.leaf;

    // Cleanup existing layer
    if (this.imageLayer) {
      this.map.removeLayer(this.imageLayer);
      this.imageLayer = undefined;
    }

    if (this.imageBlob) {
      const controlPoints = this.getValidatedControlPoints(l);
      const imgBlobURL = URL.createObjectURL(this.imageBlob);
      const rotatedFactory = (l.imageOverlay as any).rotated;

      if (rotatedFactory && controlPoints) {
        // Use the three-point anchor system for real-time tilt alignment
        this.imageLayer = rotatedFactory(
          imgBlobURL,
          controlPoints.topleft,
          controlPoints.topright,
          controlPoints.bottomleft,
          { opacity: 1, interactive: true }
        ).addTo(this.map);

        requestAnimationFrame(() => {
          (this.imageLayer as any).reposition(
            controlPoints.topleft,
            controlPoints.topright,
            controlPoints.bottomleft
          );
          setTimeout(() => {
            (this.imageLayer as any).reposition(
              controlPoints.topleft,
              controlPoints.topright,
              controlPoints.bottomleft
            );
          }, 50);
        });

        // Fit the map to the actual tilted layer bounds
        if (this.imageLayer) {
          this.map.fitBounds(this.imageLayer.getBounds());
        }
      } else {
        // Standard fallback for non-rotated environments
        const bounds = this.calculateBounds(l);
        this.imageLayer = l
          .imageOverlay(imgBlobURL, bounds, { opacity: 1 })
          .addTo(this.map);
        this.map.fitBounds(bounds);
      }
    }
  }

  /**
   * Initializes the CircleMarker and sets up the map click listener.
   */
  private setupMarkerAndClickListener(l: typeof L, map: L.Map): void {
    // 1. Initial Marker Setup: ONLY create marker if position exists
    if (this.hasValidPosition()) {
      const initialPosition = this.getMarkerInitialPosition(l);
      this.marker = l
        .circleMarker(initialPosition, {
          radius: 8,
          color: "#0056b3",
          fillColor: "#3498db",
          fillOpacity: 0.8,
          interactive: false,
        })
        .addTo(map);
    }

    // 2. Add Map Click Listener (This listener handles marker creation/repositioning)
    map.on("click", (event: L.LeafletMouseEvent) => {
      const newPosition = event.latlng;

      // If marker doesn't exist, create it at the click location
      if (!this.marker) {
        this.marker = l
          .circleMarker(newPosition, {
            radius: 8,
            color: "#0056b3",
            fillColor: "#3498db",
            fillOpacity: 0.8,
            interactive: false,
          })
          .addTo(map);
      } else {
        // If marker exists, reposition it
        this.marker.setLatLng(newPosition);
      }

      // 3. Update the item's c8y_Position immediately (by reference)
      this.updateItemPosition(newPosition.lat, newPosition.lng);

      // ⬅️ 4. EMIT THE CHANGE to notify the parent
      this.positionChanged.emit({ lat: newPosition.lat, lng: newPosition.lng });
    });
  }

  /**
   * Checks if the item has valid c8y_Position coordinates.
   */
  private hasValidPosition(): boolean {
    const pos = this.item?.c8y_Position;
    return !!pos && pos.lat !== undefined && pos.lng !== undefined;
  }

  /**
   * Updates the position data on the item input object.
   */
  private updateItemPosition(lat: number, lng: number): void {
    if (this.item) {
      if (!this.item.c8y_Position) {
        this.item.c8y_Position = { lat: lat, lng: lng };
      } else {
        this.item.c8y_Position.lat = lat;
        this.item.c8y_Position.lng = lng;
      }
    }
  }

  public redrawMap(initialDelay: boolean = false): void {
    if (!this.map) {
      setTimeout(() => this.redrawMap(initialDelay), 100);
      return;
    }

    requestAnimationFrame(() => {
      const delay = initialDelay ? 300 : 50;
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize(true);
        }
      }, delay);
    });
  }

  private async waitForMapInitialization(): Promise<void> {
    if (this.map) return Promise.resolve();
    await this.leaf;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (this.map) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }

  private async updateMarkerPosition(changes: SimpleChanges): Promise<void> {
    if (!this.map) return;

    const l = await this.leaf;
    const hasPosition = this.hasValidPosition();

    // 1. Handle Removal: If position is invalid, remove the marker
    if (!hasPosition) {
      if (this.marker) {
        this.map.removeLayer(this.marker);
        this.marker = undefined;
      }
      return;
    }

    // --- Position is valid (hasPosition === true) ---

    const newPosition = this.getMarkerInitialPosition(l);

    // 2. Handle Creation: If position is valid but marker doesn't exist
    if (!this.marker) {
      this.marker = l
        .circleMarker(newPosition, {
          radius: 8,
          color: "#0056b3",
          fillColor: "#3498db",
          fillOpacity: 0.8,
          interactive: false,
        })
        .addTo(this.map);
    }
    // 3. Handle Movement: If both exist, move the marker
    else {
      this.marker.setLatLng(newPosition);
    }

    // We explicitly avoid calling map.setView() here to keep the view on the floor bounds.
  }

  private getMarkerInitialPosition(l: typeof L): L.LatLngExpression {
    const itemPosition = this.item?.c8y_Position;

    if (this.hasValidPosition()) {
      return [itemPosition!.lat, itemPosition!.lng];
    }
    return [0, 0];
  }

  getCenterCoordinates(coordinates: any): [number, number] {
    if (coordinates) {
      const centerLat =
        (coordinates.topLeftLat + coordinates.bottomRightLat) / 2;
      const centerLng =
        (coordinates.topLeftLng + coordinates.bottomRightLng) / 2;
      return [centerLat, centerLng];
    } else {
      return [51.227, 6.773];
    }
  }
}
