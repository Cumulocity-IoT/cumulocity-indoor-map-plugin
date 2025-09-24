import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from "@angular/core";
import { BsModalRef } from "ngx-bootstrap/modal";
import * as L from "leaflet";
import { FormGroup } from "@angular/forms";

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
        <div #modalMap id="modalMap" style="height: 500px; width: 100%;"></div>
      </div>
    </div>
  `,
})
export class MapModalComponent implements OnInit, OnDestroy {
  @ViewChild("modalMap") modalMapContainer!: ElementRef;

  private map: L.Map | null = null;
  private clickHandler: ((e: any) => void) | null = null;

  public form!: FormGroup;
  public latControl!: string;
  public lngControl!: string;

  constructor(public bsModalRef: BsModalRef) {}

  ngOnInit(): void {
    setTimeout(() => {
      this.initializeModalMap();
    }, 0);
  }

  private initializeModalMap(): void {
    if (this.map || !this.modalMapContainer?.nativeElement) {
      return;
    }

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

    this.clickHandler = (e: any) => {
      const { lat, lng } = e.latlng;
      this.form.patchValue({
        [this.latControl]: lat.toFixed(6),
        [this.lngControl]: lng.toFixed(6),
      });
      this.closeModal();
    };

    this.map.on("click", this.clickHandler);
    this.map.invalidateSize();
  }

  closeModal(): void {
    this.bsModalRef.hide();
  }

  ngOnDestroy(): void {
    if (this.map) {
      if (this.clickHandler) {
        this.map.off("click", this.clickHandler);
        this.clickHandler = null;
      }
      this.map.remove();
      this.map = null;
    }
  }
}
