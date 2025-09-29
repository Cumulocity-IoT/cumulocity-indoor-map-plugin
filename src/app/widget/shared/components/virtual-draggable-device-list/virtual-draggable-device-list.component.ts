import { CdkDragDrop, DragDropModule } from "@angular/cdk/drag-drop";
import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";
import { IManagedObject, InventoryService } from "@c8y/client";
import { CoreModule, FormsModule, throttle } from "@c8y/ngx-components";
import { BsModalService } from "ngx-bootstrap/modal";
import { DeviceSelectorModalComponent } from "../device-selector-modal/device-selector-modal.component";

@Component({
  selector: "virtual-draggable-device-list",
  templateUrl: "./virtual-draggable-device-list.component.html",
  styleUrls: ["./virtual-draggable-device-list.component.less"],
  standalone: true,
  imports: [CoreModule, FormsModule, DragDropModule],
})
export class VirtualDraggableDeviceListComponent implements OnInit {
  loading = false;
  searchText = "";
  @Input() filter: object = {
    query: `$filter=has(c8y_IsDevice) $orderby=name asc`,
    withTotalPages: true,
    pageSize: 10,
  };

  @Input() isFrozen = false;
  @Input() devicesFixed?: IManagedObject[];

  @Output() onDropped = new EventEmitter<CdkDragDrop<IManagedObject[]>>();
  @Output() onAssigned = new EventEmitter<IManagedObject[]>();
  @Output() onRemoved = new EventEmitter<IManagedObject>();

  devices?: IManagedObject[];
  isDragging = false;

  constructor(
    public inventory: InventoryService,
    private modalService: BsModalService
  ) {}

  ngOnInit(): void {
    if (!this.devicesFixed) {
      this.inventory.list(this.filter).then((res) => {
        this.devices = res.data;
      });
    }
  }

  async openAssignDevicesModal() {
    const modal = this.modalService.show(DeviceSelectorModalComponent, {
      class: "modal-lg",
    });

    // Use optional chaining (?) for safety, and take(1) if modal.content.closeSubject is a BehaviorSubject
    modal.content?.closeSubject.subscribe(
      (res: IManagedObject[] | undefined) => {
        (async () => {
          if (!res || res.length === 0) {
            return;
          }

          const deviceGroups = res.filter(
            (mo) => mo["type"] === "c8y_DeviceGroup"
          );
          const individualAssets = res.filter(
            (mo) => mo["type"] !== "c8y_DeviceGroup"
          );

          let finalAssetIds: IManagedObject[] = [];

          if (deviceGroups.length > 0) {
            const childIds = await this.getChildAssetIds(deviceGroups);
            finalAssetIds.push(...childIds);
          }

          finalAssetIds.push(...individualAssets);

          console.log(
            "Final consolidated IDs (including children):",
            finalAssetIds
          );

          this.onAssigned.next(finalAssetIds);
        })();
      }
    );
  }
  async getChildAssetIds(
    deviceGroupArrays: IManagedObject[]
  ): Promise<IManagedObject[]> {
    const fetchPromises = deviceGroupArrays.map((mob) => {
      return this.inventory
        .childAssetsList(mob.id, { pageSize: 2000 })
        .then((res) => {
          return res.data
            .map((ref) => ref)
            .filter((mo) => mo && mo["c8y_IsDevice"]);
        })
        .catch((error) => {
          console.error(`Error fetching child assets for ${mob.id}:`, error);
          return []; // Return an empty array on error to allow other promises to resolve
        });
    });

    const resultsArrayOfArrays = await Promise.all(fetchPromises);

    const assetIds: IManagedObject[] = resultsArrayOfArrays.flat();

    return assetIds;
  }

  onDrop(event$: CdkDragDrop<IManagedObject[]>) {
    if (event$.previousContainer === event$.container) {
      return;
    }
    this.onDropped.emit(event$);
  }

  search() {
    this.loading = true;
    this.loadDevices(this.searchText).finally(() => {
      this.loading = false;
    });
  }

  onRemove(mo: IManagedObject) {
    this.onRemoved.emit(mo);
  }

  handleSearchKeyUp() {
    this.loadDevices(this.searchText);
  }

  @throttle(500, { trailing: false })
  async loadDevices(searchText?: string) {
    const filter: any = { ...this.filter };
    filter.pageSize = 2000;
    if (searchText?.length) {
      filter.query = `$filter=(has(c8y_IsDevice) and name eq '*${searchText}*') $orderby=name asc`;
    } else {
      filter.query = `$filter=has(c8y_IsDevice) $orderby=name asc`;
    }

    const res = await this.inventory.list(filter);
    this.devices = res.data;
  }
}
