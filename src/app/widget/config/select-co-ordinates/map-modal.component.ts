import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from "@angular/core";
import { BsModalRef } from "ngx-bootstrap/modal";
// Note: We use * as L to be compatible with leaflet-draw
import * as L from "leaflet";
import "leaflet-draw";
import { FormGroup } from "@angular/forms";
import { Subject } from "rxjs";

@Component({
  selector: "c8y-map-modal",
  template: `
    <div class="modal-content">
      <div class="modal-header">
        <h4 class="modal-title">Select Coordinates</h4>
        <button type="button" class="close" (click)="closeModal()">
          &times;
        </button>
      </div>
      <div class="modal-body">
        <div class="m-b-16">
          <h4 class="text-uppercase m-b-8">Draw Coordinates</h4>
          <div class="btn-group w-100" role="group">
            <button
              (click)="startDrawing()"
              [disabled]="isDrawing"
              class="btn btn-primary"
              [class.btn-default]="isDrawing"
            >
              Start Drawing
            </button>
            <button
              (click)="finishDrawing()"
              [disabled]="!isDrawing"
              class="btn btn-success"
              [class.btn-default]="!isDrawing"
            >
              Finish Drawing
            </button>
          </div>
        </div>
        <div #modalMap id="modalMap" style="height: 500px; width: 100%;"></div>
      </div>
    </div>
  `,
})
export class MapModalComponent implements OnInit, OnDestroy {
  @ViewChild("modalMap") modalMapContainer!: ElementRef;

  /*   private map: L.Map | null = null;
  private polygonDrawer: any;
  private drawnPolygon: any | null = null;
  private clickHandler: ((e: any) => void) | null = null; */
  private map: L.Map | null = null;
  private polygonDrawer: any;
  private drawnPolygon: any | null = null;
  private clickHandler: ((e: any) => void) | null = null;

  //public isDrawing: boolean = false;

  // Initial State from parent (for single click selection)
  public form!: FormGroup;
  public latControl!: string;
  public lngControl!: string;
  private isFinishing: boolean = false;
  public isDrawing: boolean = false;
  // New Subject to emit drawn bounds (for the full polygon)
  public boundsSubject = new Subject<any | null>();

  constructor(public bsModalRef: BsModalRef) {}

  ngOnInit(): void {
    // CRITICAL: Initialize map after DOM is ready
    setTimeout(() => {
      this.initializeModalMap();
    }, 0);
  }

  private initializeModalMap(): void {
    if (this.map || !this.modalMapContainer?.nativeElement) {
      return;
    }

    // Set map center based on a neutral location or existing form data
    const center: [number, number] = [51.23544, 6.79599];
    const zoom = 10;

    this.map = L.map(this.modalMapContainer.nativeElement, {
      zoom: zoom,
      center: center,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    this.map.on("draw:created", (e: any) => {
      this.drawnPolygon = e.layer;
      this.map!.addLayer(this.drawnPolygon);
      if (!this.isFinishing) {
        this.finishDrawing();
      }
    });

    // Setup single-click coordinate picker (optional)
    this.setupSingleClickPicker();

    // CRITICAL: Ensure map renders correctly inside the modal
    this.map.invalidateSize();
  }

  private setupSingleClickPicker(): void {
    this.clickHandler = (e: any) => {
      const { lat, lng } = e.latlng;
      console.log(lat, lng, "shitty thing");

      this.form.patchValue({
        [this.latControl]: lat.toFixed(6),
        [this.lngControl]: lng.toFixed(6),
      });
      this.closeModal();
    };
    this.map!.on("click", this.clickHandler);
  }

  /*  startDrawing(): void {
    const Draw: any = (L as any).Draw;

    if (!Draw || !Draw.Polygon || !this.map) {
      console.error("Leaflet Draw plugin is not ready.");
      return;
    }

    // Remove single-click handler while drawing is active
    if (this.clickHandler) {
      this.map!.off("click", this.clickHandler);
    }

    // Clear any previous polygon
    if (this.drawnPolygon) {
      this.map!.removeLayer(this.drawnPolygon);
      this.drawnPolygon = null;
    }

    this.isDrawing = true;

    this.polygonDrawer = new Draw.Polygon(this.map, {
      shapeOptions: {
        color: "#3b82f6",
      },
      guidelineDistance: 20, // Increase snap tolerance
      allowIntersection: false,
      showArea: true,
      repeatMode: false,
    });

    this.polygonDrawer.enable();
  } */
  startDrawing(): void {
    const Draw: any = (L as any).Draw;

    if (!Draw || !Draw.Polygon || !this.map) {
      console.error("Leaflet Draw plugin is not ready.");
      return;
    }

    // Remove single-click handler while drawing is active
    if (this.clickHandler) {
      this.map!.off("click", this.clickHandler);
    }

    // Clear any previous polygon
    if (this.drawnPolygon) {
      this.map!.removeLayer(this.drawnPolygon);
      this.drawnPolygon = null;
    }

    this.isDrawing = true;

    // Initialize the drawing tool
    this.polygonDrawer = new Draw.Polygon(this.map, {
      shapeOptions: {
        color: "#3b82f6",
      },
      // Increase snap distance to make it easier to hit the first point
      guidelineDistance: 30, // Increased from 20

      // Also increase the global snap tolerance if available (L.Handler.Marker.SnappingMixin)
      snapDistance: 30, // Add this if your Leaflet Draw version supports it

      allowIntersection: false,
      showArea: true,
      repeatMode: false,
    });

    this.polygonDrawer.enable();
  }

  /* finishDrawing(): void {
    if (this.isFinishing) return; // Prevent re-entry
    this.isFinishing = true;

    if (this.polygonDrawer) {
      // 1. CRITICAL: Disable the handler FIRST. This stops the input/processing listeners.
      if (this.polygonDrawer.enabled()) {
        this.polygonDrawer.disable();
      }

      // 2. Only force completion if a polygon was actually being drawn.
      // This ensures the handler finalizes the shape's data structure.
      this.polygonDrawer.completeShape();
    }

    // Reset drawing state
    this.isDrawing = false;

    if (this.drawnPolygon) {
      // TEMPORARILY REMOVE THE LAYER to guarantee the geometry operation is clean.
      if (this.map) {
        this.map.removeLayer(this.drawnPolygon);
      }

      try {
        // Get bounds (this is the call that throws the error)
        const bounds = this.drawnPolygon.getBounds();

        // Emit the calculated bounds back to the parent component
        this.boundsSubject.next({
          tl: {
            lat: bounds.getNorthWest().lat,
            lng: bounds.getNorthWest().lng,
          },
          br: {
            lat: bounds.getSouthEast().lat,
            lng: bounds.getSouthEast().lng,
          },
        });
      } catch (e) {
        console.error(
          "Failed to get bounds due to invalid polygon geometry:",
          e
        );
        this.boundsSubject.next(null);
      }

      // Clean up the polygon reference
      this.drawnPolygon = null;
    } else {
      this.boundsSubject.next(null);
    }

    // Re-enable single-click selection and unlock
    this.setupSingleClickPicker();
    this.isFinishing = false;
  }
 */
  finishDrawing(): void {
    // Check if the drawing handler is even active before proceeding
    if (!this.polygonDrawer || !this.polygonDrawer.enabled()) {
      console.warn(
        "Finish Drawing called when handler was not active or initialized."
      );
      this.isDrawing = false;
      return;
    }

    // Set a lock to prevent re-entry (important from previous fix)
    if (this.isFinishing) return;
    this.isFinishing = true;

    // 1. CRITICAL FIX: Ensure at least two vertices exist before forcing completion.
    // If fewer than 2 vertices are placed, ._markers will be empty/invalid, leading to the 'length' error.
    // We check the internal markers array as a safeguard.
    if (this.polygonDrawer._markers && this.polygonDrawer._markers.length < 2) {
      console.warn(
        "Polygon needs at least two points before being finished. Cancelling."
      );
      this.polygonDrawer.disable(); // Disable gracefully
      this.isDrawing = false;
      this.isFinishing = false;
      this.boundsSubject.next(null);
      this.setupSingleClickPicker();
      return;
    }

    // 2. Force the polygon to complete.
    // This must happen before disable(), as disable() cleans up the points array.
    this.polygonDrawer.completeShape();

    // 3. Disable the handler immediately after completion
    this.polygonDrawer.disable();

    // Reset drawing state
    this.isDrawing = false;

    // 4. Process the geometry (your previous correct logic)
    if (this.drawnPolygon) {
      if (this.map) {
        this.map.removeLayer(this.drawnPolygon);
      }

      try {
        const bounds = this.drawnPolygon.getBounds();

        this.boundsSubject.next({
          tl: {
            lat: bounds.getNorthWest().lat,
            lng: bounds.getNorthWest().lng,
          },
          br: {
            lat: bounds.getSouthEast().lat,
            lng: bounds.getSouthEast().lng,
          },
        });
        this.drawnPolygon = null;
      } catch (e) {
        console.error(
          "Failed to get bounds after completion (Geometry Error):",
          e
        );
        this.boundsSubject.next(null);
      }
    } else {
      this.boundsSubject.next(null);
    }

    this.setupSingleClickPicker();
    this.isFinishing = false;
  }

  closeModal(): void {
    this.bsModalRef.hide();
  }

  ngOnDestroy(): void {
    if (this.map) {
      if (this.polygonDrawer) {
        this.polygonDrawer.disable();
      }
      if (this.clickHandler) {
        this.map.off("click", this.clickHandler);
      }
      this.map.remove();
      this.map = null;
    }
    this.boundsSubject.complete();
  }
}
