import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import {
  MapConfiguration,
  MapConfigurationLevel,
} from "../../../models/data-point-indoor-map.model";
import { AlertService } from "@c8y/ngx-components";
import { InventoryBinaryService } from "@c8y/client";
import { BsModalRef } from "ngx-bootstrap/modal";

@Component({
  selector: "app-floor-config-modal",
  templateUrl: "./floor-config-modal.component.html",
  // Note: Add your component-specific CSS file here if needed
})
export class FloorConfigModalComponent implements OnInit {
  @Input() building: MapConfiguration | undefined;

  @Output() onChange = new EventEmitter<MapConfigurationLevel[]>();

  // store the building's levels separately to avoid name collision with the FormArray getter `floors`
  floors: MapConfigurationLevel[] = [];

  // Storage for File objects, indexed by the position in the floors array
  selectedFiles: (File | null)[] = [];

  // Temporary inputs for the "Add new floor" card
  newFloorName = "";
  newFloorFile: File | null = null;

  constructor(
    private fb: FormBuilder,
    private modalRef: BsModalRef,
    private alertService: AlertService,
    private binaryService: InventoryBinaryService
  ) {}

  ngOnInit(): void {
    this.floors = this.building?.levels ?? [];

    // initialize selectedFiles array to match existing floors if any
    this.selectedFiles = this.floors.map(() => null);

    this.floors.forEach((floor, index) => {
      floor["image"] = URL.createObjectURL(floor.blob!);
    });

    console.log("Initialized floors:", this.floors);
  }

  saveConfiguration(): void {
    console.log("Saved floors configuration:", this.floors);
  }

  /**
   * Called when the user clicks 'Cancel'.
   */
  onCancel(): void {
    console.log("Configuration cancelled.");
    // TODO: Implement logic to programmatically hide the Bootstrap modal
    // this.activeModal.dismiss('cancel');
  }

  addFloor(): void {
    console.log("Add Floor clicked");
  }

  onFile(event: any): void {
    let file: File | null = null;

    console.log("File input event:", event);

    const newImage = event.droppedFiles[0];

    if (!newImage) {
      this.newFloorFile = null;
      return;
    }

    if (newImage instanceof File) {
      file = newImage;
    } else if ((newImage as any).file instanceof File) {
      file = (newImage as any).file;
    } else if (Array.isArray((newImage as any).files)) {
      file = (newImage as any).files[0] ?? null;
    } else if ((newImage as any).files instanceof File) {
      file = (newImage as any).files as File;
    }

    const isImage = (f: File | null): boolean => {
      console.log("Validating file as image:", f);
      if (!f) return false;
      if (f.type) return f.type.startsWith("image/");
      return /\.(jpe?g|png|gif|bmp|webp|svg)$/i.test(f.name || "");
    };

    const showAlert = (msg: string) => {
      const svc = this.alertService as any;
      if (typeof svc.addAlert === "function") {
        svc.addAlert({ message: msg, type: "danger" });
      } else if (typeof svc.danger === "function") {
        svc.danger(msg);
      } else if (typeof svc.error === "function") {
        svc.error(msg);
      } else {
        // fallback
        console.warn("Alert:", msg);
      }
    };

    if (!file) {
      this.newFloorFile = null;
      return;
    }

    if (isImage(file)) {
      this.newFloorFile = file;
    } else {
      this.newFloorFile = null;
      showAlert(
        "Selected file is not a supported image. Please choose an image file (jpg, png, gif, bmp, webp, svg)."
      );
    }
  }

  /**
   * Save the new floor from the "Add new floor" card.
   * Adds a new MapConfigurationLevel to the floors array and stores the selected file
   * in the selectedFiles array at the same index.
   */
  saveFloor(): void {
    if (!this.newFloorName) {
      return;
    }

    if (!this.newFloorFile) {
      return;
    }

    this.binaryService
      .create(this.newFloorFile)
      .then((binary: any) => {
        console.log("Uploaded binary:", binary);

        const id =
          binary?.data?.id ?? binary?.id ?? (binary as any)?.result?.id;

        const newLevel = {
          // keep minimal known property; cast to the imported type to satisfy TypeScript
          name: this.newFloorName,
          binaryId: id,
          imageDetails: {
            dimensions: {
              width: binary?.data?.width ?? 0,
              height: binary?.data?.height ?? 0,
            },
          },
        } as MapConfigurationLevel;
        newLevel["image"] = URL.createObjectURL(this.newFloorFile!);
        this.floors.push(newLevel);
        this.selectedFiles.push(this.newFloorFile);

        // reset inputs
        this.newFloorName = "";
        this.newFloorFile = null;

        console.log("Added new floor:", newLevel);
      })
      .catch((err: any) => {
        console.error("Failed to upload binary:", err);
        const svc = this.alertService as any;
        const msg = "Failed to upload image. Please try again.";
        if (typeof svc.addAlert === "function") {
          svc.addAlert({ message: msg, type: "danger" });
        } else if (typeof svc.danger === "function") {
          svc.danger(msg);
        } else if (typeof svc.error === "function") {
          svc.error(msg);
        } else {
          console.warn(msg);
        }
      });
  }

  removeFloor(floor: MapConfigurationLevel): void {
    // find index by reference first, fallback to matching by binaryId/name
    let index = this.floors.indexOf(floor);
    if (index === -1) {
      index = this.floors.findIndex(
        (f) =>
          f === floor ||
          (f.binaryId &&
            floor.binaryId &&
            f.binaryId === floor.binaryId &&
            f.name === floor.name)
      );
    }
    if (index === -1) {
      console.warn("Floor to remove not found:", floor);
      return;
    }

    // revoke any created object URL to avoid memory leaks
    const imageUrl = (this.floors[index] as any)["image"];
    if (
      imageUrl &&
      typeof imageUrl === "string" &&
      imageUrl.startsWith("blob:")
    ) {
      try {
        URL.revokeObjectURL(imageUrl);
      } catch (e) {
        /* ignore */
      }
    }

    // remove from arrays
    this.floors.splice(index, 1);
    this.selectedFiles.splice(index, 1);

    // notify consumers about the change
    this.onChange.emit(this.floors);
  }

  cancel(): void {
    this.modalRef.hide();
  }
}
