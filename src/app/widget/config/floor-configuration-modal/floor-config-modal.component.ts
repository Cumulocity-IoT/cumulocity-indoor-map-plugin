import { 
    Component, 
    EventEmitter, 
    Input, 
    OnInit, 
    Output,
    ViewChild // Import ViewChild
} from "@angular/core";
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

  // Template reference to the file picker component for resetting
  @ViewChild("filePicker") filePickerRef: any; 

  // store the building's levels separately to avoid name collision with the FormArray getter `floors`
  floors: MapConfigurationLevel[] = [];

  // Temporary inputs for the "Add new floor" card
  newFloorName = "";
  newFloorFile: File | null = null;
    
  // Temporary list for floors added but not yet saved/uploaded
  stagedNewFloors: { name: string; file: File }[] = []; 

  constructor(
    private fb: FormBuilder,
    public modalRef: BsModalRef, 
    private alertService: AlertService,
    private binaryService: InventoryBinaryService
  ) {}

  ngOnInit(): void {
    this.floors = this.building?.levels ?? [];

    this.floors.forEach((floor, index) => {
        // NOTE: If floor.blob exists, it should be used to create the image URL for existing floors
        // Assuming 'blob' is a temporary property set during initialization/loading
        if (floor['blob']) {
            floor["image"] = URL.createObjectURL(floor.blob!);
        }
    });

    console.log("Initialized floors:", this.floors);
  }

  /**
   * Handles the final save action from the modal footer.
   * Uploads all staged binary files, updates the floor array with the new IDs, and closes the modal.
   */
  saveConfiguration(): void {
    console.log("Attempting to save floors configuration:", this.floors);

    // Only upload floors that are staged (i.e., newly added)
    const uploadPromises = this.stagedNewFloors.map((stagedFloor) => {
      return this.binaryService
        .create(stagedFloor.file)
        .then((binary: any) => {
          const id =
            binary?.data?.id ?? binary?.id ?? (binary as any)?.result?.id;

          // Find the corresponding temporary floor in this.floors and update its binaryId
          const tempFloorIndex = this.floors.findIndex(
            (f) => f.name === stagedFloor.name && !f.binaryId
          );

          if (tempFloorIndex !== -1) {
            // Update the temporary floor with the new binary ID
            this.floors[tempFloorIndex].binaryId = id;
            this.floors[tempFloorIndex].imageDetails = {
              dimensions: {
                width: binary?.data?.width ?? 0,
                height: binary?.data?.height ?? 0,
              },
            };
          }
        })
        .catch((err: any) => {
          console.error(`Failed to upload binary for ${stagedFloor.name}:`, err);
          // Return a rejected promise to ensure Promise.all fails
          return Promise.reject(err);
        });
    });

    Promise.all(uploadPromises)
      .then(() => {
        // All uploads successful
        console.log("All uploads complete. Final floors configuration:", this.floors);
        this.stagedNewFloors = []; // Clear staged items
        this.onChange.emit(this.floors); // Emit the configuration
        this.modalRef.hide(); // Hide the modal on success
      })
      .catch(() => {
        // An upload failed
        (this.alertService as any).danger("Failed to upload one or more floor images. Please check the logs.");
      });
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
   * STAGE the new floor from the "Add new floor" card.
   * Adds a temporary MapConfigurationLevel to the floors array and stores the selected file
   * in the stagedNewFloors array for eventual upload in saveConfiguration().
   */
  stageFloor(): void {
    if (!this.newFloorName || !this.newFloorFile) {
      return;
    }

    // Create a temporary level object without binaryId (since it's not uploaded yet)
    const newLevel = {
      name: this.newFloorName,
      binaryId: undefined, // Will be set on final save
    } as MapConfigurationLevel;

    // Use the local file URL for display
    newLevel["image"] = URL.createObjectURL(this.newFloorFile!);
    this.floors.push(newLevel);

    // Track the new floor's file for batch upload on final save
    this.stagedNewFloors.push({ name: this.newFloorName, file: this.newFloorFile });

    // reset inputs
    this.newFloorName = "";
    this.newFloorFile = null;

    // 💥 Reset the file picker component
    if (this.filePickerRef && typeof this.filePickerRef.reset === 'function') {
      this.filePickerRef.reset();
    } else {
      console.warn("Could not find reset() method on filePickerRef. File picker might not clear.");
    }

    console.log("Staged new floor:", newLevel);
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
    
    // If the floor was newly staged (has no binaryId), remove it from the staging array too
    if (!this.floors[index].binaryId) {
        const stagedIndex = this.stagedNewFloors.findIndex(
            (sf) => sf.name === this.floors[index].name
        );
        if (stagedIndex !== -1) {
            this.stagedNewFloors.splice(stagedIndex, 1);
        }
    }

    // remove from main floor array
    this.floors.splice(index, 1);

    // notify consumers about the change (this is mainly for floors that were already saved/uploaded)
    this.onChange.emit(this.floors);
  }

  cancel(): void {
    console.log("Configuration cancelled.");
    this.modalRef.hide();
  }
}