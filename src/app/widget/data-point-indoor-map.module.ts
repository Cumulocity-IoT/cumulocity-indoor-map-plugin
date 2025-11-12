import { assetPaths } from "../../assets/assets";
import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { TooltipModule } from "ngx-bootstrap/tooltip";
import { ColorPickerModule } from "ngx-color-picker";
import {
  CoreModule,
  DynamicWidgetDefinition,
  FormsModule,
  gettext,
  hookWidget,
  WidgetDataType,
} from "@c8y/ngx-components";
import { DataPointIndoorMapComponent } from "./data-point-indoor-map.component";
import { DataPointIndoorMapConfigComponent } from "./config/data-point-indoor-map.config.component";
import { ManagedDatapointsPopupModalComponent } from "./config/managed-datapoints-popup-modal/managed-datapoints-popup-modal.component";
import { ModalModule } from "ngx-bootstrap/modal";
import { ImageUploadComponent } from "./shared/components/image-upload/image-upload.component";
import { MoveMarkerMapComponent } from "./shared/components/move-marker-map/move-marker-map.component";
import { DeviceSelectorModalComponent } from "./shared/components/device-selector-modal/device-selector-modal.component";
import { GPSComponent } from "./config/select-co-ordinates/gps.component";
import { ZonesComponent } from "./config/zones-creation/zones-creation.component";
import { AssignLocationModalComponent } from "./config/map-config-modal/assign-locations-modal/assign-locations-modal.component";
import { AssignDevicesModalComponent } from "./config/map-config-modal/assign-devices-modal/assign-devices-modal.component";
import { AssetSelectorModule } from "@c8y/ngx-components/assets-navigator";
import { TypeaheadModule } from "ngx-bootstrap/typeahead";
import { FloorConfigModalComponent } from "./config/floor-configuration-modal/floor-config-modal.component";
import { MapDataGridComponent } from "./shared/components/map-data-grid/map-data-grid.component";
import { MapPreviewComponent } from "./config/map-preview/map-preview.component";

@NgModule({
  declarations: [
    DataPointIndoorMapComponent,
    DataPointIndoorMapConfigComponent,
    ManagedDatapointsPopupModalComponent,
    AssignDevicesModalComponent,
    AssignLocationModalComponent,
    FloorConfigModalComponent,
    GPSComponent,
    ZonesComponent,
    MapPreviewComponent,
  ],
  imports: [
    CoreModule,
    CommonModule,
    FormsModule,
    TooltipModule,
    ColorPickerModule,
    ModalModule,
    ImageUploadComponent,
    MoveMarkerMapComponent,
    DeviceSelectorModalComponent,
    MapDataGridComponent,
    AssetSelectorModule,
    TypeaheadModule.forRoot(),
  ],
  providers: [
    hookWidget({
      id: "indoor-data-point-map-widget",
      label: gettext("Indoor Map Widget"),
      description: gettext(
        "Display markers on a indoor map and their datapoints"
      ),
      data: {
        settings: {
          ng1: {
            options: {
              noDeviceTarget: true,
              deviceTargetNotRequired: true,
              groupsSelectable: false,
            },
          },
        },
      } as WidgetDataType,
      component: DataPointIndoorMapComponent,
      configComponent: DataPointIndoorMapConfigComponent,
      previewImage: assetPaths.previewImage,
    } as DynamicWidgetDefinition),
  ],
})
export class DataPointIndoorMapModule {}
