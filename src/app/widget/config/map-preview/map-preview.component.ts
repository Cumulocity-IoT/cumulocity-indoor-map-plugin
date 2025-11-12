import { CommonModule } from "@angular/common";
import {
  Component,
  Input,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ViewEncapsulation,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import { CoreModule } from "@c8y/ngx-components";
import * as L from "leaflet";
// Assuming GPSCoordinates model path
import { GPSCoordinates } from "../../../models/data-point-indoor-map.model";
import { InventoryBinaryService } from "@c8y/client";

@Component({
  selector: "c8y-gps-preview-component",
  template: `
    <div class="gps-preview-wrapper">
      <div id="previewMap" #previewMap class="gps-preview-map"></div>
    </div>
  `,
  styleUrls: ["./map-preview.component.less"],
  // This component requires standalone: true or similar setup, but since the component metadata
  // already includes imports/template/style, we omit that for simplicity here.
  encapsulation: ViewEncapsulation.None,
})
export class MapPreviewComponent
  implements OnInit, AfterViewInit, OnChanges, OnDestroy
{
  @Input() config!: GPSCoordinates;
  @Input() binaryId?: string;
  @ViewChild("previewMap", { static: true }) mapReference!: ElementRef;

  private map?: L.Map;
  private boundaryLayer?: L.Layer;
  private imageOverlayLayer?: L.ImageOverlay;

  constructor(private binaryService: InventoryBinaryService) {}

  ngOnInit(): void {
    console.log("this.config", this.config);

    if (!this.config) {
      this.config = {
        topLeftLat: 0,
        topLeftLng: 0,
        bottomRightLat: 0,
        bottomRightLng: 0,
      };
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((this.map && changes["config"]) || changes["imageBlob"]) {
      setTimeout(() => this.drawBoundary(), 10);
    }
  }

  ngAfterViewInit(): void {
    if (typeof L === "undefined") {
      console.error("Leaflet library is not loaded.");
      return;
    }
    this.initMap();
    setTimeout(() => {
      if (this.map) {
        this.map.invalidateSize();
        this.redrawMapContents();
      }
    }, 50);
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
    if (this.imageOverlayLayer) {
      //  const src = this.imageOverlayLayer.options.url;
      /*  if (src) {
        URL.revokeObjectURL(src);
      } */
    }
  }

  private initMap(): void {
    const initialCenter: L.LatLngExpression = [
      (this.config.topLeftLat + this.config.bottomRightLat) / 2 || 52.52,
      (this.config.topLeftLng + this.config.bottomRightLng) / 2 || 13.4,
    ];

    this.map = L.map(this.mapReference.nativeElement, {
      center: initialCenter,
      zoom: this.config.zoomLevel,
      zoomControl: true,
      scrollWheelZoom: true,
      dragging: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: this.config.zoomLevel,
      attribution: "Map data &copy; OpenStreetMap contributors",
    }).addTo(this.map);
  }

  private redrawMapContents(): void {
    if (!this.map) return;
    if (this.binaryId) {
      this.placeImageOverlay();
    }
    this.drawBoundary();
  }

  private async placeImageOverlay(): Promise<void> {
    if (!this.map) return;

    // 1. Clear previous image overlay
    if (this.imageOverlayLayer) {
      this.map.removeLayer(this.imageOverlayLayer);
      this.imageOverlayLayer = undefined;
    }

    // if (!this.imageBlob) return;

    // Retrieve the L object
    const l = L;
    const controlPoints = this.getValidatedControlPoints(l);
    const bounds = this.calculateBounds(l);

    if (!controlPoints) {
      console.warn("Cannot place image overlay: Control points missing.");
      return;
    }

    if (!this.binaryId) {
      console.warn("Cannot place image overlay: Binary ID missing.");
      return;
    }

    //const imgBlobURL = URL.createObjectURL(this.imageBlob);
    const imgSource = URL.createObjectURL(await this.getImage(this.binaryId));

    // Use the L.imageOverlay.rotated factory (assuming it's available)
    const imageOverlayFactory = (l.imageOverlay as any).rotated;

    if (imageOverlayFactory) {
      this.imageOverlayLayer = imageOverlayFactory(
        imgSource,
        controlPoints.topleft,
        controlPoints.topright,
        controlPoints.bottomleft,
        {
          opacity: 0.6, // Set transparency level
          interactive: false, // Preview should not be interactive
        }
      ).addTo(this.map);
    } else {
      // Fallback to standard overlay if plugin is missing (will be misaligned)
      this.imageOverlayLayer = l
        .imageOverlay(imgSource, bounds, { opacity: 0.6, interactive: false })
        .addTo(this.map);
      console.warn(
        "L.imageOverlay.rotated not found. Image alignment may be incorrect."
      );
    }
  }

  private async getImage(imageId: string): Promise<Blob> {
    const imageBlob = await (
      (await this.binaryService.download(imageId)) as Response
    ).blob();
    return imageBlob;
  }
  private drawBoundary(): void {
    if (!this.map) return;

    if (this.boundaryLayer) {
      this.map.removeLayer(this.boundaryLayer);
    }

    // Check for required coordinates
    if (
      this.config.topLeftLat === 0 &&
      this.config.bottomRightLat === 0 &&
      !this.config.polygonVerticesJson
    ) {
      return;
    }

    let layerToDraw: L.Layer;

    // 1. Prioritize Polygon Vertices (Accurate Skew/Rotation)
    const polygonJson = this.config.polygonVerticesJson;
    if (polygonJson) {
      try {
        const savedVertices = JSON.parse(polygonJson);
        const latLngs = savedVertices[0].map((v: any) =>
          L.latLng(v.lat, v.lng)
        );

        layerToDraw = L.polygon(latLngs, {
          color: "#1776BF",
          weight: 2,
          dashArray: "5, 5",
          fillOpacity: 0.2,
        });
      } catch (e) {
        console.error("Failed to parse polygon vertices for preview:", e);
        return;
      }
    } else {
      // 2. Fallback to Axis-Aligned Bounding Box
      const southWest = L.latLng(
        this.config.bottomRightLat,
        this.config.topLeftLng
      );
      const northEast = L.latLng(
        this.config.topLeftLat,
        this.config.bottomRightLng
      );
      const leafletBounds = L.latLngBounds(southWest, northEast);

      layerToDraw = L.rectangle(leafletBounds, {
        color: "#1776BF",
        weight: 2,
        dashArray: "5, 5",
        fillOpacity: 0.2,
      });
    }

    // Assign and add the layer to the map
    this.boundaryLayer = layerToDraw;
    this.map.addLayer(this.boundaryLayer);

    // Apply rotation if present and layer supports it
    if (this.config.rotationAngle && (this.boundaryLayer as any).setRotation) {
      (this.boundaryLayer as any).setRotation(this.config.rotationAngle);
    }

    // ⬅️ Final Fit Bounds using the safe check
    const boundaryLayerWithBounds = this.boundaryLayer as any;

    if (
      boundaryLayerWithBounds.getBounds &&
      boundaryLayerWithBounds.getBounds().isValid()
    ) {
      const bounds = boundaryLayerWithBounds.getBounds();
      this.map.fitBounds(bounds, { padding: [10, 10] });
    } else if (boundaryLayerWithBounds.getLatLng) {
      // Fallback for single point (e.g., if coordinates are tiny)
      this.map.setView(boundaryLayerWithBounds.getLatLng(), 15);
    }
  }

  private calculateBounds(l: typeof L): L.LatLngBounds {
    const southWest = l.latLng(
      this.config.bottomRightLat,
      this.config.topLeftLng
    );
    const northEast = l.latLng(
      this.config.topLeftLat,
      this.config.bottomRightLng
    );
    return l.latLngBounds(southWest, northEast);
  }

  private getValidatedControlPoints(
    l: typeof L
  ):
    | { topleft: L.LatLng; topright: L.LatLng; bottomleft: L.LatLng }
    | undefined {
    // 1. Prioritize true Polygon vertices
    if (this.config.polygonVerticesJson) {
      try {
        const polygonData = JSON.parse(this.config.polygonVerticesJson);
        const vertices = polygonData[0];

        if (vertices && vertices.length >= 4) {
          const V1 = vertices[0];
          const V2 = vertices[1];
          const V4 = vertices[3];

          const topleft = l.latLng(V1.lat ?? 0, V1.lng ?? 0);
          const topright = l.latLng(V2.lat ?? 0, V2.lng ?? 0);
          const bottomleft = l.latLng(V4.lat ?? 0, V4.lng ?? 0);

          return { topleft, topright, bottomleft };
        }
      } catch (e) {
        console.error("Failed to parse polygonVerticesJson for overlay:", e);
      }
    }

    // 2. Fallback: Use the bounding box corners
    if (
      !this.config.topLeftLat ||
      !this.config.topLeftLng ||
      !this.config.bottomRightLat ||
      !this.config.bottomRightLng
    ) {
      return undefined;
    }

    const topleft = l.latLng(this.config.topLeftLat, this.config.topLeftLng);
    const topright = l.latLng(
      this.config.topLeftLat,
      this.config.bottomRightLng
    );
    const bottomleft = l.latLng(
      this.config.bottomRightLat,
      this.config.topLeftLng
    );

    return { topleft, topright, bottomleft };
  }
}
