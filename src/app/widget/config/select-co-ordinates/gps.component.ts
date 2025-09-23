import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  ViewChild,
  ElementRef,
  OnDestroy,
  TemplateRef,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
} from "@angular/core";
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
} from "@angular/forms";
import { BsModalService, BsModalRef } from "ngx-bootstrap/modal";
import { Subscription } from "rxjs";
import { debounceTime, take } from "rxjs/operators";
//import type * as L from "leaflet";
declare const L: any;
// Custom validator to ensure top-left is north-west of bottom-right
function coordinateBoundsValidator(
  control: AbstractControl
): ValidationErrors | null {
  const topLeftLat = control.get("topLeftLat")?.value;
  const topLeftLng = control.get("topLeftLng")?.value;
  const bottomRightLat = control.get("bottomRightLat")?.value;
  const bottomRightLng = control.get("bottomRightLng")?.value;

  if (
    topLeftLat !== null &&
    bottomRightLat !== null &&
    parseFloat(topLeftLat) <= parseFloat(bottomRightLat)
  ) {
    return {
      invalidBounds:
        "Top-left latitude must be greater than bottom-right latitude.",
    };
  }

  if (
    topLeftLng !== null &&
    bottomRightLng !== null &&
    parseFloat(topLeftLng) >= parseFloat(bottomRightLng)
  ) {
    return {
      invalidBounds:
        "Top-left longitude must be less than bottom-right longitude.",
    };
  }

  return null;
}

@Component({
  selector: "c8y-gps-component",
  templateUrl: "./gps.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GPSComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild("modalMap") modalMapContainer!: ElementRef;
  @ViewChild("mapModalTemplate") mapModalTemplate!: TemplateRef<any>;

  @Input() config: any;

  /**
   * Output event emitter to notify the parent component of any changes.
   */
  @Output() configChange = new EventEmitter<any>();
  private readonly fb = inject(FormBuilder);
  private readonly modalService = inject(BsModalService);
  bsModalRef!: BsModalRef;

  placementMode = signal<"corners" | "dimensions">("corners");
  locationError = signal<string>("");
  private cornersFormSub!: Subscription;
  private dimensionsFormSub!: Subscription;

  cornersForm!: FormGroup;
  dimensionsForm!: FormGroup;

  private modalMap: any;
  private clickHandler: ((e: any) => void) | null = null;
  /*  ngOnInit(): void {
    this.subscribeToFormChanges();
  } */

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["config"] && this.config.coordinates) {
      // Unsubscribe from previous listeners to prevent emitting a change event when patching
      this.unsubscribeFromFormChanges();

      // Determine the mode and patch the correct form based on the incoming config
      if (this.config.coordinates.placementMode === "dimensions") {
        this.placementMode.set("dimensions");
        this.dimensionsForm.patchValue(this.config.coordinates, {
          emitEvent: false,
        });
      } else {
        this.placementMode.set("corners");
        this.cornersForm.patchValue(this.config.coordinates, {
          emitEvent: false,
        });
      }

      // Re-subscribe after patching the value
      this.subscribeToFormChanges();
    }
  }
  ngOnDestroy(): void {
    this.destroyModalMap();
    this.unsubscribeFromFormChanges();
  }

  private subscribeToFormChanges(): void {
    const DEBOUNCE_TIME = 300; // ms to wait for user to stop typing

    this.cornersFormSub = this.cornersForm.valueChanges
      .pipe(debounceTime(DEBOUNCE_TIME))
      .subscribe((value) => {
        if (this.cornersForm.valid) {
          console.log("Corners form changed, emitting:", value);
          this.configChange.emit({
            placementMode: "corners",
            ...value,
          });
        }
      });

    this.dimensionsFormSub = this.dimensionsForm.valueChanges
      .pipe(debounceTime(DEBOUNCE_TIME))
      .subscribe((value) => {
        if (this.dimensionsForm.valid) {
          console.log("Dimensions form changed, emitting:", value);
          this.configChange.emit({
            placementMode: "dimensions",
            ...value,
          });
        }
      });
  }

  ngOnInit(): void {
    this.cornersForm = this.fb.group(
      {
        topLeftLat: [
          this.config?.coordinates.topLeftLat ?? "",
          [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
        ],
        topLeftLng: [
          this.config?.coordinates.topLeftLng ?? "",
          [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
        ],
        bottomRightLat: [
          this.config?.coordinates.bottomRightLat ?? "",
          [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
        ],
        bottomRightLng: [
          this.config?.coordinates.bottomRightLng ?? "",
          [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
        ],
      },
      { validators: coordinateBoundsValidator }
    );

    this.dimensionsForm = this.fb.group({
      anchorLat: [
        this.config?.coordinates.anchorLat ?? "",
        [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
      ],
      anchorLng: [
        this.config?.coordinates.anchorLng ?? "",
        [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)],
      ],
      width: [
        this.config?.coordinates.width ?? 1000,
        [Validators.required, Validators.min(1)],
      ],
      height: [
        this.config?.coordinates.height ?? 1000,
        [Validators.required, Validators.min(1)],
      ],
      scaleX: [
        this.config?.coordinates.scaleX ?? 1,
        [Validators.required, Validators.min(0)],
      ],
      scaleY: [
        this.config?.coordinates.scaleY ?? 1,
        [Validators.required, Validators.min(0)],
      ],
      offsetX: [this.config?.coordinates.offsetX ?? 0, [Validators.required]],
      offsetY: [this.config?.coordinates.offsetY ?? 0, [Validators.required]],
    });

    this.subscribeToFormChanges();
  }

  private unsubscribeFromFormChanges(): void {
    this.cornersFormSub?.unsubscribe();
    this.dimensionsFormSub?.unsubscribe();
  }
  private initializeModalMap(
    form: FormGroup,
    latControl: string,
    lngControl: string
  ): void {
    // Use a console log to check if the modal container is present
    console.log(
      "Initializing modal map...",
      this.modalMapContainer?.nativeElement
    );

    if (this.modalMap || !this.modalMapContainer?.nativeElement) {
      console.error(
        "Modal map container not found or map already initialized."
      );
      return;
    }

    const center = [51.23544, 6.79599];
    const zoom = 10;

    // Initialize the modal map using its container
    this.modalMap = L.map(this.modalMapContainer.nativeElement).setView(
      center,
      zoom
    );

    // Add the tile layer to the modal map instance
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.modalMap);

    // Set up the click handler for the modal map
    this.clickHandler = (e: any) => {
      const { lat, lng } = e.latlng;
      form.patchValue({
        [latControl]: lat.toFixed(6),
        [lngControl]: lng.toFixed(6),
      });
      this.bsModalRef.hide();
    };

    this.modalMap.on("click", this.clickHandler);

    console.log("Modal map initialized successfully!");
    // Invalidate size is called here to ensure the map renders correctly.
    this.modalMap.invalidateSize();
  }
  private destroyModalMap(): void {
    if (this.modalMap) {
      if (this.clickHandler) {
        this.modalMap.off("click", this.clickHandler);
        this.clickHandler = null;
      }
      this.modalMap.remove();
      this.modalMap = null;
    }
  }

  getUserLocation(): void {
    this.locationError.set("");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          this.dimensionsForm.patchValue({
            anchorLat: latitude.toFixed(6),
            anchorLng: longitude.toFixed(6),
          });
        },
        (error) => {
          this.locationError.set(`Error: ${error.message}`);
        }
      );
    } else {
      this.locationError.set("Geolocation is not supported by this browser.");
    }
  }

  openModal(form: FormGroup, latControl: string, lngControl: string): void {
    this.bsModalRef = this.modalService.show(this.mapModalTemplate, {
      class: "modal-lg",
    });

    // We now use a single setTimeout(..., 0) inside the onShown subscription to ensure
    // that the @ViewChild reference is populated after the modal's template is rendered.
    this.modalService.onShown.pipe(take(1)).subscribe(() => {
      setTimeout(() => {
        this.initializeModalMap(form, latControl, lngControl);
        // Invalidate size is called here to ensure the map renders correctly.
        // This is a common Leaflet pattern when the container changes size or visibility.
        if (this.modalMap) {
          this.modalMap.invalidateSize();
        }
      }, 0);
    });

    this.modalService.onHide.pipe(take(1)).subscribe(() => {
      this.destroyModalMap();
    });
  }
}
