import {
  Component,
  Input,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
} from "@angular/core";
import {
  MapConfiguration,
  MapConfigurationLevel,
  MarkerManagedObject,
} from "../../../../models/data-point-indoor-map.model";
import {
  IManagedObject,
  IManagedObjectBinary,
  InventoryBinaryService,
  InventoryService,
} from "@c8y/client";
import { FilesService, IFetchWithProgress } from "@c8y/ngx-components";
import { Subject, takeUntil } from "rxjs";
import { DomSanitizer, SafeUrl } from "@angular/platform-browser";
import { AlertService } from "@c8y/ngx-components";
import { BsModalRef } from "ngx-bootstrap/modal";
import type * as L from "leaflet";
import { ImageRotateService } from "../../../../services/image-rotate.service";

@Component({
  selector: "assign-locations-step",
  templateUrl: "./assign-locations-modal.component.html",
  styleUrls: ["./assign-locations-modal.component.less"],
  encapsulation: ViewEncapsulation.None,
})
export class AssignLocationModalComponent implements OnInit, OnDestroy {
  selectedLevel?: MapConfigurationLevel;
  selectedItem?: {
    id: string;
    name?: string;
    c8y_Position?: { lat: number; lng: number };
  };
  selectedItemIsSensor = false;
  @Input() building!: MapConfiguration;
  @Input() managedObjectsForFloorLevels: MarkerManagedObject[][] = [];

  managedObjectsForSelectedLevel: MarkerManagedObject[] = [];

  isLoadingImage = false;
  destroy$ = new Subject<void>();
  progress?: IFetchWithProgress;
  safeDataUrl?: SafeUrl;
  imageCache = new Map<string, string>();
  imageBlob?: Blob;

  topLeftLng: number | undefined;
  topLeftLat: number | undefined;
  bottomRightLng: number | undefined;
  bottomRightLat: number | undefined;

  leaf!: typeof L;
  constructor(
    private inventory: InventoryService,
    private binaryService: InventoryBinaryService,
    private filesService: FilesService,
    private sanitizer: DomSanitizer,
    private alertService: AlertService,
    private bsModalRef: BsModalRef,
    private imageRotateService: ImageRotateService
  ) {}

  async ngOnInit(): Promise<void> {
    this.leaf = await import("leaflet");
    this.imageRotateService.initialize(this.leaf);

    this.selectLevel(this.building?.levels[0]);
    console.log(this.building);
    console.log(this.selectedLevel);
    if (
      this.building.coordinates.bottomRightLat &&
      this.building.coordinates.bottomRightLng &&
      this.building.coordinates.topLeftLat &&
      this.building.coordinates.topLeftLng
    ) {
      this.topLeftLat = this.building.coordinates.topLeftLat;
      this.topLeftLng = this.building.coordinates.topLeftLng;
      this.bottomRightLat = this.building.coordinates.bottomRightLat;
      this.bottomRightLng = this.building.coordinates.bottomRightLng;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectItem(device: { id: string; name?: string }) {
    this.selectedItem = device;
  }

  selectLevel(level: MapConfigurationLevel) {
    this.selectedLevel = level;
    if (level.binaryId) {
      this.selectedItem = undefined;
      delete this.safeDataUrl;
      this.managedObjectsForSelectedLevel =
        this.managedObjectsForFloorLevels[this.building.levels.indexOf(level)];
      if (this.imageCache.has(level.binaryId)) {
        const imageUrl = this.imageCache.get(level.binaryId)!;
        this.safeDataUrl = this.sanitizer.bypassSecurityTrustUrl(imageUrl);
        this.loadImage().finally(() => (this.isLoadingImage = false));
      } else {
        this.isLoadingImage = true;
        this.loadImage().finally(() => (this.isLoadingImage = false));
      }
    }
  }

  onImageUploaded(binary: IManagedObjectBinary) {
    const level = this.selectedLevel;
    if (level) {
      if (level.binaryId) {
        this.binaryService.delete(level.binaryId);
      }
      level.binaryId = binary.id!;
      this.loadImage();
    }
  }

  async loadImage() {
    console.log("Loading image for level", this.selectedLevel);
    const level = this.selectedLevel as MapConfigurationLevel;
    if (level.binaryId) {
      const { data } = await this.inventory.detail(level.binaryId);
      const binaryMO = data as IManagedObjectBinary;
      this.filesService
        .fetchFileWithProgress$(binaryMO)
        .pipe(takeUntil(this.destroy$))
        .subscribe((progress) => {
          this.progress = progress;
          if (this.progress?.blob) {
            this.imageBlob = progress.blob;
            const imageUrl = URL.createObjectURL(progress.blob!);
            this.imageCache.set(level.binaryId!, imageUrl);
            this.safeDataUrl = this.sanitizer.bypassSecurityTrustUrl(imageUrl);
          }
        });
    }
  }

  removeImage() {
    const level = this.selectedLevel as MapConfigurationLevel;
    if (level.binaryId) {
      this.binaryService.delete(level.binaryId);
      delete level.binaryId;
    }
  }

  // AssignLocationsStepComponent.ts
  async onMapPositionChanged(position: { lat: number; lng: number }) {
    console.log("Map click event received. New position:", position);
    if (this.selectedItem) {
      if (!this.selectedItem.c8y_Position) {
        this.selectedItem.c8y_Position = {
          lat: position.lat,
          lng: position.lng,
        };
      } else {
        this.selectedItem.c8y_Position.lat = position.lat;
        this.selectedItem.c8y_Position.lng = position.lng;
      }
      await this.inventory.update(this.selectedItem);
      this.alertService.success("Device position updated successfully.");
    }
  }

  onClose(): void {
    this.bsModalRef.hide();
  }
}
