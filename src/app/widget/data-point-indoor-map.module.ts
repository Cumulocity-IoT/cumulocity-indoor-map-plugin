import { assetPaths } from "../../assets/assets";
import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { TooltipModule } from "ngx-bootstrap/tooltip";
import { ColorPickerModule } from "ngx-color-picker";
import {
  CoreModule,
  FormsModule,
  gettext,
  hookComponent,
} from "@c8y/ngx-components";
import { DataPointIndoorMapComponent } from "./data-point-indoor-map.component";
import { DataPointIndoorMapConfigComponent } from "./config/data-point-indoor-map.config.component";
import { AddThresholdModalComponent } from "./config/add-threshold-modal/add-threshold-modal.component";
import { ManagedDatapointsPopupModalComponent } from "./config/managed-datapoints-popup-modal/managed-datapoints-popup-modal.component";
import { ModalModule } from "ngx-bootstrap/modal";
import { MapConfigurationModalComponent } from "./config/map-config-modal/map-config-modal.component";
import { VirtualDraggableDeviceListComponent } from "./shared/components/virtual-draggable-device-list/virtual-draggable-device-list.component";
import { DragDropModule } from "@angular/cdk/drag-drop";
import { AssignDevicesStepComponent } from "./config/map-config-modal/assign-devices-step/assign-devices-step.component";
import { AssignLocationsStepComponent } from "./config/map-config-modal/assign-locations-step/assign-locations-step.component";
import { ImageUploadComponent } from "./shared/components/image-upload/image-upload.component";
import { MoveMarkerMapComponent } from "./shared/components/move-marker-map/move-marker-map.component";
import { DeviceSelectorModalComponent } from "./shared/components/device-selector-modal/device-selector-modal.component";
import { GPSComponent } from "./config/select-co-ordinates/gps.component";

@NgModule({
  declarations: [
    DataPointIndoorMapComponent,
    DataPointIndoorMapConfigComponent,
    AddThresholdModalComponent,
    ManagedDatapointsPopupModalComponent,
    MapConfigurationModalComponent,
    AssignDevicesStepComponent,
    AssignLocationsStepComponent,
    GPSComponent,
  ],
  imports: [
    CoreModule,
    CommonModule,
    FormsModule,
    TooltipModule,
    ColorPickerModule,
    ModalModule,
    DragDropModule,
    VirtualDraggableDeviceListComponent,
    ImageUploadComponent,
    MoveMarkerMapComponent,
    DeviceSelectorModalComponent,
  ],
  providers: [
    hookComponent({
      id: "indoor-data-point-map-widget",
      label: gettext("Indoor Map Widget"),
      description: gettext(
        "Display markers on a indoor map and their datapoints"
      ),
      component: DataPointIndoorMapComponent,
      configComponent: DataPointIndoorMapConfigComponent,
      previewImage: assetPaths.previewImage,
    }),
  ],
})
export class DataPointIndoorMapModule {}
