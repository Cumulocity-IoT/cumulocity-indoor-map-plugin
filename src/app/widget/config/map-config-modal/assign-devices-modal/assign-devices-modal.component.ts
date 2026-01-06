import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import {
  MapConfiguration,
  MapConfigurationLevel,
  MarkerManagedObject,
} from "../../../../models/data-point-indoor-map.model";
import { IIdentified } from "@c8y/client";
import { BsModalRef } from "ngx-bootstrap/modal";
import { AssetSelectionChangeEvent, GroupNodeService } from "@c8y/ngx-components/assets-navigator";
import { MAX_PAGE_SIZE } from "@c8y/ngx-components";

@Component({
  selector: "assign-devices-modal",
  templateUrl: "./assign-devices-modal.component.html",
})
export class AssignDevicesModalComponent implements OnInit {
  @Input() building!: MapConfiguration;
  @Output() onSaveChanges = new EventEmitter<MapConfiguration>();

  model: IIdentified[] = [];
  selectedLevel?: MapConfigurationLevel;
  showComponent = true;

  config = {
    groupsSelectable: false,
    groupsOnly: false,
    multi: true,
    required: false,
    search: true,
    showChildDevices: true,
    showUnassignedDevices: false,
    label: "Assign Devices to Floor Plan",
  };

  constructor(
    private bsModalRef: BsModalRef,
    private groupNodeService: GroupNodeService
  ) {}

  ngOnInit() {
    // Increase the page size to show more elements (default is usually 20)
    (this.groupNodeService as any).PAGE_SIZE = 100;
    
    if (this.building?.levels?.length > 0) {
      this.selectLevel(this.building.levels[0]);
    }
  }

  selectLevel(level: MapConfigurationLevel) {

    console.log("Selected level:", level);

    this.selectedLevel = level;
    this.showComponent = false;
    this.model = [];

    // 3️⃣ Small delay to ensure Angular destroys and rebuilds selector
    setTimeout(() => {
      // Load previously saved devices for that floor (if any)
      const levelFromBuilding = this.building.levels.find(l => l["binaryId"] === level["binaryId"]);
      console.log("Level from building:", levelFromBuilding);
      const savedDevices = levelFromBuilding?.markers ?? ([] as MarkerManagedObject[]);
      this.model = [...savedDevices.map((mo) => ({ id: typeof mo === 'string' ? mo : mo.id }))];

      // Recreate selector with new key (forces refresh)
      this.showComponent = true;
    }, 50);
  }

  selectionChanged(selected: AssetSelectionChangeEvent) {
    this.model = Array.isArray(selected.items) ? selected.items : [selected.items];
    const currentIndex = this.building.levels.findIndex(
      (l) => l["binaryId"] === this.selectedLevel?.["binaryId"]
    );
    if (currentIndex > -1) {
      this.building.levels[currentIndex].markers = [
        ...this.model.map((mo) => ({ id: mo.id as string, name: mo["name"] })),
      ];
    }
    console.log(this.building.levels)
  }

  onSave() {
    this.onSaveChanges.emit(this.building);
    this.bsModalRef.hide();
  }

  onCancel() {
    this.bsModalRef.hide();
  }
}
