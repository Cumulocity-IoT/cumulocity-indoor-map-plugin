import { Component, OnInit } from "@angular/core";
import { IIdentified, IManagedObject } from "@c8y/client";
import { CommonModule, CoreModule } from "@c8y/ngx-components";
import {
  AssetSelectionChangeEvent,
  AssetSelectorModule,
  GroupNodeService,
} from "@c8y/ngx-components/assets-navigator";
import { BsModalRef } from "ngx-bootstrap/modal";
import { Subject } from "rxjs";

@Component({
  selector: "device-selector-modal",
  templateUrl: "./device-selector-modal.component.html",
  standalone: true,
  imports: [CommonModule, AssetSelectorModule, CoreModule],
})
export class DeviceSelectorModalComponent implements OnInit {
  config = {
    columnHeaders: true,
    groupsSelectable: true,
    groupsOnly: false,
    multi: true,
    required: false,
    search: true,
    showChildDevices: false,
    showFilter: true,
    showUnassignedDevices: true,
    singleColumn: false,
    modelMode: "full",
    label: "Asset selection",
  };
  model?: IManagedObject;
  selectedItems: IManagedObject[] = [];

  closeSubject: Subject<IManagedObject[] | undefined> = new Subject();

  constructor(
    private modal: BsModalRef,
    private groupNodeService: GroupNodeService
  ) {}

  ngOnInit() {
    // Increase the page size to show more elements (default is usually 20)
    (this.groupNodeService as any).PAGE_SIZE = 150;
  }

  selectionChanged(event: AssetSelectionChangeEvent) {
    console.log(event, "device");
    this.selectedItems = event.items as IManagedObject[];
  }

  onSubmit(): void {
    this.closeSubject.next(this.selectedItems);
    this.closeSubject.complete();
    this.modal.hide();
  }

  onCancel(): void {
    this.closeSubject.next(undefined);
    this.closeSubject.complete();
    this.modal.hide();
  }
}
